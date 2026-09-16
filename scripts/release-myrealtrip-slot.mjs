import fs from 'node:fs';
import path from 'node:path';
import {githubMrtClient} from '../src/lib/myrealtrip-schedule.mjs';
import {releaseMrt} from '../src/lib/mrt-shared-admission.mjs';
if(!process.env.GITHUB_TOKEN||!process.env.RUNNER_TEMP)throw Error('missing identity');
// Known persisted block may release the mutex; both hosts still obey its future circuit.
if(process.env.MRT_COLLECTOR_OUTCOME!=='success'){
 const cache=JSON.parse(fs.readFileSync('data/all-flights-cache.json','utf8'));
 if(!(Date.parse(cache.sourceCircuits?.myrealtrip?.nextProbeAt)>Date.now()))throw Error('unknown collector failure; retain shared admission');
}
const ticket=JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP,'mrt-owner.json'),'utf8'));
await releaseMrt(githubMrtClient(process.env.GITHUB_TOKEN,process.env.GITHUB_REPOSITORY),ticket);
