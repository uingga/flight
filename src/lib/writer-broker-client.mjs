import {requestHttp} from './naver-http-request.mjs';
import {randomUUID} from 'node:crypto';
import {encodeRelayWire,decodeRelayWire} from './writer-relay-wire.mjs';
import {publicationDiagnostic} from './writer-publication-diagnostics.mjs';
export const WRITER_BROKER_TIMEOUT_MS=60000;
export function createBrokerClient({url,token,timeoutMs=WRITER_BROKER_TIMEOUT_MS,pollMs=2000,request=requestHttp,clock=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onDiagnostic=value=>console.error(JSON.stringify(value))}){
 if(typeof token!=='string'||!token.trim())throw Error('broker authentication missing');
 const u=new URL(url),local=['127.0.0.1','[::1]'].includes(u.hostname);
 if(u.username||u.password||!['/','/api/writer/'].includes(u.pathname)||u.search||u.hash||(!local&&u.protocol!=='https:'))throw Error('broker origin refused');
 const web=u.pathname==='/api/writer/';
 return async(action,input={})=>{
  const id=input.requestId||randomUUID(),body=JSON.stringify({...input,action,...(web?{relayIssuedAt:input.relayIssuedAt||new Date().toISOString()}:{})}),deadline=clock()+timeoutMs;
  // Freeze both identity and wire bytes. Repeating submit reads the existing durable
  // receipt; it must never create a new request or refresh relayIssuedAt on error.
  const wire=web?encodeRelayWire(body):body;
  let accepted=false,lastCode=null,lastStatus=null,attempt=0;
  const failure=(code,status,outcome)=>Object.assign(new Error(outcome==='unknown'?'publication outcome unknown; preserve receipt, never fallback push':'broker publication refused'),{code,httpStatus:status,requestId:id,publicationOutcome:outcome,receiptAccepted:accepted,lastCode,lastHttpStatus:lastStatus});
  do {
   attempt++;
   let r;
   try{
    r=await request(new URL('publication',u),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-publication-id':id},body:wire,loopbackOnly:local,timeoutMs:Math.max(1,Math.min(web?15000:timeoutMs,deadline-clock())),maxBytes:web?3*1024*1024:32*1024*1024});
   }catch(error){
    lastCode=error?.code||'WRITER_TRANSPORT_ERROR';lastStatus=null;
    // Direct broker actions are not all idempotent. Only the durable relay can retry.
    if(!web||['HTTP_REDIRECT_REFUSED','HTTP_RESPONSE_TOO_LARGE'].includes(lastCode))throw failure(lastCode,null,'unknown');
   }
   if(r){
    lastStatus=r.status;
    if(r.status===202){accepted=true;}
    else if(r.ok){
     try{const payload=web?JSON.parse(decodeRelayWire(await r.text())):await r.json();if(!Object.hasOwn(payload||{},'result'))throw Error('missing result');return payload.result;}
     catch{lastCode='WRITER_RESPONSE_INVALID';if(!web)throw failure(lastCode,r.status,'unknown');}
    }else{
     const completed=r.headers.get('x-publication-state')==='completed';
     const rejected=r.headers.get('x-publication-state')==='rejected';
     // Old relay versions returned an untyped 409 for DB/transport errors too.
     // Never label those as definite rejection. Retry only the identical receipt.
     const transient=web&&!completed&&!rejected&&(r.status===409||r.status===408||[500,502,503,504].includes(r.status));
     lastCode=completed?'WRITER_PUBLICATION_REFUSED':transient?'WRITER_RELAY_UNAVAILABLE':'WRITER_HTTP_REFUSED';
     if(!transient)throw failure(lastCode,r.status,completed||!accepted?'refused':'unknown');
    }
   }
   if(!r||r.status!==202){
    try{onDiagnostic({...publicationDiagnostic(failure(lastCode,lastStatus,'unknown')),event:'writer-publication-recheck',attempt});}catch{/* Diagnostics must not change the publication outcome. */}
   }
   const remaining=deadline-clock();
   if(remaining>0)await sleep(Math.min(pollMs,remaining));
  }while(clock()<deadline);
  throw failure('WRITER_OUTCOME_UNKNOWN',lastStatus,'unknown');
 };
}
export function brokerPublication(invoke,identity){
 let lease=null;
 const call=(action,input={})=>invoke(action,{...input,identity,lease});
 return {attachFence(){},setLease(value){lease=value;},readInputs:includeSelection=>call('readInputs',{includeSelection}),assertInput:ref=>call('assertInput',{ref}),publish:value=>call('publish',value),assertPublished:()=>call('assertPublished'),publishTodayPick:pick=>call('publishTodayPick',{pick})};
}
