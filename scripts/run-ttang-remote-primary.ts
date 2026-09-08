import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getCrawlDataDir } from '../src/lib/crawl-data-dir';
import { logCrawlResults } from '../src/lib/utils/crawl-logger';
import { TTANG_PROTOCOL, TTANG_INPUT_FILES, assertTtangAllowed, validateTtangReceivedEvidence } from './ttang-primary-policy.mjs';

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
    const request={protocol:TTANG_PROTOCOL,id,createdAt:new Date().toISOString(),expectedAt,manual,files};
    const evidenceDir=path.resolve('.local-crawler/ttang-results',id);fs.mkdirSync(evidenceDir,{recursive:true});
    if(!reconcile)fs.writeFileSync(path.join(evidenceDir,'request.json'),JSON.stringify({id,createdAt:request.createdAt,expectedAt,manual}));
    let after=structuredClone(before), failed=false, detail='', scraped=0;
    try {
        const reply:any=reconcile?JSON.parse(fs.readFileSync(path.join(evidenceDir,'reply.json'),'utf8')):await new Promise((resolve,reject)=>{
            const child=spawn('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15',config.host,'node',
                config.workerRoot+'/node_modules/tsx/dist/cli.mjs','--tsconfig',config.workerRoot+'/tsconfig.json',
                config.workerRoot+'/scripts/ttang-remote-worker.ts',manual?'--manual-once':'--scheduled'],{windowsHide:true});
            const chunks:Buffer[]=[];let size=0,done=false;
            const fail=()=>{if(done)return;done=true;clearTimeout(timer);child.kill();reject(Error('remote_transport_failed'));};
            const timer=setTimeout(fail,32*60000);
            child.on('error',fail);child.stdin.on('error',fail);child.stderr.on('data',()=>{});
            child.stdout.on('data',chunk=>{size+=chunk.length;if(size>15000000){fail();return;}chunks.push(Buffer.from(chunk));});
            child.on('close',()=>{if(done)return;done=true;clearTimeout(timer);try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('invalid_remote_reply'));}});
            child.stdin.end(JSON.stringify(request));
        });
        if(!reconcile)fs.writeFileSync(path.join(evidenceDir,'reply.json'),JSON.stringify(reply));
        if(reply.protocol!==TTANG_PROTOCOL || reply.id!==id)throw Error('remote_identity_mismatch');
        if(reply.status!=='verified') {
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
        detail=`B PC Chrome ${verified.dates}일 목록 ${scraped}건 → 필터 후 ${verified.flights.length}건; 상세 ${verified.detailCounts.selected}/20건, 시간 확인 ${verified.timeVerified}건, 빈 운임 ${verified.detailCounts.empty}건`;
        if(reconcile)detail+=' — 시계 차이로 보류됐던 동일 결과 재검증, 추가 요청 없음';
        after.ttangPrimary={status:'success',lastAttemptAt:new Date().toISOString(),lastSuccessAt:reply.bundle.completedAt,runId:id,detail};
    } catch(e) {
        failed=true;detail=`B PC Chrome 수집 실패 (${(e as Error).message}) — 기존 항공권 보존`;
        after.ttangPrimary={...after.ttangPrimary,status:'failed',lastAttemptAt:new Date().toISOString(),runId:id,detail};
        // Transport/unknown failures may have started requests on B: no automatic same-day replay.
        if(!after.ttangPrimary.nextProbeAt)after.ttangPrimary.nextProbeAt=new Date(Date.now()+86400000).toISOString();
        after.staleStreak={...after.staleStreak,ttang:Number(before.staleStreak?.ttang || 0)+1};
    }
    if(JSON.stringify(JSON.parse(fs.readFileSync(cachePath,'utf8')))!==JSON.stringify(before))throw Error('input_changed_result_saved_not_merged');
    const temp=cachePath+'.ttang-'+id+'.tmp';fs.writeFileSync(temp,JSON.stringify(after,null,2));fs.renameSync(temp,cachePath);
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
