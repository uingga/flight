import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createBrokerClient} from '../src/lib/writer-broker-client.mjs';
import {createRelayWebHandler} from '../src/lib/writer-relay-web.mjs';
import {encodeRelayWire,decodeRelayWire} from '../src/lib/writer-relay-wire.mjs';
import {publicationDiagnostic,publicationFailureMessage} from '../src/lib/writer-publication-diagnostics.mjs';
import {requestHttp} from '../src/lib/naver-http-request.mjs';

const input={requestId:'a'.repeat(40),expectedBase:'b'.repeat(40),entries:[['data/crawl-log.json',{flights:[]}]]};
const published={commitSha:'c'.repeat(40)};
const response=(status,body={},state)=>new Response(encodeRelayWire(JSON.stringify(body)),{status,headers:state?{'x-publication-state':state}:{}});
function fixture(sequence,{local=false,timeoutMs=100}={}){
 let now=0;const calls=[],diagnostics=[];
 const invoke=createBrokerClient({url:local?'http://127.0.0.1/':'https://writer.example.invalid/api/writer/',token:'fixture-secret',timeoutMs,pollMs:10,
  clock:()=>now,sleep:async ms=>{now+=ms;},onDiagnostic:d=>diagnostics.push(d),request:async(url,options)=>{
   calls.push({url:String(url),...options});const next=sequence[Math.min(calls.length-1,sequence.length-1)];
   if(next instanceof Error)throw next;return next();
  }});
 return {invoke,calls,diagnostics,elapsed:()=>now};
}

for(const [name,broken] of [
 ['connection reset',Object.assign(Error('secret server details'),{code:'ECONNRESET'})],
 ['gateway timeout',()=>response(504)],
 ['old untyped 409',()=>response(409)],
 ['truncated receipt',()=>new Response('not a relay envelope')],
])test(`accepted publication survives ${name} using identical receipt`,async()=>{
 const f=fixture([()=>response(202,{pending:true}),broken,()=>response(200,{result:published},'completed')]);
 assert.deepEqual(await f.invoke('commit',input),published);
 assert.equal(f.calls.length,3);
 assert.equal(new Set(f.calls.map(c=>c.body)).size,1);
 assert.equal(new Set(f.calls.map(c=>c.headers['x-publication-id'])).size,1);
 assert.equal(JSON.parse(decodeRelayWire(f.calls[0].body)).requestId,input.requestId);
 assert.equal(f.elapsed(),20);
 assert.equal(f.diagnostics.length,1);assert.equal(f.diagnostics[0].requestId,input.requestId);
 assert.ok(!JSON.stringify(f.diagnostics).includes('secret'));
});

test('lost first acknowledgement also reconciles the original identity',async()=>{
 const f=fixture([Object.assign(Error('lost response'),{code:'HTTP_TIMEOUT'}),()=>response(200,{result:published},'completed')]);
 assert.deepEqual(await f.invoke('commit',input),published);
 assert.equal(f.calls[0].body,f.calls[1].body);
});
test('mail incident replay: confirmation error at 20 seconds, durable success at 40 seconds',async()=>{
 let now=0,count=0;const bodies=[];
 const invoke=createBrokerClient({url:'https://writer.example.invalid/api/writer/',token:'fixture-secret',clock:()=>now,sleep:async ms=>{now+=ms;},onDiagnostic:()=>{},
  request:async(_url,options)=>{
   bodies.push(options.body);count++;
   if(count===1){now+=15000;return response(202);}
   if(count===2){now+=3000;return response(409);}
   return now>=40000?response(200,{result:published},'completed'):response(202);
  }});
 assert.deepEqual(await invoke('commit',input),published);assert.equal(now,40000);assert.equal(new Set(bodies).size,1);
});

