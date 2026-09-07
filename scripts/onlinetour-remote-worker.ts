// B PC worker. No operational cache writes, git credentials, scheduler or publication here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { evaluatePcCollection } from './pc-collection-policy.mjs';
import { executeCatalogue,createLiveCatalogueBackend,checkValidationCooldown } from './crawl-onlinetour-catalogue';
import { operationalPlan,validateOperationalCatalogue,ONLINE_REMOTE_PROTOCOL,isOnlineAccessFailure,statusFixValidationSlot,STATUS_FIX_PARENT } from '../src/lib/onlinetour-operational';
import { classifySourceAccessRestriction } from '../src/lib/source-circuit';
import { CONTINUATION_PARENT,continuationPlan,combineContinuation } from '../src/lib/onlinetour-validation-continuation';
import { createStagingRun } from '../src/lib/onlinetour-browser-collector';

async function main() {
    const mode=process.argv[2];
    if(process.argv.length!==3 || !['--scheduled','--validate','--validate-status-fix','--continue-validation-30','--validate-month-fix'].includes(mode)) throw Error('explicit_worker_mode_required');
    if(os.hostname().toUpperCase()!=='DESKTOP-OFFICE' || !process.env.LOCALAPPDATA) throw Error('wrong_worker_host');
    const chunks:Buffer[]=[]; let size=0;
    for await(const chunk of process.stdin) {size+=chunk.length;if(size>20000)throw Error('request_too_large');chunks.push(Buffer.from(chunk));}
    const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const now=Date.now(), age=now-Date.parse(request.createdAt);
    if(request.protocol!==ONLINE_REMOTE_PROTOCOL || !/^[0-9a-f-]{36}$/.test(request.id || '') || !Number.isFinite(age) || age<0 || age>900000) throw Error('invalid_worker_request');
    const policy=evaluatePcCollection({cache:request.cache});
    if(mode==='--scheduled' && (!policy.shouldRun || !policy.sources.includes('onlinetour') || policy.expectedAt!==request.expectedAt)) throw Error('source_not_eligible');
    const crawlAge=now-Date.parse(request.cache?.fullCrawlUpdatedAt);
    if(!Number.isFinite(crawlAge) || crawlAge<0 || crawlAge>6*3600000) throw Error('stale_source_state');
    const root=path.resolve(__dirname,'..'),state=path.join(process.env.LOCALAPPDATA,'Tikitikit','onlinetour-validation');
    fs.mkdirSync(state,{recursive:true});
    if(fs.lstatSync(state).isSymbolicLink())throw Error('unsafe_state_directory');
    const cooldown=path.join(state,'cooldown.json');
    const check=()=>{for(const file of [cooldown,path.join(root,'.local-crawler','onlinetour-validation-cooldown.json')])
        checkValidationCooldown(request.cache,fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null);
        for(const nextProbeAt of [request.cache?.onlinePrimary?.circuit?.nextProbeAt,request.cache?.onlinePrimary?.circuit?.localFallback?.nextProbeAt])
            checkValidationCooldown({},nextProbeAt?{nextProbeAt}:null);};
    check();
    const lock=path.join(state,'run.lock'),fd=fs.openSync(lock,'wx');
    let summary:any, browserStarted=false, cleanupConfirmed=false;
    try {
        check();
        // Immutable per-slot ledger survives SSH disconnects and publication errors. No recrawl retry.
        const continuation=mode==='--continue-validation-30';
        const readParent=(name:string)=>JSON.parse(fs.readFileSync(path.join(root,'.local-crawler','staging',CONTINUATION_PARENT,name),'utf8'));
        const parent=continuation?{summary:readParent('summary.json'),raw:readParent('raw-products.json'),flights:readParent('flights.json')}:null;
        const suffixPlan=parent?continuationPlan(parent.summary,parent.raw,parent.flights,now):null;
        // Previous continuation preflight stopped before any site action; keep that marker intact.
        // The execution phase has its own immutable marker, created only after read-only checks.
        const slot=continuation?'validation-continue-30-execution-'+CONTINUATION_PARENT:mode==='--validate-status-fix'
            ? statusFixValidationSlot(JSON.parse(fs.readFileSync(path.join(root,'.local-crawler','staging',STATUS_FIX_PARENT,'summary.json'),'utf8')),now)
            : mode==='--validate-month-fix'?'validation-month-coverage-40-'+new Date(now+9*3600000).toISOString().slice(0,10)
            : mode==='--validate'?'validation-'+new Date(now+9*3600000).toISOString().slice(0,10):request.expectedAt;
        const key=createHash('sha256').update(String(slot)).digest('hex');
        const mark=()=>fs.writeFileSync(path.join(state,'operational-'+key+'.json'),JSON.stringify({id:request.id,slot,createdAt:request.createdAt}),{flag:'wx'});
        if(!continuation)mark();
        const backend=await createLiveCatalogueBackend();
        browserStarted=true;
        const inspector=await backend.openRegion(0,0);
        let snapshot;
        try {snapshot=await inspector.inspect();} finally {await inspector.close();cleanupConfirmed=true;}
        if(snapshot.restricted) throw Error('access_restriction');
        if(inspector.failure) throw Error(isOnlineAccessFailure(inspector.failure)?'access_restriction':'inspection_failed');
        if(continuation && (snapshot.region!=='HN' || !snapshot.emptyInventoryVerified))throw Error('continuation_start_changed');
        if(continuation)mark();
        const plan=suffixPlan || operationalPlan(snapshot.region);
        cleanupConfirmed=false;
        summary=await executeCatalogue(root,plan,backend,false,event=>process.stderr.write(JSON.stringify(event)+'\n'));
        cleanupConfirmed=summary.cleanupConfirmed===true;
        const run=path.join(root,'.local-crawler','staging',summary.runId);
        const raw=JSON.parse(fs.readFileSync(path.join(run,'raw-products.json'),'utf8'));
        const flights=JSON.parse(fs.readFileSync(path.join(run,'flights.json'),'utf8'));
        if(parent){
            const combined=combineContinuation(parent.summary,parent.raw,parent.flights,summary,raw,flights,Date.now(),request.cache.scrapedCounts?.onlinetour);
            const proof=createStagingRun(root);combined.summary.runId=proof.runId;
            proof.write('summary.json',combined.summary);proof.write('raw-products.json',combined.raw);proof.write('flights.json',combined.flights);
            process.stdout.write(JSON.stringify({protocol:ONLINE_REMOTE_PROTOCOL,id:request.id,status:'verified',...combined}));
        }else{
            validateOperationalCatalogue(summary,raw,flights,Date.now(),request.cache.scrapedCounts?.onlinetour);
            process.stdout.write(JSON.stringify({protocol:ONLINE_REMOTE_PROTOCOL,id:request.id,status:'verified',summary,raw,flights}));
        }
    } catch(error) {
        const restricted=isOnlineAccessFailure(summary?.failure) || isOnlineAccessFailure((error as Error).message) || !!classifySourceAccessRestriction(error);
        if(restricted)fs.writeFileSync(cooldown,JSON.stringify({nextProbeAt:new Date(Date.now()+86400000).toISOString(),reason:'access_restriction'}));
        const message=(error as Error).message;
        const reason=summary?.failure || (/^[a-z_]{1,80}$/.test(message)?message:'operational_validation_failed');
        process.stdout.write(JSON.stringify({protocol:ONLINE_REMOTE_PROTOCOL,id:request.id,status:'failed',restricted,reason,
            githubFallbackSafe:!browserStarted || cleanupConfirmed,runId:summary?.runId || null}));
        process.exitCode=1;
    } finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}
void main().catch(error=> {const reason=/^[a-z_]{1,80}$/.test(error?.message || '')?error.message:'worker_preflight_failed';
    process.stdout.write(JSON.stringify({protocol:ONLINE_REMOTE_PROTOCOL,status:'failed',reason}));process.exitCode=1;});
