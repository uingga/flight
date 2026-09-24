import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {executeMrtWorker} from './mrt-c-worker.mjs';
const input=()=>({protocol:'mrt-c-v1',id:randomUUID(),slot:'2026-09-17T06:55:00.000Z',createdAt:new Date().toISOString(),files:{'all-flights-cache.json':{flights:[]},'gid-map.json':{ICN:1},'crawl-log.json':{entries:[]},'interpark-prices.json':{}}});
test('actual worker stages private inputs, launches correct collector and returns output',async()=>{
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'mrt-worker-test-'));const r=input();let calls=0;
 const reply=await executeMrtWorker(r,{state,collector:(node,args,opts)=>{
  calls++;assert.ok(args.at(-1).endsWith('scrape-myrealtrip-prices.ts'));assert.equal(opts.env.MRT_C_WORKER,'1');
  assert.equal(opts.timeout,180*60000);assert.equal(JSON.parse(fs.readFileSync(path.join(opts.env.TIKITIKIT_DATA_DIR,'gid-map.json'))).ICN,1);
  fs.writeFileSync(path.join(opts.env.TIKITIKIT_DATA_DIR,'all-flights-cache.json'),JSON.stringify({flights:[{source:'myrealtrip',price:123}]}));return {status:0};
 }});
 assert.equal(reply.cache.flights[0].price,123);assert.equal(calls,1);assert.equal(fs.existsSync(path.join(state,'active.lock')),false);
 await assert.rejects(executeMrtWorker({...r,id:randomUUID()},{state,collector:()=>{throw Error('must not run');}}));
});
test('uncertain child completion retains local lock and blocks second request',async()=>{
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'mrt-worker-test-'));
 await assert.rejects(executeMrtWorker(input(),{state,collector:()=>({error:Error('timeout')})}));
 assert.equal(fs.existsSync(path.join(state,'active.lock')),true);
 await assert.rejects(executeMrtWorker(input(),{state,collector:()=>{throw Error('must not run');}}));
});
test('known failure returns persisted block for A publication',async()=>{
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'mrt-worker-test-'));
 const result=await executeMrtWorker(input(),{state,collector:(n,a,o)=>{
  fs.writeFileSync(path.join(o.env.TIKITIKIT_DATA_DIR,'all-flights-cache.json'),JSON.stringify({flights:[],sourceCircuits:{myrealtrip:{nextProbeAt:'2099-01-01T00:00:00Z'}}}));return {status:1};
 }});assert.equal(result.exitCode,1);assert.ok(result.cache.sourceCircuits.myrealtrip);
});