for(const status of [401,403,413,429])test(`HTTP ${status} stops immediately, without another request`,async()=>{
 const f=fixture([()=>response(status)]);
 await assert.rejects(f.invoke('commit',input),e=>e.httpStatus===status&&e.publicationOutcome==='refused');
 assert.equal(f.calls.length,1);
});
for(const state of ['completed','rejected'])test(`explicit ${state} 409 is never retried`,async()=>{
 const f=fixture([()=>response(409,{},state)]);
 await assert.rejects(f.invoke('commit',input),e=>e.publicationOutcome==='refused'&&e.httpStatus===409);
 assert.equal(f.calls.length,1);
});
test('access denied while checking an accepted receipt stops, but does not prove publication failed',async()=>{
 const f=fixture([()=>response(202),()=>response(403)]);
 await assert.rejects(f.invoke('commit',input),e=>e.publicationOutcome==='unknown'&&e.httpStatus===403);
 assert.equal(f.calls.length,2);
});

test('bounded unresolved receipt stays unknown; never reports success or creates a new key',async()=>{
 const f=fixture([()=>response(202,{pending:true}),()=>response(503)],{timeoutMs:35});
 await assert.rejects(f.invoke('commit',input),e=>{
  assert.equal(e.code,'WRITER_OUTCOME_UNKNOWN');assert.equal(e.publicationOutcome,'unknown');
  assert.equal(e.lastHttpStatus,503);assert.equal(e.receiptAccepted,true);assert.equal(e.requestId,input.requestId);return true;
 });
 assert.equal(f.elapsed(),35);assert.equal(f.calls.length,4);
 assert.equal(new Set(f.calls.map(c=>c.body)).size,1);
});
test('legacy opaque 409 remains unknown, not definite refusal',async()=>{
 const f=fixture([()=>response(409)]);
 await assert.rejects(f.invoke('commit',input),e=>e.code==='WRITER_OUTCOME_UNKNOWN'&&e.receiptAccepted===false);
});
test('direct coordinator operations are never replayed on transport failure',async()=>{
 const f=fixture([Object.assign(Error('disconnect'),{code:'ECONNRESET'})],{local:true});
 await assert.rejects(f.invoke('publish',input),e=>e.code==='ECONNRESET');assert.equal(f.calls.length,1);
});
test('redirect rejection does not retry even on the relay',async()=>{
 const f=fixture([Object.assign(Error('redirect'),{code:'HTTP_REDIRECT_REFUSED'})]);
 await assert.rejects(f.invoke('commit',input),e=>e.code==='HTTP_REDIRECT_REFUSED');assert.equal(f.calls.length,1);
});

