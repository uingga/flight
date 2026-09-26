import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import {ttangWorkerForSlot,beginTtangDispatch} from './ttang-worker-routing.mjs';
import {ttangWorkerSshArgs} from './ttang-worker-launch.mjs';
import { getCrawlDataDir } from '../src/lib/crawl-data-dir';
import { logCrawlResults } from '../src/lib/utils/crawl-logger';
import { TTANG_PROTOCOL, TTANG_INPUT_FILES, assertTtangAllowed, validateTtangReceivedEvidence } from './ttang-primary-policy.mjs';
import { isTtangPreflightFailure } from './ttang-failure-policy.mjs';
import { requestRemoteWorker } from '../src/lib/remote-worker-transport';
import { replacementLaunch } from '../src/lib/temporary-b-replacement.mjs';

async function main() {
    const manual=process.argv[2]==='--manual-once';
    const reconcile=process.argv[2]?.startsWith('--reconcile-saved=')?process.argv[2].slice('--reconcile-saved='.length):null;
    if(process.argv.length!==3 || (!manual && process.argv[2]!=='--scheduled' && !reconcile))throw Error('explicit_run_mode_required');
    const config=JSON.parse(fs.readFileSync('.local-crawler/ttang-remote.json','utf8'));
    if(config.protocol!==TTANG_PROTOCOL || config.enabled!==true || config.host!=='tikitikit-pc-b'
        || config.workerRoot!=='C:/Users/ynal/AppData/Local/Tikitikit/crawler-validation-20260907')throw Error('invalid_remote_config');
    const dir=getCrawlDataDir(), cachePath=path.join(dir,'all-flights-cache.json');
    const files=Object.fromEntries(TTANG_INPUT_FILES.filter(f=>fs.existsSync(path.join(dir,f)))
        .map(f=>[f,JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))]));
    const before=files['all-flights-cache.json'];
    if(reconcile && (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(reconcile)
        || before.ttangPrimary?.runId!==reconcile || before.ttangPrimary?.status!=='failed'
        || !before.ttangPrimary?.detail?.includes('(invalid_run_evidence)')))throw Error('reconciliation_not_eligible');
    const expectedAt=reconcile?null:assertTtangAllowed(before,{manual}), id=reconcile || randomUUID();
    const worker=ttangWorkerForSlot(expectedAt,{manual:manual||Boolean(reconcile)});
    const request={protocol:TTANG_PROTOCOL,id,createdAt:new Date().toISOString(),expectedAt,manual,files,worker};
    const dispatch=reconcile?null:beginTtangDispatch(path.join(os.homedir(),'AppData/Local/Tikitikit/ttang-dispatch'),manual?'manual-'+new Date(Date.now()+9*3600000).toISOString().slice(0,10):expectedAt,id);
    const evidenceDir=path.resolve('.local-crawler/ttang-results',id);fs.mkdirSync(evidenceDir,{recursive:true});
    if(!reconcile)fs.writeFileSync(path.join(evidenceDir,'request.json'),JSON.stringify({id,createdAt:request.createdAt,expectedAt,manual}));
    let after=structuredClone(before), failed=false, detail='', scraped=0, failureReply:any;
    try {
        const reply:any=reconcile?JSON.parse(fs.readFileSync(path.join(evidenceDir,'reply.json'),'utf8')):await (async()=>{
            const replacement=worker==='B'?replacementLaunch('ttang',expectedAt,{manual}):null;
            const ssh=ttangWorkerSshArgs(worker,manual?'--manual-once':'--scheduled',config.host);
            return requestRemoteWorker({file:replacement?.file,cwd:replacement?.cwd,args:replacement?.args || ssh,request,timeoutMs:32*60000,maxBytes:15000000,
                trace:record=>console.error(JSON.stringify({event:'ttang_remote_transport',id,worker,expectedAt,...record}))});
        })();
        if(!reconcile)fs.writeFileSync(path.join(evidenceDir,'reply.json'),JSON.stringify(reply));
        if(reply.protocol!==TTANG_PROTOCOL || reply.id!==id)throw Error('remote_identity_mismatch');
        if(reply.status!=='verified') {
            failureReply=reply;
            if(Number.isSafeInteger(reply.observedCount) && reply.observedCount>=0)scraped=reply.observedCount;
            if(reply.cooldown?.nextProbeAt)after.ttangPrimary={...after.ttangPrimary,nextProbeAt:reply.cooldown.nextProbeAt};
            throw Error(reply.reason || 'worker_failed');
        }
        const verified=await validateTtangReceivedEvidence(reply.bundle,id);
        scraped=verified.rawCount;
        const overlay=path.join(evidenceDir,'cache.json');
        fs.writeFileSync(overlay,JSON.stringify(reply.bundle.cache));
        // Merge into a private copy first; only ttang data/state can change.
        const candidate=path.join(evidenceDir,'merged.json');fs.writeFileSync(candidate,JSON.stringify(before));
        const merged=spawnSync(process.execPath,['scripts/merge-cache-source.mjs',candidate,overlay,'ttang'],{encoding:'utf8',windowsHide:true});
        if(merged.status!==0)throw Error('source_merge_failed');
        after=JSON.parse(fs.readFileSync(candidate,'utf8'));
        detail=`${reply.executionHost==='A'?'A PC(B 임시 대체)':worker+' PC'} Chrome ${verified.dates}일 목록 ${scraped}건 → 필터 후 ${verified.flights.length}건; 상세 ${verified.detailCounts.selected}/20건, 시간 확인 ${verified.timeVerified}건, 빈 운임 ${verified.detailCounts.empty}건`;
        if(reconcile)detail+=' — 시계 차이로 보류됐던 동일 결과 재검증, 추가 요청 없음';
        after.ttangPrimary={status:'success',lastAttemptAt:new Date().toISOString(),lastSuccessAt:reply.bundle.completedAt,runId:id,detail};
    } catch(e) {
        failed=true;detail=`${worker} PC Chrome 수집 실패 (${(e as Error).message}) — 기존 항공권 보존`;
        const preflight=isTtangPreflightFailure(failureReply,id);
        if(preflight)detail+='; 외부 요청 전 준비 단계 실패';
        after.ttangPrimary={...after.ttangPrimary,status:'failed',lastAttemptAt:new Date().toISOString(),runId:id,detail,
            failureKind:preflight?'preflight':'protected_failure'};
        // Only proved zero-request failures omit a NEW cooldown. Never remove an
        // existing one; transport/unknown/blocked failures retain full protection.
        if(!preflight)after.ttangPrimary.nextProbeAt=new Date(Math.max(Date.now()+86400000,
            Date.parse(after.ttangPrimary.nextProbeAt)||0)).toISOString();
        after.staleStreak={...after.staleStreak,ttang:Number(before.staleStreak?.ttang || 0)+1};
    }
    if(failed)dispatch?.finish(true,after.ttangPrimary?.nextProbeAt,failureReply);
    if(JSON.stringify(JSON.parse(fs.readFileSync(cachePath,'utf8')))!==JSON.stringify(before))throw Error('input_changed_result_saved_not_merged');
    const temp=cachePath+'.ttang-'+id+'.tmp';fs.writeFileSync(temp,JSON.stringify(after,null,2));fs.renameSync(temp,cachePath);
    if(!failed)dispatch?.finish(false);
    const old=before.flights.filter((f:any)=>f.source==='ttang'), fresh=after.flights.filter((f:any)=>f.source==='ttang');
    const oldIds=new Set(old.map((f:any)=>f.id)), newIds=new Set(fresh.map((f:any)=>f.id));
    const summary=(f:any)=>({id:f.id,airline:f.airline,route:`${f.departure.city} → ${f.arrival.city}`,departureDate:f.departure.date,returnDate:f.arrival.date,price:f.price});
    const added=fresh.filter((f:any)=>!oldIds.has(f.id)),removed=old.filter((f:any)=>!newIds.has(f.id));
    const cities:Record<string,number>={};for(const f of fresh)cities[f.arrival.city]=(cities[f.arrival.city] || 0)+1;
    logCrawlResults('ttang',fresh.length,undefined,cities,{scraped,preserved:failed,skipped:false,collectionMode:'pc_primary',
        separateSession:true,detail,added:added.length,removed:removed.length,addedFlights:added.slice(0,100).map(summary),removedFlights:removed.slice(0,100).map(summary)});
    console.log(JSON.stringify({status:failed?'failed_preserved':'success',id,scraped,before:old.length,after:fresh.length,added:added.length,removed:removed.length,detail,evidenceDir}));
    // Validly recorded failures must be published by the scheduler, not discarded as process errors.
}
void main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
