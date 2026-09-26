import {requestHttp} from './naver-http-request.mjs';
import {WRITER_FILES} from './writer-broker.mjs';
import {encodeRelayWire,decodeRelayWire} from './writer-relay-wire.mjs';
// Deliberately excludes error messages, request bodies and credentials.
export function relayFailureDiagnostic(error){
 const stages=['claim','heartbeat','complete','publication'];
 const codes=['HTTP_TIMEOUT','HTTP_NETWORK_ERROR','HTTP_RESPONSE_TOO_LARGE','HTTP_REDIRECT_REFUSED','RELAY_CLAIM_LOST'];
 return {event:'relay-delivery-failed',stage:stages.includes(error?.relayStage)?error.relayStage:'unknown',
  role:Object.keys(WRITER_FILES).includes(error?.relayRole)||error?.relayRole==='deploy'?error.relayRole:null,
  requestId:/^[a-zA-Z0-9-]{16,80}$/.test(error?.relayRequestId||'')?error.relayRequestId:null,
  code:codes.includes(error?.code)?error.code:null,
  httpStatus:Number.isInteger(error?.httpStatus)&&error.httpStatus>=100&&error.httpStatus<=599?error.httpStatus:null,
  claimedRequestReplayed:false};
}
// One outbound delivery. Transport loss leaves the durable relay claim unresolved.
export async function deliverPublication({relayUrl,agentToken,publicationHandler,secrets,request=requestHttp,heartbeatMs=30000,completionRetryMs=900000,completionPollMs=5000,clock=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const url=new URL(relayUrl),local=['127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||!['/','/api/writer/'].includes(url.pathname)||url.search||url.hash||(!local&&url.protocol!=='https:'))throw Error('relay origin refused');
 const web=url.pathname==='/api/writer/';
 const call=async(path,body)=>{
  try{
  const raw=JSON.stringify(body);
  const response=await request(new URL(path.slice(1),url),{method:'POST',headers:{authorization:`Bearer ${agentToken}`,'content-type':'application/json'},body:web?encodeRelayWire(raw):raw,loopbackOnly:local,maxBytes:web?3*1024*1024:32*1024*1024});
  if(!response.ok)throw Object.assign(Error('relay communication refused'),{httpStatus:response.status});return (web?JSON.parse(decodeRelayWire(await response.text())):await response.json()).result;
  }catch(error){error.relayStage=path.split('/').at(-1);error.relayRequestId=body.id;error.relayRole=body.role;throw error;}
 };
 const item=await call('/delivery/claim',{});if(!item)return false;
 if(![...Object.keys(WRITER_FILES),'deploy'].includes(item.role)||!secrets[item.role])throw Error('delivery role refused');
 const identity={role:item.role,id:item.id,claim:item.claim};
 let heartbeat=null;
 const pulse=()=>heartbeat ||= call('/delivery/heartbeat',identity).then(value=>{
  if(value!==true)throw Object.assign(Error('delivery claim no longer active'),{code:'RELAY_CLAIM_LOST',relayStage:'heartbeat'});
 }).finally(()=>{heartbeat=null;});
 // One heartbeat at a time. Transport errors leave the durable claim intact;
 // the final pulse must succeed before completion can be acknowledged.
 const timer=web?setInterval(()=>{void pulse().catch(()=>{});},heartbeatMs):null;
 timer?.unref?.();
 try{
  const response=await publicationHandler(new Request('http://127.0.0.1/publication',{method:'POST',headers:{authorization:`Bearer ${secrets[item.role]}`},body:item.body}));
  // Completion is idempotent for the same claim and response. Retry only its
  // acknowledgement; never run the publication handler or claim another job.
  const completion={...identity,response:{status:response.status===200?200:409,body:await response.text()}};
  const deadline=clock()+completionRetryMs;
  let verifiedClaim=!web;
  for(;;){
   try{
    // Keep the already produced response when the final heartbeat times out.
    // Once verified, repeat only complete: an acknowledged-but-lost completion
    // has state=done, so another heartbeat would incorrectly look like lost claim.
    if(!verifiedClaim){await pulse();verifiedClaim=true;}
    await call('/delivery/complete',completion);break;
   }
   catch(error){
    if(error.httpStatus&&![408,429,500,502,503,504].includes(error.httpStatus))throw error;
    if(['HTTP_REDIRECT_REFUSED','HTTP_RESPONSE_TOO_LARGE','RELAY_CLAIM_LOST'].includes(error.code))throw error;
    const remaining=deadline-clock();if(remaining<=0)throw error;
    await sleep(Math.min(completionPollMs,remaining));
   }
  }
  return true;
 }catch(error){
  error.relayStage ||= 'publication';error.relayRequestId=item.id;error.relayRole=item.role;throw error;
 }finally{
  if(timer)clearInterval(timer);
  if(heartbeat)await heartbeat.catch(()=>{});
 }
}
