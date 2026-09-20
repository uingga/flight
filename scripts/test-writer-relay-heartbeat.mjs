import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {deliverPublication} from '../src/lib/writer-relay-agent.mjs';
import {createRelayHandler} from '../src/lib/writer-relay-handler.mjs';
import {encodeRelayWire,decodeRelayWire} from '../src/lib/writer-relay-wire.mjs';

const item={role:'daily',id:'fixture-request-0001',claim:'fixture-claim',body:'{"action":"commit"}'};
function fixture({heartbeatResult=true,handlerError=false}={}){
 let inFlight=0,maxInFlight=0;
 const calls=[];
 return {
  calls,maxInFlight:()=>maxInFlight,
  options:{relayUrl:'http://127.0.0.1/api/writer/',agentToken:'fixture-agent',secrets:{daily:'fixture-daily'},heartbeatMs:5,
   publicationHandler:async()=>{await delay(35);if(handlerError)throw Error('publication uncertain');return new Response('{"result":{}}');},
   request:async(url,options)=>{
    const input=JSON.parse(decodeRelayWire(options.body));
    calls.push(url.pathname);
    let result=true;
    if(url.pathname.endsWith('/claim'))result=item;
    if(url.pathname.endsWith('/heartbeat')){
     assert.deepEqual(input,{role:item.role,id:item.id,claim:item.claim});
     maxInFlight=Math.max(maxInFlight,++inFlight);await delay(12);inFlight--;result=heartbeatResult;
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
