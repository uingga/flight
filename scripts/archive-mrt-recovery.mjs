import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const temp=process.env.RUNNER_TEMP;
if(!temp||!process.env.GITHUB_RUN_ID)throw Error('runner identity required');
const ticket=JSON.parse(fs.readFileSync(path.join(temp,'mrt-owner.json'),'utf8'));
if(!/^[a-f0-9]{40}$/.test(ticket.owner)||ticket.host!=='github')throw Error('invalid owner');
const dir=path.join(temp,'mrt-recovery');fs.mkdirSync(dir,{recursive:true});
const hashes={};
for(const file of ['all-flights-cache.json','crawl-log.json']){
 const raw=fs.readFileSync(path.join('data',file));JSON.parse(raw.toString());
 hashes[file]=createHash('sha256').update(raw).digest('hex');fs.writeFileSync(path.join(dir,file),raw,{flag:'wx'});
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:1,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,ticket,collector:process.env.MRT_COLLECTOR_OUTCOME,hashes,createdAt:new Date().toISOString()},null,2),{flag:'wx'});
console.log('MRT recovery snapshot prepared; no credentials included');
