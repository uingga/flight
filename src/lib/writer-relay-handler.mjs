import {timingSafeEqual} from 'node:crypto';
import {WRITER_FILES} from './writer-broker.mjs';
const match=(header,secret)=>{
 if(typeof secret!=='string'||!secret)return false;
 const a=Buffer.from(header||''),b=Buffer.from('Bearer '+secret);
 return a.length===b.length&&timingSafeEqual(a,b);
};
export function authenticateRelay(request,secrets,agentToken){
 return new URL(request.url).pathname.includes('/delivery/')
  ? (match(request.headers.get('authorization'),agentToken)?'relay-agent':null)
  : Object.keys(secrets).find(r=>match(request.headers.get('authorization'),secrets[r]))||null;
}
// No SQLite import: usable inside stateless Node route handlers.
export function createRelayHandler({queue,secrets,agentToken}){
 const roles=[...Object.keys(WRITER_FILES),'deploy'];
 const values=[agentToken,...Object.values(secrets)];
 if(values.some(x=>typeof x!=='string'||!x)||new Set(values).size!==values.length||Object.keys(secrets).some(r=>!roles.includes(r)))throw Error('invalid relay credentials');
 const queueCall=async callback=>{
  try{return Response.json({result:await callback()});}
  // A DB/transport timeout is not a malformed request or proof of rejection.
  // The same claim/response may be acknowledged again; never redo publication.
  catch{return Response.json({error:'RELAY_QUEUE_UNAVAILABLE'},{status:503,headers:{'x-publication-state':'unknown'}});}
 };
 return async request=>{
  const path=new URL(request.url).pathname;
  try{
   if(request.method!=='POST')return new Response('{}',{status:405});
   const role=authenticateRelay(request,secrets,agentToken);
   if(!role)return new Response('{}',{status:401});
   const raw=await request.text();if(Buffer.byteLength(raw)>24*1024*1024)throw Error('payload limit');
   const input=JSON.parse(raw||'{}');
   if(path==='/delivery/claim')return queueCall(()=>queue.claim());
   if(path==='/delivery/heartbeat')return queueCall(()=>queue.heartbeat(input));
   if(path==='/delivery/complete'){
    if(!input.response||![200,409].includes(input.response.status)||typeof input.response.body!=='string'||Buffer.byteLength(input.response.body)>24*1024*1024)throw Error('invalid completion');
    return queueCall(async()=>{await queue.complete(input);return true;});
   }
   if(path!=='/publication'||!['readInputs','commit','deploy'].includes(input.action)||((input.action==='deploy')!==(role==='deploy')))throw Error('relay action refused');
   const id=request.headers.get('x-publication-id');
   if(typeof id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(id)||(input.action!=='readInputs'&&input.requestId!==id))throw Error('request identity required');
   let row;
   try{row=await queue.submit(role,id,raw);}
   catch{return Response.json({error:'RELAY_QUEUE_UNAVAILABLE'},{status:503,headers:{'x-publication-state':'unknown'}});}
   if(row.state!=='done')return Response.json({pending:true},{status:202});
   try{
    const result=typeof row.response==='string'?JSON.parse(row.response):row.response;
    if(![200,409].includes(result?.status)||typeof result?.body!=='string')throw Error('invalid saved receipt');
    return new Response(result.body,{status:result.status,headers:{'content-type':'application/json','x-publication-state':'completed'}});
   }catch{return Response.json({error:'RELAY_RECEIPT_UNAVAILABLE'},{status:503,headers:{'x-publication-state':'unknown'}});}
  }catch{return new Response('{}',{status:409,headers:{'x-publication-state':'rejected'}});}
 };
}
