import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const allowed=['all-flights-cache.json','interpark-prices.json','crawl-log.json','gid-map.json'];
async function main(){
 if(os.hostname().toUpperCase()!=='DESKTOP-1PPFUR3'||process.argv[2]!=='--scheduled')throw Error('wrong host or mode');
 let size=0;const chunks=[];for await(const c of process.stdin){size+=c.length;if(size>20000000)throw Error('input too large');chunks.push(c);}
 const input=JSON.parse(Buffer.concat(chunks).toString());
 const reply=await executeMrtWorker(input);
 process.stdout.write(JSON.stringify(reply));
}
export async function executeMrtWorker(input,{state=path.join(os.homedir(),'AppData/Local/Tikitikit/mrt-worker'),collector=spawnSync}={}) {
 if(input.protocol!=='mrt-c-v1'||!/^\d{4}-\d{2}-\d{2}T(?:23:55|06:15):00\.000Z$/.test(input.slot)||!/^[a-f0-9-]{36}$/.test(input.id)||Math.abs(Date.now()-Date.parse(input.createdAt))>300000||!Number.isFinite(Date.parse(input.createdAt)))throw Error('invalid request');
 if(!input.files||!Array.isArray(input.files['all-flights-cache.json']?.flights)||Object.keys(input.files).some(x=>!allowed.includes(x)))throw Error('invalid inputs');
 fs.mkdirSync(state,{recursive:true});
 const lock=path.join(state,'active.lock'),fd=fs.openSync(lock,'wx');
 let finished=false;
 try {
  fs.writeFileSync(path.join(state,input.slot.replace(/[-:.]/g,'')+'.json'),JSON.stringify({id:input.id}),{flag:'wx'});
  const dir=path.join(state,input.id);fs.mkdirSync(dir);
  for(const name of allowed)if(input.files[name])fs.writeFileSync(path.join(dir,name),JSON.stringify(input.files[name]));
  const log=fs.openSync(path.join(dir,'collector.log'),'wx');let result;
  try {result=collector(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),'--tsconfig',path.join(root,'tsconfig.json'),path.join(root,'scripts/scrape-myrealtrip-prices.ts')],{
    cwd:root,env:{...process.env,TIKITIKIT_DATA_DIR:dir,MRT_C_WORKER:'1'},stdio:['ignore',log,log],timeout:180*60000,windowsHide:true});}
  finally{fs.closeSync(log);}
  if(result.error||result.signal)throw Error('collector uncertain');
  const cache=JSON.parse(fs.readFileSync(path.join(dir,'all-flights-cache.json'),'utf8'));
  const logs=fs.existsSync(path.join(dir,'crawl-log.json'))?JSON.parse(fs.readFileSync(path.join(dir,'crawl-log.json'),'utf8')):input.files['crawl-log.json'];
  // Completed failure may contain a persisted source circuit; return it for publication.
  finished=true;
  return {protocol:'mrt-c-v1',id:input.id,slot:input.slot,exitCode:result.status,cache,logs};
 }finally{fs.closeSync(fd);if(finished)fs.unlinkSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('MRT worker failed; shared admission must stay closed\n');process.exitCode=1;});
