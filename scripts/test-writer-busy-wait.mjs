import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrokerClient} from '../src/lib/writer-broker-client.mjs';

const input={requestId:'a'.repeat(40),expectedBase:'b'.repeat(40),entries:[]};
const busy=()=>new Response(JSON.stringify({code:'PUBLICATION_BUSY'}),{status:409});
function fixture(sequence){
 let now=0;const calls=[];
 const invoke=createBrokerClient({url:'http://127.0.0.1/',token:'fixture',timeoutMs:20,busyTimeoutMs:100,pollMs:10,
  clock:()=>now,sleep:async ms=>{now+=ms;},onDiagnostic:()=>{},request:async(_url,options)=>{
   calls.push(options);const next=sequence[Math.min(calls.length-1,sequence.length-1)];
   if(next instanceof Error)throw next;return next();
  }});
 return {invoke,calls,elapsed:()=>now};
}
test('typed local busy waits beyond transport timeout, then publishes identical bytes and identity',async()=>{
 const f=fixture([busy,busy,busy,()=>new Response(JSON.stringify({result:{commitSha:'c'.repeat(40)}}))]);
 assert.deepEqual(await f.invoke('commit',input),{commitSha:'c'.repeat(40)});
 assert.equal(f.elapsed(),30);assert.equal(f.calls.length,4);
 assert.equal(new Set(f.calls.map(c=>c.body)).size,1);
 assert.equal(new Set(f.calls.map(c=>c.headers['x-publication-id'])).size,1);
});
test('busy wait is bounded and preserves a known pre-mutation refusal and the request identity',async()=>{
 const f=fixture([busy]);
 await assert.rejects(f.invoke('commit',input),e=>e.code==='PUBLICATION_WAIT_EXPIRED'&&e.publicationOutcome==='refused'&&e.requestId===input.requestId&&!e.receiptAccepted);
 assert.equal(f.elapsed(),100);assert.equal(f.calls.length,10);
});
test('a transport failure after busy stays unknown and is not replayed',async()=>{
 const f=fixture([busy,Object.assign(Error('disconnect'),{code:'ECONNRESET'})]);
 await assert.rejects(f.invoke('commit',input),e=>e.code==='ECONNRESET'&&e.publicationOutcome==='unknown');
 assert.equal(f.calls.length,2);
});
for(const [name,response] of [
 ['opaque 409',()=>new Response('{}',{status:409})],
 ['invalid body',()=>new Response('not json',{status:409})],
 ['authentication refusal',()=>new Response(JSON.stringify({code:'PUBLICATION_BUSY'}),{status:401})],
 ['rate limit',()=>new Response(JSON.stringify({code:'PUBLICATION_BUSY'}),{status:429})],
 ['terminal busy receipt',()=>new Response(JSON.stringify({code:'PUBLICATION_BUSY'}),{status:409,headers:{'x-publication-state':'completed'}})],
])test(`${name} does not turn into a retry`,async()=>{
 const f=fixture([response]);await assert.rejects(f.invoke('commit',input));assert.equal(f.calls.length,1);
});
