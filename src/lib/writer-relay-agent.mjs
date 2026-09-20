import {requestHttp} from './naver-http-request.mjs';
import {WRITER_FILES} from './writer-broker.mjs';
import {encodeRelayWire,decodeRelayWire} from './writer-relay-wire.mjs';
// One outbound delivery. Transport loss leaves the durable relay claim unresolved.
export async function deliverPublication({relayUrl,agentToken,publicationHandler,secrets,request=requestHttp,heartbeatMs=30000}){
 const url=new URL(relayUrl),local=['127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||!['/','/api/writer/'].includes(url.pathname)||url.search||url.hash||(!local&&url.protocol!=='https:'))throw Error('relay origin refused');
 const web=url.pathname==='/api/writer/';
 const call=async(path,body)=>{
  const raw=JSON.stringify(body);
  const response=await request(new URL(path.slice(1),url),{method:'POST',headers:{authorization:`Bearer ${agentToken}`,'content-type':'application/json'},body:web?encodeRelayWire(raw):raw,loopbackOnly:local,maxBytes:web?3*1024*1024:32*1024*1024});
  if(!response.ok)throw Error('relay communication refused');return (web?JSON.parse(decodeRelayWire(await response.text())):await response.json()).result;
 };
 const item=await call('/delivery/claim',{});if(!item)return false;
 if(![...Object.keys(WRITER_FILES),'deploy'].includes(item.role)||!secrets[item.role])throw Error('delivery role refused');
 const identity={role:item.role,id:item.id,claim:item.claim};
 let heartbeat=null;
 const pulse=()=>heartbeat ||= call('/delivery/heartbeat',identity).then(value=>{
  if(value!==true)throw Error('delivery claim no longer active');
 }).finally(()=>{heartbeat=null;});
 // One heartbeat at a time. Transport errors leave the durable claim intact;
 // the final pulse must succeed before completion can be acknowledged.
 const timer=web?setInterval(()=>{void pulse().catch(()=>{});},heartbeatMs):null;
 timer?.unref?.();
 try{
  const response=await publicationHandler(new Request('http://127.0.0.1/publication',{method:'POST',headers:{authorization:`Bearer ${secrets[item.role]}`},body:item.body}));
  if(timer)clearInterval(timer);
  if(web)await pulse();
  await call('/delivery/complete',{...identity,response:{status:response.status===200?200:409,body:await response.text()}});
  return true;
 }finally{
  if(timer)clearInterval(timer);
  if(heartbeat)await heartbeat.catch(()=>{});
 }
}
