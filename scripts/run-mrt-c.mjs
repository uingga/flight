import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createBrokerClient} from '../src/lib/writer-broker-client.mjs';
import {fileURLToPath} from 'node:url';
import {installationTokenProvider} from '../src/lib/writer-app-token.mjs';
import {githubMrtClient} from '../src/lib/myrealtrip-schedule.mjs';
import {acquireMrt,assertMrtOwner,releaseMrt} from '../src/lib/mrt-shared-admission.mjs';
import {mergeCacheSource} from '../src/lib/merge-cache-source.mjs';
import {mergeCrawlLogHistories} from './merge-crawl-log.mjs';
import {mrtPcTarget} from '../src/lib/mrt-round-readiness.mjs';

export function cSlot(now=Date.now()) {
 const target=mrtPcTarget(now);
 return target?.host==='C'?target.slot:null;
}
export async function readMrtJson(api,file,ref){
 let r=await api('contents/data/'+file+'?ref='+ref);
 if(r.status!==200)throw Error('input unavailable');
 if(r.data.encoding==='none'){
  if(!/^[a-f0-9]{40}$/.test(r.data.sha))throw Error('invalid input blob');
  r=await api('git/blobs/'+r.data.sha);
 }
 if(r.status!==200||typeof r.data.content!=='string'||!r.data.content)throw Error('input content unavailable');
 return JSON.parse(Buffer.from(r.data.content,'base64').toString());
}
export function configuredMrtWriter(env=process.env,broker){
 const mode=env.NAVER_COORDINATION||'0';
 if(!['0','1'].includes(mode))throw Error('invalid writer mode');
 if(mode==='0'&&Object.entries(env).some(([k,v])=>v&&(k.startsWith('NAVER_COORDINATION_')||k.startsWith('TIKIT_WRITER_'))))throw Error('partial coordinated writer configuration');
 return mode==='1'?(broker||createBrokerClient({url:env.TIKIT_WRITER_URL,
  token:env.TIKIT_WRITER_TOKEN||fs.readFileSync(env.TIKIT_WRITER_TOKEN_FILE,'utf8').trim()})):null;
}
export async function publishMrtResult(api,ticket,reply,{env=process.env,broker}={}){
 const invoke=configuredMrtWriter(env,broker);
 const required=async(p,m,b)=>{const r=await api(p,m,b);if(r.status<200||r.status>=300)throw Error('MRT publication failed');return r.data;};
 const read=(file,ref)=>readMrtJson(api,file,ref);
 for(let attempt=0;attempt<5;attempt++){
  await assertMrtOwner(api,ticket);
  const base=(await required('git/ref/heads/main')).object.sha;
  const cache=mergeCacheSource(await read('all-flights-cache.json',base),reply.cache,'myrealtrip');
  const logs=mergeCrawlLogHistories(await read('crawl-log.json',base),reply.logs,['myrealtrip']).history;
  if(invoke){
   const entries=[['data/all-flights-cache.json',cache],['data/crawl-log.json',logs]];
   const requestId=createHash('sha256').update(JSON.stringify({owner:ticket.owner,base,entries})).digest('hex');
   await assertMrtOwner(api,ticket);
   const result=await invoke('commit',{expectedBase:base,requestId,entries});
   if(!/^[a-f0-9]{40}$/.test(result?.commitSha||''))throw Error('invalid broker result');
   const observed=await read('all-flights-cache.json',result.commitSha);
   if(JSON.stringify(observed)!==JSON.stringify(cache))throw Error('MRT publication readback mismatch');
   return result.commitSha;
  }
  const parent=await required('git/commits/'+base);
  const tree=await required('git/trees','POST',{base_tree:parent.tree.sha,tree:[
   {path:'data/all-flights-cache.json',mode:'100644',type:'blob',content:JSON.stringify(cache)},
   {path:'data/crawl-log.json',mode:'100644',type:'blob',content:JSON.stringify(logs)},
  ]});
  const commit=await required('git/commits','POST',{message:'chore(data): C MyRealTrip scheduled result',tree:tree.sha,parents:[base]});
  await assertMrtOwner(api,ticket);
  const update=await api('git/refs/heads/main','PATCH',{sha:commit.sha,force:false});
  if([409,422].includes(update.status))continue;
  if(update.status!==200||update.data.object?.sha!==commit.sha)throw Error('MRT publication unknown');
  const observed=await read('all-flights-cache.json',commit.sha);
  if(JSON.stringify(observed)!==JSON.stringify(cache))throw Error('MRT publication readback mismatch');
  return commit.sha;
 }
 throw Error('MRT publication contention; preserve result and lock');
}
async function main(){
 if(process.argv[2]!=='--scheduled')throw Error('scheduled mode required');
 const target=mrtPcTarget(),slot=target?.slot;
 if(!target){console.log('outside eligible slot; no requests');return;}
 const broker=configuredMrtWriter();
 if(broker)await broker('readInputs'); // Verify scoped authentication before admission or collection.
 const token=installationTokenProvider({appId:4952321,installationId:161894104,repository:'uingga/flight',
  privateKey:fs.readFileSync(path.join(os.homedir(),'AppData/Local/Tikitikit/publisher-auth/github-app.private-key.pem'),'utf8')});
 const api=githubMrtClient(token);
 const head=await api('git/ref/heads/main');if(head.status!==200)throw Error('main unavailable');
 const ticket=await acquireMrt(api,{slot,host:target.host,sha:head.data.object.sha});if(!ticket){console.log('shared admission busy or slot spent');return;}
 const id=randomUUID(),dir=path.join(os.homedir(),'AppData/Local/Tikitikit/mrt-dispatch',id);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'ticket.json'),JSON.stringify(ticket));
 const current=await api('git/ref/heads/main');if(current.status!==200)throw Error('inputs unavailable');
 const files={};for(const name of ['all-flights-cache.json','interpark-prices.json','crawl-log.json','gid-map.json']){
  files[name]=await readMrtJson(api,name,current.data.object.sha);
 }
 const circuit=files['all-flights-cache.json'].sourceCircuits?.myrealtrip;
 if(circuit&&(!Number.isFinite(Date.parse(circuit.nextProbeAt))||Date.parse(circuit.nextProbeAt)>Date.now())){
  await releaseMrt(api,ticket);console.log('shared source circuit open; no requests');return;
 }
 await assertMrtOwner(api,ticket);
 const request={protocol:'mrt-c-v1',id,slot,createdAt:new Date().toISOString(),files};
 const reply=await new Promise((resolve,reject)=>{
  const args=target.host==='B'?['-o','BatchMode=yes','-o','ConnectTimeout=15','-o','StrictHostKeyChecking=yes','tikitikit-pc-b',
   'node C:/Users/ynal/AppData/Local/Tikitikit/agency-evening-v2/scripts/mrt-c-worker.mjs --scheduled']:['-F','NUL','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','GlobalKnownHostsFile=NUL',
   '-o','UserKnownHostsFile=C:/Users/ynal/AppData/Local/Temp/tikitikit-ssh-setup-20260915/known_hosts_c',
   '-i','C:/Users/ynal/.ssh/tikitikit_a_to_c_ed25519','ynal@100.87.173.95',
   'C:/Users/ynal/AppData/Local/hermes/node/node.exe C:/Users/ynal/AppData/Local/Tikitikit/agency-evening-v2/scripts/mrt-c-worker.mjs --scheduled'];
  const child=spawn('ssh.exe',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let bytes=0;const chunks=[];
  const timer=setTimeout(()=>{child.kill();reject(Error('remote completion unknown'));},185*60000);
  child.on('error',()=>{clearTimeout(timer);reject(Error('remote transport failed'));});child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
  child.stdout.on('data',c=>{bytes+=c.length;if(bytes>20000000){child.kill();return;}chunks.push(c);});
  child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw Error();resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(Error('invalid worker result'));}});
  child.stdin.end(JSON.stringify(request));
 });
 if(reply.protocol!=='mrt-c-v1'||reply.id!==id||reply.slot!==slot||![0,1].includes(reply.exitCode)||!reply.logs||!Array.isArray(reply.cache?.flights))throw Error('unverified worker result');
 fs.writeFileSync(path.join(dir,'reply.json'),JSON.stringify(reply));
 const commit=await publishMrtResult(api,ticket,reply,{broker});fs.writeFileSync(path.join(dir,'published.json'),JSON.stringify({commit}));
 // A fully published explicit circuit is shared by both hosts. Unknown failures retain ownership.
 if(reply.exitCode!==0 && !(Date.parse(reply.cache.sourceCircuits?.myrealtrip?.nextProbeAt)>Date.now()))
  throw Error('collector failed; result saved, shared admission retained');
 await releaseMrt(api,ticket);console.log(JSON.stringify({status:'published',slot,commit}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{console.error('MRT C run stopped; inspect persisted evidence before any retry');process.exitCode=1;});
