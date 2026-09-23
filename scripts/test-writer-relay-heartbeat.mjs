import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {deliverPublication} from '../src/lib/writer-relay-agent.mjs';
import {createRelayHandler} from '../src/lib/writer-relay-handler.mjs';
import {createRelayWebHandler} from '../src/lib/writer-relay-web.mjs';
import {encodeRelayWire,decodeRelayWire} from '../src/lib/writer-relay-wire.mjs';

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
test('definite completion rejection preserves the claim without retrying publication',async()=>{
 const f=fixture({completeStatuses:[409]});
 await assert.rejects(deliverPublication(f.options),error=>error.httpStatus===409);
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
