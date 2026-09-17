import {requestHttp} from './naver-http-request.mjs';
import {randomUUID} from 'node:crypto';
import {encodeRelayWire,decodeRelayWire} from './writer-relay-wire.mjs';
export const WRITER_BROKER_TIMEOUT_MS=60000;
export function createBrokerClient({url,token,timeoutMs=WRITER_BROKER_TIMEOUT_MS,pollMs=250}){
 if(typeof token!=='string'||!token.trim())throw Error('broker authentication missing');
 const u=new URL(url),local=['127.0.0.1','[::1]'].includes(u.hostname);
 if(u.username||u.password||!['/','/api/writer/'].includes(u.pathname)||u.search||u.hash||(!local&&u.protocol!=='https:'))throw Error('broker origin refused');
 const web=u.pathname==='/api/writer/';
 return async(action,input={})=>{
  const id=input.requestId||randomUUID(),body=JSON.stringify({...input,action}),deadline=Date.now()+timeoutMs;
  do {
   const r=await requestHttp(new URL('publication',u),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-publication-id':id},body:web?encodeRelayWire(body):body,loopbackOnly:local,timeoutMs:Math.max(1,deadline-Date.now()),maxBytes:web?3*1024*1024:32*1024*1024});
   if(r.status!==202){if(!r.ok){const error=new Error('broker publication refused');error.httpStatus=r.status;throw error;}return (web?JSON.parse(decodeRelayWire(await r.text())):await r.json()).result;}
   await new Promise(resolve=>setTimeout(resolve,pollMs));
  }while(Date.now()<deadline);
  throw Error('publication outcome pending; reuse the same request identity, never fallback push');
 };
}
export function brokerPublication(invoke,identity){
 let lease=null;
 const call=(action,input={})=>invoke(action,{...input,identity,lease});
 return {attachFence(){},setLease(value){lease=value;},readInputs:includeSelection=>call('readInputs',{includeSelection}),assertInput:ref=>call('assertInput',{ref}),publish:value=>call('publish',value),assertPublished:()=>call('assertPublished'),publishTodayPick:pick=>call('publishTodayPick',{pick})};
}
