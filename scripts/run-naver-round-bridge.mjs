import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installationTokenProvider} from '../src/lib/writer-app-token.mjs';
import {githubMrtClient} from '../src/lib/myrealtrip-schedule.mjs';
import {mrtRoundForGeneralSlot} from '../src/lib/mrt-round-readiness.mjs';
import {latestAgencyRound,evaluateRoundContinuation} from '../src/lib/naver-round-handoff.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const roundBridgeEnabled=(now=Date.now())=>now>=Date.parse('2026-09-16T07:31:00Z');
export function roundBarrier({round,cache,pc,mrtDone}){
 if(!round||!mrtDone||!pc||pc.state!=='Ready'||pc.result!==0||!(Date.parse(pc.startedAt)>=Date.parse(round)))return false;
 return Date.parse(cache?.fullCrawlUpdatedAt)>=Date.parse(round);
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
 while(true){
  const now=Date.now(),kst=new Date(now+9*3600000);
  if(kst.getUTCHours()*60+kst.getUTCMinutes()>=18*60+30)return;
  const round=latestAgencyRound(now);if(!round)return;
  const state=receipt(),day=kst.toISOString().slice(0,10);
  if(state?.kstDate===day&&(state.navigationsUsed>=200||['blocked','degraded','running'].includes(state.phase)
    ||(state.activeRound&&!state.roundPublished)||Date.parse(state.lastRoundAt)>=Date.parse(round)))return;
  // No stashing: unexpected code conflicts must be reviewed, never hidden by automation.
  const sync=execute('git',['pull','--ff-only','origin','main']);if(sync.status!==0)throw Error('runtime refresh failed');
  const cache=JSON.parse(fs.readFileSync(path.join(root,'data/all-flights-cache.json'),'utf8'));
  const inspection=execute(ps,['-NoProfile','-NonInteractive','-Command',
   "$t=Get-ScheduledTask -TaskName TikitikitBlockedSourceCrawl -ErrorAction Stop; $i=$t|Get-ScheduledTaskInfo -ErrorAction Stop; [pscustomobject]@{state=[string]$t.State;result=[long]$i.LastTaskResult;startedAt=$i.LastRunTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress"]);
  if(inspection.status!==0)throw Error('source task status unavailable');
  const pc=JSON.parse(inspection.stdout.trim());
  const mrt=mrtRoundForGeneralSlot(round);
  const done=await api('git/ref/tags/mrt-done/'+mrt.expectedAt.replace(/[-:.]/g,''));
  if(![200,404].includes(done.status))throw Error('MRT completion status unavailable');
  if(roundBarrier({round,cache,pc,mrtDone:done.status===200})){
   const policy=evaluateRoundContinuation({now,cache,state,round});
   if(policy.shouldRun){
    log('ready '+round+' remaining='+policy.navigationBudget);
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
  await new Promise(resolve=>setTimeout(resolve,120000));
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Naver round bridge stopped safely; inspect state and logs');process.exitCode=1;});
