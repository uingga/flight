import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installationTokenProvider} from '../src/lib/writer-app-token.mjs';
import {githubMrtClient} from '../src/lib/myrealtrip-schedule.mjs';
import {inspectNaverMrtCompletion} from '../src/lib/naver-mrt-completion.mjs';
import {latestAgencyRound,evaluateRoundContinuation,isEveningRound,hasPublishedEveningSource} from '../src/lib/naver-round-handoff.mjs';
import {createBrokerClient} from '../src/lib/writer-broker-client.mjs';
import {requestHttp} from '../src/lib/naver-http-request.mjs';
import {waitForCache} from './wait-for-flight-api-cache.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const roundBridgeEnabled=(now=Date.now())=>now>=Date.parse('2026-09-16T07:31:00Z');
export function roundBarrier({round,cache,pc,mrtDone}){
 // PC fallback is optional. Its exit code can be 1 after a writer acknowledgement
 // is lost even when the independently published cache proves this round finished.
 if(!round||!mrtDone||!pc||pc.state!=='Ready'||!(Date.parse(pc.startedAt)>=Date.parse(round)))return false;
 return isEveningRound(round)?hasPublishedEveningSource(cache,round)
  :Date.parse(cache?.fullCrawlUpdatedAt)>=Date.parse(round);
}
export function bridgeFailureCode(error){
 const message=String(error?.message||'').toLowerCase();
 if(Number.isInteger(error?.httpStatus))return `http_${error.httpStatus}`;
 for(const [phrase,code] of [
  ['coordinator status unavailable','coordinator_status_unavailable'],
  ['invalid coordinator status','coordinator_status_invalid'],
  ['broker publication refused','broker_read_refused'],
  ['source task status unavailable','source_task_status_unavailable'],
  ['mrt evidence unavailable','mrt_evidence_unavailable'],
  ['coordinator unsafe or already running','coordinator_unsafe'],
  ['coordinated round failed','collector_failed'],
 ])if(message.includes(phrase))return code;
 return error?.code==='ENOENT'?'required_file_missing':'unclassified_failure';
}
export async function performRound({round,run,verify,publishReceipt}){
 const exit=await run(round);
 if(exit!==0)throw Error('Naver phase failed; retain state and stop');
 await verify();
 await publishReceipt(round);
}
async function main(){
 if(process.argv[2]!=='--scheduled')throw Error('scheduled mode required');
 const execute=(command,args,env={})=>spawnSync(command,args,{cwd:root,env:{...process.env,...env},windowsHide:true,encoding:'utf8',timeout:12*3600000,maxBuffer:4000000});
 const ps=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 if(!roundBridgeEnabled()){
  const r=execute(ps,['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/run-naver-crawl.ps1'),'-Scheduled']);
  process.exitCode=r.status??1;return;
 }
 const token=installationTokenProvider({appId:4952321,installationId:161894104,repository:'uingga/flight',privateKey:fs.readFileSync(path.join(os.homedir(),'AppData/Local/Tikitikit/publisher-auth/github-app.private-key.pem'),'utf8')});
 const api=githubMrtClient(token),statePath=path.join(os.homedir(),'AppData/Local/Tikitikit/state/naver-crawl.json');
 const logDir=path.join(os.homedir(),'AppData/Local/Tikitikit/state');fs.mkdirSync(logDir,{recursive:true});
 const log=(message)=>fs.appendFileSync(path.join(logDir,'naver-round-bridge.log'),new Date().toISOString()+' '+message+'\n');
 const receipt=()=>fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):null;
 const coordinated=process.env.NAVER_COORDINATION==='1';
 const coordinatorToken=coordinated?fs.readFileSync(process.env.NAVER_COORDINATION_A_TOKEN_FILE,'utf8').trim():null;
 const coordinatorStatus=async()=>{
  const r=await requestHttp(new URL('/status',process.env.NAVER_COORDINATION_URL),{loopbackOnly:true,headers:{authorization:'Bearer '+coordinatorToken}});
  if(!r.ok)throw Error('coordinator status unavailable');const value=await r.json();if(value.ok!==true)throw Error('invalid coordinator status');return value.state;
 };
 const broker=coordinated?createBrokerClient({url:process.env.NAVER_COORDINATION_URL,token:coordinatorToken}):null;
 const pause=()=>new Promise(resolve=>setTimeout(resolve,120000));
 let observationFailures=0;
 const observe=async(label,read)=>{
  try{return await read();}catch(error){
   if([401,403,429].includes(error?.httpStatus)||++observationFailures>=3)throw error;
   log('readiness deferred '+label+' code='+bridgeFailureCode(error));
   return null;
  }
 };
 while(true){
  const now=Date.now(),kst=new Date(now+9*3600000);
  const minutes=kst.getUTCHours()*60+kst.getUTCMinutes();
  if(minutes>=23*60+50||(minutes>=18*60+30&&minutes<19*60+31))return;
  const round=latestAgencyRound(now);if(!round)return;
  const state=receipt(),day=kst.toISOString().slice(0,10);
  if(coordinated){
   const shared=await observe('coordinator',coordinatorStatus);
   if(!shared){await pause();continue;}
   if(shared?.day===day){
    if(shared.blocked||shared.pending||(shared.owner&&shared.phase!=='paused-A'))throw Error('coordinator unsafe or already running');
    if(shared.used.A+shared.used.C>=450)return;
    if(shared.phase==='ready-C'){
     const r=execute(ps,['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/run-naver-crawl.ps1'),'-Scheduled'],{NAVER_COMPLETED_ROUND:shared.round||round});
     if(r.status!==0)throw Error('pending C handoff refused');continue;
    }
   }
  }
  if(state?.kstDate===day&&((!coordinated&&state.navigationsUsed>=200)||['blocked','degraded','running'].includes(state.phase)
    ||(state.activeRound&&!state.roundPublished)||Date.parse(state.lastRoundAt)>=Date.parse(round)))return;
  // No stashing: unexpected code conflicts must be reviewed, never hidden by automation.
  if(!coordinated){const sync=execute('git',['pull','--ff-only','origin','main']);if(sync.status!==0)throw Error('runtime refresh failed');}
  const inputs=coordinated?await observe('published-cache',()=>broker('readInputs',{identity:{worker:'A',run:'round-read',contract:'naver-ac-v1'}})):null;
  if(coordinated&&!inputs){await pause();continue;}
  const cache=coordinated?inputs.cache:JSON.parse(fs.readFileSync(path.join(root,'data/all-flights-cache.json'),'utf8'));
  const sourceTask=isEveningRound(round)?'TikitikitAgencyEvening':'TikitikitBlockedSourceCrawl';
  const pc=await observe('source-task',()=>{const result=execute(ps,['-NoProfile','-NonInteractive','-Command',
   `$t=Get-ScheduledTask -TaskName ${sourceTask} -ErrorAction Stop; $i=$t|Get-ScheduledTaskInfo -ErrorAction Stop; [pscustomobject]@{state=[string]$t.State;result=[long]$i.LastTaskResult;startedAt=$i.LastRunTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress`]);
   if(result.status!==0)throw Error('source task status unavailable');
   let value;try{value=JSON.parse(result.stdout.trim());}catch{throw Error('source task status unavailable');}
   if(!value||typeof value.state!=='string'||!Number.isFinite(Date.parse(value.startedAt)))throw Error('source task status unavailable');
   return value;});
  if(!pc){await pause();continue;}
  const mrt=await observe('mrt-evidence',()=>inspectNaverMrtCompletion({api,round,cache,now}));
  if(!mrt){await pause();continue;}
  observationFailures=0;
  if(roundBarrier({round,cache,pc,mrtDone:mrt.ready})){
   const policy=evaluateRoundContinuation({now,cache,state,round,totalBudget:coordinated?450:200});
   if(policy.shouldRun){
    log('MRT readiness '+JSON.stringify(mrt));
    log('ready '+round+' remaining='+policy.navigationBudget);
    if(coordinated){
     await waitForCache({cache,exact:false,fetcher:(url,options)=>requestHttp(url,{headers:options.headers}),siteUrl:'https://www.tikitikit.kr'});
     const r=execute(ps,['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/run-naver-crawl.ps1'),'-Scheduled'],{NAVER_COMPLETED_ROUND:round});
     if(r.status!==0)throw Error('coordinated round failed');
     const published=receipt();if(published?.activeRound!==round||published.roundPublished!==true)throw Error('coordinated round not published');
     log('coordinated published '+round);continue;
    }
    await performRound({round,
     run:async()=>{
      // Existing API readback requires this local cache to have reached the serving API.
      if(execute(process.execPath,['scripts/wait-for-flight-api-cache.mjs']).status!==0)throw Error('upstream API not reflected');
      const r=execute(ps,['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/run-naver-crawl.ps1'),'-Scheduled'],{NAVER_COMPLETED_ROUND:round});
      return r.status??1;
     },
     verify:async()=>{if(execute(process.execPath,['scripts/wait-for-flight-api-cache.mjs']).status!==0)throw Error('Naver API not reflected');},
     publishReceipt:async()=>{const r=execute(process.execPath,['scripts/local-naver-run-policy.mjs','round-published','--state',statePath,'--round',round]);if(r.status!==0)throw Error('round receipt failed');},
    });
    log('published '+round);
    // If another scheduled round matured during this session, handle it now. No parallel browser.
    continue;
   }
   if(!['recovery_upstream_pending','no_fresh_sources'].includes(policy.reason))return;
  }
  await pause();
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('Naver round bridge stopped safely; code='+bridgeFailureCode(error));process.exitCode=1;});