test('relay differentiates queue outage, pending receipt, and saved terminal results',async()=>{
 let row,submits=0,creations=0,now=0;
 const handler=createRelayWebHandler({secrets:{daily:'fixture-secret'},agentToken:'fixture-agent',queue:{submit:async(role,id,body)=>{
  submits++;
  if(!row){row={role,id,body,state:'pending'};creations++;}
  assert.equal(row.id,id);assert.equal(row.body,body);assert.equal(role,'daily');
  if(submits===2)throw Error('private database outage');
  if(submits>=3){row.state='done';row.response={status:200,body:JSON.stringify({result:published})};}
  return row;
 }}});
 const states=[];
 const invoke=createBrokerClient({url:'https://writer.example.invalid/api/writer/',token:'fixture-secret',clock:()=>now,sleep:async ms=>{now+=ms;},pollMs:10,
  request:async(url,options)=>{const r=await handler(new Request(url,options));states.push([r.status,r.headers.get('x-publication-state')]);return r;}});
 assert.deepEqual(await invoke('commit',input),published);
 assert.deepEqual(states,[[202,null],[503,'unknown'],[200,'completed']]);assert.equal(creations,1);
});
test('relay forwards a durable rejection as terminal but validates before touching queue',async()=>{
 let calls=0;
 const handler=createRelayWebHandler({secrets:{daily:'fixture-secret'},agentToken:'fixture-agent',queue:{submit:async()=>{calls++;return {state:'done',response:{status:409,body:'{}'}};}}});
 const invoke=createBrokerClient({url:'https://writer.example.invalid/api/writer/',token:'fixture-secret',request:(url,options)=>handler(new Request(url,options))});
 await assert.rejects(invoke('commit',input),e=>e.code==='WRITER_PUBLICATION_REFUSED');assert.equal(calls,1);
 await assert.rejects(invoke('deploy',input),e=>e.publicationOutcome==='refused');assert.equal(calls,1);
 const unauthorized=await handler(new Request('https://writer.example.invalid/api/writer/publication',{method:'POST',body:'invalid',headers:{authorization:'Bearer wrong'}}));
 assert.equal(unauthorized.status,401);assert.equal(calls,1);
});
test('diagnostic output excludes tokens, arbitrary errors, URLs and response bodies',()=>{
 const error={publicationOutcome:'unknown',code:'WRITER_OUTCOME_UNKNOWN',requestId:input.requestId,httpStatus:503,lastCode:'ECONNRESET',receiptAccepted:true,
  message:'secret-token',body:'secret-token',url:'https://secret-token',token:'secret-token'};
 const d=publicationDiagnostic(error);
 assert.equal(d.outcome,'unknown');assert.equal(d.lastCode,'ECONNRESET');assert.equal(d.requestId,input.requestId);
 assert.ok(!JSON.stringify(d).includes('secret-token'));assert.equal(d.newRequestAllowed,false);
 assert.match(publicationFailureMessage(error),/outcome unknown/);
 assert.match(publicationFailureMessage({publicationOutcome:'refused'}),/refused/);
 assert.equal(publicationDiagnostic({code:'secret-token'}).code,null);
 assert.equal(publicationDiagnostic({code:'WRITER_PRECOMMIT_BASE_CHANGED',publicationOutcome:'refused'}).newRequestAllowed,false);
 assert.equal(publicationDiagnostic({code:'WRITER_PRECOMMIT_BASE_CHANGED',publicationOutcome:'unknown',beforeCommit:true}).newRequestAllowed,false);
});

test('HTTP diagnostic codes preserve timeout, redirect and response-size refusal',async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/timeout')return;
  if(req.url==='/redirect'){res.writeHead(302,{location:'https://example.invalid/'});res.end();return;}
  res.end('oversized body');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  await assert.rejects(requestHttp(base+'/timeout',{timeoutMs:20}),e=>e.code==='HTTP_TIMEOUT');
  await assert.rejects(requestHttp(base+'/redirect'),e=>e.code==='HTTP_REDIRECT_REFUSED');
  await assert.rejects(requestHttp(base+'/large',{maxBytes:2}),e=>e.code==='HTTP_RESPONSE_TOO_LARGE');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('CLI retains a non-success exit and machine-readable unknown outcome without leaking configuration',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'writer-ack-test-'));
 const output=path.join(dir,'github-output');
 const result=spawnSync(process.execPath,[new URL('./writer-push.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),'not-a-role'],{
  encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:output,TIKIT_WRITER_TOKEN:'do-not-print-fixture-secret'}});
 assert.equal(result.status,1);
 assert.match(result.stderr,/writer publication outcome unknown/);
 assert.ok(!result.stderr.includes('do-not-print-fixture-secret'));
 assert.match(fs.readFileSync(output,'utf8'),/publication_outcome=unknown/);
});
test('daily failure notification separates collection success from publication uncertainty',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/daily-crawl.yml',import.meta.url),'utf8');
 assert.match(workflow,/steps\.publish\.outputs\.publication_outcome/);
 assert.match(workflow,/수집 성공 · 게시 결과 확인 필요/);
 assert.match(workflow,/steps\.publish\.outputs\.publication_request_id/);
 assert.match(workflow,/Preserve collected data after publication failure/);
 assert.match(workflow,/retention-days: 7/);
});
