import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {deliverPublication,relayFailureDiagnostic} from '../src/lib/writer-relay-agent.mjs';
import {createRelayHandler} from '../src/lib/writer-relay-handler.mjs';
import {createRelayWebHandler} from '../src/lib/writer-relay-web.mjs';
import {encodeRelayWire,decodeRelayWire} from '../src/lib/writer-relay-wire.mjs';
import {listenRelay} from './start-writer-relay.mjs';

const item={role:'daily',id:'fixture-request-0001',claim:'fixture-claim',body:'{"action":"commit"}'};
function fixture({heartbeatResult=true,handlerError=false,completeStatuses=[]}={}){
 let inFlight=0,maxInFlight=0,publications=0,completions=0;
 const calls=[];
 return {
  calls,maxInFlight:()=>maxInFlight,publications:()=>publications,
  options:{relayUrl:'http://127.0.0.1/api/writer/',agentToken:'fixture-agent',secrets:{daily:'fixture-daily'},heartbeatMs:5,
   publicationHandler:async()=>{publications++;await delay(35);if(handlerError)throw Error('publication uncertain');return new Response('{"result":{}}');},
   request:async(url,options)=>{
    const input=JSON.parse(decodeRelayWire(options.body));
    calls.push(url.pathname);
    let result=true;
    if(url.pathname.endsWith('/claim'))result=item;
    if(url.pathname.endsWith('/heartbeat')){
     assert.deepEqual(input,{role:item.role,id:item.id,claim:item.claim});
     maxInFlight=Math.max(maxInFlight,++inFlight);await delay(12);inFlight--;result=heartbeatResult;
    }
    if(url.pathname.endsWith('/complete')){
     assert.equal(input.response.status,200);
     const status=completeStatuses[completions++]??200;
     if(status!==200)return new Response('{}',{status});
    }
    return new Response(encodeRelayWire(JSON.stringify({result})));
   }
  }
 };
}
test('active publication heartbeats without overlapping requests, then completes once',async()=>{
 const f=fixture();assert.equal(await deliverPublication(f.options),true);
 assert.equal(f.maxInFlight(),1);
 assert.ok(f.calls.filter(p=>p.endsWith('/heartbeat')).length>=2);
 assert.equal(f.calls.filter(p=>p.endsWith('/claim')).length,1);
 assert.equal(f.calls.filter(p=>p.endsWith('/complete')).length,1);
 const count=f.calls.length;await delay(20);assert.equal(f.calls.length,count);
});
test('transient completion failure retries the same receipt without republishing',async()=>{
 const f=fixture({completeStatuses:[503,503,200]});
 f.options.completionPollMs=20;
 assert.equal(await deliverPublication(f.options),true);
 assert.equal(f.publications(),1);
 assert.equal(f.calls.filter(p=>p.endsWith('/claim')).length,1);
 assert.equal(f.calls.filter(p=>p.endsWith('/complete')).length,3);
 const firstCompletion=f.calls.findIndex(p=>p.endsWith('/complete'));
 assert.ok(f.calls.slice(firstCompletion+1).some(p=>p.endsWith('/heartbeat')));
});

