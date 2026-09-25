import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The admin compares Trip.com with the ordinary agencies' 20-slot time window.
// Trip.com can run twice as often; keep spare capacity for irregular extra runs.
const HISTORY_LIMIT=60;
const RUN_STATUSES=new Set(['collected','partial','blocked_preserved']);

function readRun(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const {runId,host,status,verifiedCities,unconfirmedCities}=value;
    if(typeof runId!=='string'||!Number.isFinite(Date.parse(runId))
        ||!['B','C','BC'].includes(host)||!RUN_STATUSES.has(status)
        ||!Number.isSafeInteger(verifiedCities)||verifiedCities<0
        ||!Number.isSafeInteger(unconfirmedCities)||unconfirmedCities<0)return null;
    return {runId,host,status,verifiedCities,unconfirmedCities};
}

/** Keep only witnessed publication metadata. Never infer older runs from current offers. */
export function withTripcomRunHistory(previous,proposed){
    const latest=readRun(proposed?.tripcomPrimary);
    if(!latest)throw Error('invalid Trip.com publication run');
    const oldPrimary=previous?.tripcomPrimary;
    const candidates=[...(Array.isArray(oldPrimary?.history)?oldPrimary.history:[]),oldPrimary,latest];
    const distinct=new Map();
    for(const candidate of candidates){
        const run=readRun(candidate);
        if(run)distinct.set(`${run.runId}|${run.host}`,run);
    }
    const history=[...distinct.values()]
        .sort((a,b)=>Date.parse(a.runId)-Date.parse(b.runId))
        .slice(-HISTORY_LIMIT);
    const next=structuredClone(proposed);
    next.tripcomPrimary={...next.tripcomPrimary,history};
    return next;
}

export function prepareTripcomPublication(python, cache, artifact) {
    const script=fileURLToPath(new URL('./tripcom/prepare_publication_cli.py',import.meta.url));
    return JSON.parse(execFileSync(python,[script],{input:JSON.stringify({cache,artifact}),encoding:'utf8',
        maxBuffer:16*1024*1024,timeout:30000,windowsHide:true}));
}

// The installed central service supplies the scoped broker credential and
// operational verifier. B/C only submit artifacts; neither can invoke this.
export async function publishTripcom({artifact,broker,prepare,verifyOperating,acknowledge,finishEmpty}) {
    const input=await broker('readInputs');
    const prepared=await prepare(input.cache,artifact);
    if(!Number.isSafeInteger(prepared.verifiedCount)||prepared.verifiedCount<0||prepared.verifiedCount>40)
        throw Error('invalid verified quote count');
    if(prepared.verifiedCount===0){
        await finishEmpty(prepared.requestId);
        return {status:'no_verified_quotes',published:false};
    }
    if(prepared.cache?.tripcomPrimary?.verifiedCities!==prepared.verifiedCount)
        throw Error('Trip.com run count mismatch');
    const cache=withTripcomRunHistory(input.cache,prepared.cache);
    const result=await broker('commit',{expectedBase:input.ref,requestId:prepared.requestId,
        entries:[['data/all-flights-cache.json',cache]]});
    if(!/^[a-f0-9]{40}$/.test(result?.commitSha||''))throw Error('publication response unknown');
    // Readback, not the existence of a local artifact, is publication evidence.
    const operating=await verifyOperating({commitSha:result.commitSha,cache,requestId:prepared.requestId});
    if(operating!==true)throw Error('operating publication unconfirmed');
    await acknowledge(prepared.requestId,result.commitSha);
    return {status:'published',published:true,commitSha:result.commitSha};
}
