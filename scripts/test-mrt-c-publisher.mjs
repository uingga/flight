import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cSlot,publishMrtResult,readMrtJson} from './run-mrt-c.mjs';
test('cache above Contents API inline limit reads the exact immutable blob',async()=>{
 const sha='a'.repeat(40),calls=[];
 const result=await readMrtJson(async p=>{calls.push(p);return p.startsWith('contents/')
  ?{status:200,data:{encoding:'none',sha}}:{status:200,data:{content:Buffer.from('{"fixture":true}').toString('base64')}};},'all-flights-cache.json','pinned-ref');
 assert.equal(result.fixture,true);assert.deepEqual(calls,['contents/data/all-flights-cache.json?ref=pinned-ref','git/blobs/'+sha]);
});
test('C starts from approved final rollout slot, never earlier or catchup',()=>{
 assert.equal(cSlot(Date.parse('2026-09-15T23:55:00Z')),null);
 assert.equal(cSlot(Date.parse('2026-09-16T06:14:59Z')),null);
 assert.equal(cSlot(Date.parse('2026-09-16T06:15:00Z')),'2026-09-16T06:15:00.000Z');
 assert.equal(cSlot(Date.parse('2026-09-16T06:30:00Z')),null);
 assert.equal(cSlot(Date.parse('2026-09-17T06:15:00Z')),'2026-09-17T06:15:00.000Z');
 assert.equal(cSlot(Date.parse('2026-09-16T23:55:00Z')),'2026-09-16T23:55:00.000Z');
 assert.equal(cSlot(Date.parse('2026-09-17T06:31:00Z')),null);
});
test('real source publication retries CAS with newest other-source data',async()=>{
 let head='base',n=0;const trees=new Map(),commits=new Map();
 const logs={entries:[]};
 const cache={flights:[{id:'m',source:'myrealtrip',price:1},{id:'y',source:'ybtour',price:2}],sources:{myrealtrip:1,ybtour:1}};
 commits.set('base',{'all-flights-cache.json':cache,'crawl-log.json':logs});
 let raced=false;
 const api=async(p,method='GET',body)=>{
  if(p==='git/ref/tags/mrt-active-v1')return {status:200,data:{object:{sha:'owner'}}};
  if(p==='git/ref/heads/main')return {status:200,data:{object:{sha:head}}};
  if(p.startsWith('contents/')){const u=new URL('http://fixture/'+p),name=u.pathname.split('/').at(-1),ref=u.searchParams.get('ref');
   return {status:200,data:{content:Buffer.from(JSON.stringify(commits.get(ref)[name])).toString('base64')}};}
  if(p.startsWith('git/commits/'))return {status:200,data:{tree:{sha:p.slice(12)}}};
  if(p==='git/trees'){const id='tree'+(++n);trees.set(id,Object.fromEntries(body.tree.map(x=>[x.path.split('/').at(-1),JSON.parse(x.content)])));return {status:201,data:{sha:id}};}
  if(p==='git/commits'){const id='commit'+(++n);commits.set(id,trees.get(body.tree));return {status:201,data:{sha:id}};}
  if(p==='git/refs/heads/main'){
   assert.equal(body.force,false);
   if(!raced){raced=true;head='race';const changed=structuredClone(cache);changed.flights[1].price=999;commits.set(head,{'all-flights-cache.json':changed,'crawl-log.json':logs});return {status:422};}
   head=body.sha;return {status:200,data:{object:{sha:head}}};
  }
  throw Error('unexpected request '+p);
 };
 const result=await publishMrtResult(api,{owner:'owner'},{cache:{...cache,flights:[{id:'new-m',source:'myrealtrip',price:100}]},logs});
 assert.equal(result,head);assert.equal(commits.get(head)['all-flights-cache.json'].flights.find(f=>f.source==='ybtour').price,999);
 assert.equal(commits.get(head)['all-flights-cache.json'].flights.find(f=>f.source==='myrealtrip').price,100);
});
test('ownership loss forbids any publication',async()=>{
 let writes=0;await assert.rejects(publishMrtResult(async(p,m)=>{if(m)writes++;return {status:404,data:{}};},{owner:'old'},{}));assert.equal(writes,0);
});
