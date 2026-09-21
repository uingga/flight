import {assertMode} from './naver-coordination-contract.mjs';
import {createRelayHandler,authenticateRelay} from './writer-relay-handler.mjs';
import {createSupabasePublicationQueue} from './writer-relay-supabase.mjs';
import {decodeRelayWire,encodeRelayWire,WIRE_LIMIT} from './writer-relay-wire.mjs';
export function createRelayWebHandler(options){
 const handle=createRelayHandler(options);
 return async request=>{
  try{
   const url=new URL(request.url),suffix=url.pathname.slice('/api/writer'.length);
   if(!url.pathname.startsWith('/api/writer/')||!['/publication','/delivery/claim','/delivery/heartbeat','/delivery/complete'].includes(suffix))return new Response('{}',{status:404});
   if(!authenticateRelay(request,options.secrets,options.agentToken))return new Response('{}',{status:401});
   // Authenticate before decompression, then recheck before any DB transaction.
   const reader=request.body?.getReader();let length=0;const chunks=[];
   if(reader)while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>WIRE_LIMIT){await reader.cancel();throw Error('wire limit');}chunks.push(part.value);}
   const body=decodeRelayWire(Buffer.concat(chunks).toString('utf8'));
   const response=await handle(new Request('http://127.0.0.1'+suffix,{method:request.method,headers:request.headers,body}));
   const headers={'content-type':'application/json','cache-control':'no-store'};
   if(response.headers.has('x-publication-state'))headers['x-publication-state']=response.headers.get('x-publication-state');
   try{return new Response(encodeRelayWire(await response.text()),{status:response.status,headers});}
   catch{return new Response('{}',{status:503,headers:{'x-publication-state':'unknown','cache-control':'no-store'}});}
  }catch{return new Response('{}',{status:409,headers:{'x-publication-state':'rejected'}});}
 };
}
export async function configuredRelayWeb(request,env=process.env){
 try{
  if(!assertMode(env))throw Error('disabled');
  const secrets=JSON.parse(env.TIKIT_WRITER_RELAY_SECRETS_JSON||'null');
  const queue=createSupabasePublicationQueue({url:env.SUPABASE_URL,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY});
  return await createRelayWebHandler({queue,secrets,agentToken:env.TIKIT_WRITER_RELAY_AGENT_TOKEN})(request);
 }catch{return new Response('{}',{status:503,headers:{'cache-control':'no-store'}});}
}
