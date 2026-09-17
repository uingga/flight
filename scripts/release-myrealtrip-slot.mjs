import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {githubMrtClient} from '../src/lib/myrealtrip-schedule.mjs';
import {releaseMrt} from '../src/lib/mrt-shared-admission.mjs';
import {mrtFinalization} from '../src/lib/mrt-finalization.mjs';
if(!process.env.GITHUB_TOKEN||!process.env.RUNNER_TEMP)throw Error('missing identity');
const ticket=JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP,'mrt-owner.json'),'utf8'));
const archived=process.env.MRT_PUBLISHER_OUTCOME==='failure';
const cachePath=archived?path.join(process.env.RUNNER_TEMP,'mrt-recovery/all-flights-cache.json'):'data/all-flights-cache.json';
const cache=JSON.parse(fs.readFileSync(cachePath,'utf8'));
if(archived){
 const manifest=JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP,'mrt-recovery/manifest.json'),'utf8'));
 if(manifest.ticket?.owner!==ticket.owner||manifest.ticket?.slot!==ticket.slot||manifest.runId!==process.env.GITHUB_RUN_ID||manifest.collector!=='success')throw Error('recovery evidence mismatch');
 for(const name of ['all-flights-cache.json','crawl-log.json']){
  const hash=createHash('sha256').update(fs.readFileSync(path.join(process.env.RUNNER_TEMP,'mrt-recovery',name))).digest('hex');
  if(hash!==manifest.hashes?.[name])throw Error('recovery snapshot changed');
 }
}
const decision=mrtFinalization({collector:process.env.MRT_COLLECTOR_OUTCOME,publisher:process.env.MRT_PUBLISHER_OUTCOME,artifactId:process.env.MRT_RECOVERY_ARTIFACT_ID,cache,slot:ticket.slot});
if(!decision.release)throw Error('unresolved failure; retain shared admission and recovery evidence');
await releaseMrt(githubMrtClient(process.env.GITHUB_TOKEN,process.env.GITHUB_REPOSITORY),ticket,{completed:decision.completed});
console.log('MRT admission released: '+decision.reason+'; original slot claim retained');
