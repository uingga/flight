import fs from 'node:fs';
import path from 'node:path';
import {createHttpClient,requestHttp} from '../../src/lib/naver-http.mjs';
import {createGitHubPublisher,createExactReadback} from '../../src/lib/naver-publication.mjs';
import {main as selectTodayPick} from '../select-today-pick.mjs';
import {attestRunner,runnerDigest} from './naver-admission.mjs';
import {createHash} from 'node:crypto';
import {collectorEnvironment} from './naver-collector-contract';
import {assertMode,resultVersion} from '../../src/lib/naver-coordination-contract.mjs';
import {brokerPublication,createBrokerClient} from '../../src/lib/writer-broker-client.mjs';
let productionStarted=false;

export async function prepareRuntimeInputs(publication: any, root: string, input?:any) {
    input ||= await publication.readInputs(true);
    fs.mkdirSync(path.join(root,'data'),{recursive:true});
    for(const [file,value] of [['all-flights-cache.json',input.cache],['naver-prices.json',input.prices],['today-pick.json',input.pick]] as const){
        const target=path.join(root,'data',file),temporary=target+'.coordinated-tmp';
        fs.writeFileSync(temporary,JSON.stringify(value));fs.renameSync(temporary,target);
    }
    return input;
}
export async function configuredRunnerOptions(env: NodeJS.ProcessEnv=process.env, fixture?:any) {
    if(!fixture){
        if(!assertMode(env))throw Error('coordinated mode required');
    }
    const need=(name:string)=>{if(!env[name])throw Error(`missing configuration: ${name}`);return env[name]!;};
    const worker=need('NAVER_COORDINATION_WORKER');if(!['A','C'].includes(worker))throw Error('invalid worker');
    const root=process.cwd();
    const workParent=fs.realpathSync(need('NAVER_COORDINATION_WORK_ROOT'));
    const run=need('NAVER_COORDINATION_RUN_ID');
    const workRoot=path.join(workParent,worker+'-'+createHash('sha256').update(run).digest('hex'));
    if(fixture && (!fixture.origin || !['127.0.0.1','[::1]'].includes(new URL(fixture.origin).hostname)))throw Error('fixture origin refused');
    attestRunner({digest:runnerDigest(root),approvedDigest:need('NAVER_COORDINATION_APPROVED_DIGEST'),externalLaunchersDisabled:env.NAVER_COORDINATION_EXTERNAL_ATTESTED==='1'});
    const read=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'));
    const credential=(name:string)=>fs.readFileSync(need(name),'utf8').trim();
    const url=need('NAVER_COORDINATION_URL');
    const client=createHttpClient({url,token:credential(`NAVER_COORDINATION_${worker}_TOKEN_FILE`)});
    const authenticated=await requestHttp(new URL('/health',url),{headers:{authorization:`Bearer ${credential(`NAVER_COORDINATION_${worker}_TOKEN_FILE`)}`},loopbackOnly:true});
    if(!authenticated.ok)throw Error('coordinator authentication refused');
    if(!fixture){
        // The authenticated A coordinator verifies GitHub authority on every control operation.
        // Workers never receive a GitHub token/private key; C reaches A through the pinned SSH tunnel.
        const response=await requestHttp(new URL('/authority',url),{headers:{authorization:`Bearer ${credential(`NAVER_COORDINATION_${worker}_TOKEN_FILE`)}`},loopbackOnly:true});
        if(!response.ok)throw Error('coordinator authority unavailable');
        const value=await response.json(),proof=value.authority;
        if(value.ok!==true||value.service!=='naver-ac-v1'||!proof
            ||proof.repository!==need('NAVER_COORDINATION_REPOSITORY')||proof.branch!==need('NAVER_COORDINATION_BRANCH')
            ||proof.appId!==Number(need('TIKIT_WRITER_APP_ID'))||proof.rulesetId!==Number(need('TIKIT_WRITER_RULESET_ID')))
            throw Error('coordinator authority scope mismatch');
    }
    const identity={worker,run,contract:'naver-ac-v1'};
    const viaBroker=!fixture||fixture.broker===true;
    const publication:any=viaBroker
        ? brokerPublication(createBrokerClient({url,token:credential(`NAVER_COORDINATION_${worker}_TOKEN_FILE`)}),identity)
        : createGitHubPublisher({repository:need('NAVER_COORDINATION_REPOSITORY'),branch:need('NAVER_COORDINATION_BRANCH'),token:credential('NAVER_COORDINATION_GITHUB_TOKEN_FILE'),origin:fixture.origin,fixture:true});
    const readbackUrl=need('NAVER_COORDINATION_READBACK_URL');
    const selectionUrl=new URL(readbackUrl);selectionUrl.searchParams.delete('summaryOnly');
    const input=await publication.readInputs(true),{cache}=input;
    const statePath=worker==='A'?need('NAVER_COORDINATION_A_STATE_FILE'):null;
    const exact=createExactReadback({url:readbackUrl,fixture:!!fixture});
    const publicationClient=createHttpClient({url,token:credential('NAVER_COORDINATION_PUBLISHER_TOKEN_FILE')});
    const verifyC=async(identity:any)=>{
        const observation=await client.observe(identity);
        if(observation.expectedVersion!==undefined&&observation.expectedVersion!==resultVersion(input.cache))throw Error('C snapshot differs from coordinator observation');
        await publication.assertInput(input.ref);
        const response=await requestHttp(new URL('/status',url),{headers:{authorization:`Bearer ${credential('NAVER_COORDINATION_C_TOKEN_FILE')}`},loopbackOnly:true});
        if(!response.ok||(await response.json()).state?.verifiedVersion!==resultVersion(input.cache))throw Error('C input differs from A verified result');
        await exact(input.cache);
        return observation;
    };
    if(worker==='C'){
        for(const action of ['begin','reserve']){
            const invoke=client[action];
            client[action]=async(value:any)=>invoke({...value,...await verifyC(value)});
        }
    }
    let restore:(()=>void)|undefined;
    return {root,workRoot,identity,
        attestation:{approvedDigest:need('NAVER_COORDINATION_APPROVED_DIGEST'),externalLaunchersDisabled:env.NAVER_COORDINATION_EXTERNAL_ATTESTED==='1'},
        client,
        publisher:publicationClient,
        ...((viaBroker||fixture?.writerFencing)?{
            acquirePublication:async(identity:any)=>{const lease=await publicationClient.writerAcquire({...identity,writer:'naver',claim:createHash('sha256').update(identity.run+':publication').digest('hex'),ttlMs:600000});publication.setLease?.({...identity,...lease});publication.attachFence(()=>publicationClient.writerCheck(lease));return lease;},
            recordPublication:async(identity:any,observed:string)=>publicationClient.writerObserved({...identity,observed}),
        }:{}),
        policyInput:worker==='A'?{now:fixture?.now||new Date(),cache,state:fs.existsSync(statePath!)?read(statePath!):null}:undefined,
        initialize:async(_identity:any,policy:any)=>{
            if(!fixture && (!assertMode()||productionStarted))throw Error('one configured collector per process required');
            await publication.assertInput(input.ref);
            if(worker==='C')await client.confirmObservation({..._identity,...await verifyC(_identity)});
            fs.mkdirSync(workRoot); // exclusive per-run root, never reuse/overwrite another run
            await prepareRuntimeInputs(publication,workRoot,input);
            if(!fixture){
                if(!assertMode()||productionStarted)throw Error('one configured collector per process required');
                productionStarted=true;
                const settings=collectorEnvironment(root,workRoot,policy,worker),old=Object.fromEntries(Object.keys(settings).map(k=>[k,process.env[k]])),cwd=process.cwd();
                restore=()=>{process.chdir(cwd);for(const k of Object.keys(settings)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}};
                Object.assign(process.env,settings);process.chdir(workRoot);
            }
        },
        dispose:()=>restore?.(),
        loadSnapshot:async()=>{
            const input=await publication.readInputs();
            const times=[input.cache.fullCrawlUpdatedAt,input.cache.lastUpdated,input.cache.timestamp,...Object.values(input.cache.sourceUpdatedAt||{})].map(value=>new Date(value as string).getTime()).filter(Number.isFinite);
            return {ref:input.ref,generation:Math.max(...times),flights:input.cache.flights,cache:input.cache};
        },
        resume:env.NAVER_COORDINATION_RESUME==='1',
        loadPrices:async()=>read(path.join(workRoot,'data/naver-prices.json')),
        publish:publication.publish,
        readback:exact,
        beforeRelease:async(cache:any)=>{await publication.assertPublished();await exact(cache);await publication.assertPublished();},
        selectTodayPick:async({sources}:any)=>{
            await selectTodayPick({sources,outputPath:path.join(workRoot,'data/today-pick.json'),fetcher:async()=>requestHttp(selectionUrl,{loopbackOnly:!!fixture})});
            await publication.publishTodayPick(read(path.join(workRoot,'data/today-pick.json')));
        },
        onComplete:async(_result:any,policy:any)=>{
            if(worker!=='A')return;
            const response=await requestHttp(new URL('/status',url),{headers:{authorization:`Bearer ${credential('NAVER_COORDINATION_A_TOKEN_FILE')}`},loopbackOnly:true});
            if(!response.ok)throw Error('completion status refused');
            const status=await response.json();
            const state={kstDate:status.state.day,phase:policy.deferTodayPick?'partial_waiting':'success',navigationsUsed:status.state.used.A,
                completedSources:[...new Set([...(policy.completedSources||[]),...(policy.sources||[])])],pendingSources:policy.pendingSources||[]};
            const temporary=statePath+'.coordinated-tmp';fs.writeFileSync(temporary,JSON.stringify(state));fs.renameSync(temporary,statePath!);
        },
    };
}