for(const failure of ['HTTP_TIMEOUT',503])test(`final heartbeat ${failure} retries acknowledgement, not publication`,async()=>{
 const f=fixture();let failed=false;
 const request=f.options.request;
 f.options.heartbeatMs=60000;
 f.options.completionPollMs=1;
 f.options.request=async(url,options)=>{
  if(url.pathname.endsWith('/heartbeat')&&!failed){
   failed=true;
   if(typeof failure==='number')return new Response('{}',{status:failure});
   throw Object.assign(Error('synthetic timeout'),{code:failure});
  }
  return request(url,options);
 };
 assert.equal(await deliverPublication(f.options),true);
 assert.equal(f.publications(),1);
 assert.equal(f.calls.filter(p=>p.endsWith('/claim')).length,1);
 assert.equal(f.calls.filter(p=>p.endsWith('/complete')).length,1);
});
test('definite completion rejection preserves the claim without retrying publication',async()=>{
 const f=fixture({completeStatuses:[409]});
 await assert.rejects(deliverPublication(f.options),error=>{
  assert.deepEqual(relayFailureDiagnostic(error),{event:'relay-delivery-failed',stage:'complete',role:'daily',requestId:item.id,code:null,httpStatus:409,claimedRequestReplayed:false});return true;
 });
 assert.equal(f.publications(),1);
 assert.equal(f.calls.filter(p=>p.endsWith('/complete')).length,1);
});
test('lost claim cannot be acknowledged or claimed a second time',async()=>{
 const f=fixture({heartbeatResult:false});await assert.rejects(deliverPublication(f.options),/no longer active/);
 assert.equal(f.calls.filter(p=>p.endsWith('/complete')).length,0);
 assert.equal(f.calls.filter(p=>p.endsWith('/claim')).length,1);
});
test('publication error stops heartbeats and preserves the uncertain claim',async()=>{
 const f=fixture({handlerError:true});await assert.rejects(deliverPublication(f.options),/publication uncertain/);
 const count=f.calls.length;await delay(20);assert.equal(f.calls.length,count);
 assert.equal(f.calls.filter(p=>p.endsWith('/complete')).length,0);
});
test('only the existing delivery-agent token can heartbeat',async()=>{
 let beats=0;
 const handler=createRelayHandler({queue:{heartbeat:async()=>{beats++;return true;}},secrets:{daily:'fixture-daily'},agentToken:'fixture-agent'});
 for(const token of ['fixture-daily','invalid']){
  const result=await handler(new Request('http://localhost/delivery/heartbeat',{method:'POST',headers:{authorization:'Bearer '+token},body:'{}'}));
  assert.equal(result.status,401);
 }
 const result=await handler(new Request('http://localhost/delivery/heartbeat',{method:'POST',headers:{authorization:'Bearer fixture-agent'},body:'{}'}));
 assert.equal(result.status,200);assert.equal(beats,1);
});

test('web transport routes authenticated heartbeats through the same durable claim',async()=>{
 let claims=0,beats=0,completes=0;const identity={role:item.role,id:item.id,claim:item.claim};
 const handler=createRelayWebHandler({agentToken:'fixture-agent',secrets:{daily:'fixture-daily'},queue:{
  claim:async()=>{claims++;return item;},heartbeat:async input=>{assert.deepEqual(input,identity);beats++;return true;},complete:async input=>{assert.equal(input.claim,item.claim);assert.equal(input.response.status,200);completes++;}
 }});
 for(const token of ['fixture-daily','invalid'])assert.equal((await handler(new Request('http://localhost/api/writer/delivery/heartbeat',{method:'POST',headers:{authorization:'Bearer '+token},body:encodeRelayWire(JSON.stringify(identity))}))).status,401);
 await deliverPublication({relayUrl:'http://127.0.0.1/api/writer/',agentToken:'fixture-agent',secrets:{daily:'fixture-daily'},heartbeatMs:5,
  publicationHandler:async()=>{await delay(25);return Response.json({result:{ref:'fixture-ref'}});},request:async(url,options)=>handler(new Request(url,options))});
 assert.equal(claims,1);assert.ok(beats>=2);assert.equal(completes,1);
 assert.equal((await handler(new Request('http://localhost/api/writer/delivery/unknown',{method:'POST',headers:{authorization:'Bearer fixture-agent'},body:encodeRelayWire('{}')}))).status,404);
});

test('failure diagnostic never includes private error messages, bodies or arbitrary codes',()=>{
 const result=relayFailureDiagnostic({message:'private',body:'private',stack:'private',code:'private',relayRole:'private',relayStage:'private',relayRequestId:'private',httpStatus:999});
 assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(result.stage,'unknown');
});

for(const stage of ['heartbeat','complete'])test(`real HTTP ${stage} DB timeout preserves the response and finishes once`,async()=>{
 let attempts=0,publications=0,claims=0,completed=0;
 const queue={claim:async()=>{claims++;return item;},heartbeat:async()=>true,complete:async()=>{completed++;}};
 const success=queue[stage];queue[stage]=async input=>{if(++attempts===1)throw Error('synthetic private database timeout');return success(input);};
 const server=await listenRelay({handler:createRelayWebHandler({agentToken:'fixture-agent',secrets:{daily:'fixture-daily'},queue})});
 try{
  await deliverPublication({relayUrl:server.url+'/api/writer/',agentToken:'fixture-agent',secrets:{daily:'fixture-daily'},heartbeatMs:60000,completionPollMs:1,completionRetryMs:1000,
   publicationHandler:async()=>{publications++;return Response.json({result:{commitSha:'a'.repeat(40)}});}});
  assert.equal(attempts,2);assert.equal(publications,1);assert.equal(claims,1);assert.equal(completed,1);
 }finally{await server.close();}
});
