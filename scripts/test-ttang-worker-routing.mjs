import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ttangWorkerForSlot,assertTtangWorker,beginTtangDispatch} from './ttang-worker-routing.mjs';
test('five slots have exactly one worker; wrong host and manual C refused',()=>{
 for(const [time,worker] of [['06:17','B'],['10:12','C'],['13:23','B'],['16:31','C'],['19:31','C']]){
  const slot='2026-09-16T'+time+':00+09:00';assert.equal(ttangWorkerForSlot(slot),worker);
  assert.equal(assertTtangWorker(worker==='B'?'DESKTOP-OFFICE':'DESKTOP-1PPFUR3',slot,false,worker),worker);
  assert.throws(()=>assertTtangWorker(worker==='C'?'DESKTOP-OFFICE':'DESKTOP-1PPFUR3',slot,false,worker));
 }
 assert.throws(()=>assertTtangWorker('DESKTOP-1PPFUR3','2026-09-16T10:12:00+09:00',true,'C'));
});
test('cross-worker journal refuses concurrency, duplicate slots and shared failure for 24 hours',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ttang-routing-')),now=Date.parse('2026-09-16T06:17:00+09:00');
 try{
  const a=beginTtangDispatch(root,'morning','a',now);
  assert.throws(()=>beginTtangDispatch(root,'next','b',now));a.finish(false);
  assert.throws(()=>beginTtangDispatch(root,'morning','again',now));
  const b=beginTtangDispatch(root,'next','b',now+3600000);b.finish(true);
  assert.throws(()=>beginTtangDispatch(root,'afternoon','c',now+4*3600000),/shared_source_cooldown/);
 }finally{fs.rmSync(root,{recursive:true});}
});
