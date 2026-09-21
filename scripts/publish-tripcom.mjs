import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

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
    if(!prepared.verifiedCount){
        await finishEmpty(prepared.requestId);
        return {status:'no_verified_quotes',published:false};
    }
    const result=await broker('commit',{expectedBase:input.ref,requestId:prepared.requestId,
        entries:[['data/all-flights-cache.json',prepared.cache]]});
    if(!/^[a-f0-9]{40}$/.test(result?.commitSha||''))throw Error('publication response unknown');
    // Readback, not the existence of a local artifact, is publication evidence.
    const operating=await verifyOperating({commitSha:result.commitSha,cache:prepared.cache,requestId:prepared.requestId});
    if(operating!==true)throw Error('operating publication unconfirmed');
    await acknowledge(prepared.requestId,result.commitSha);
    return {status:'published',published:true,commitSha:result.commitSha};
}
