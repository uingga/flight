import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {executeAgencyEvening,AGENCY_EVENING_PROTOCOL} from './agency-evening-worker.mjs';
import {verifyReply} from './run-agency-evening';
import {mergeCacheSource} from '../src/lib/merge-cache-source.mjs';

test('worker partial reply passes A verification and preserves a newer unrelated publication',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'evening-flow-test-'));
 t.after(()=>{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('evening-flow-test-'))throw Error('unsafe fixture cleanup');fs.rmSync(root,{recursive:true});});
 const slot='2026-09-25T11:30:00.000Z',now=Date.parse(slot)+60000;
 const initial={flights:[{id:'old-yb',source:'ybtour',price:200000},{id:'old-trip',source:'tripcom',price:200000}],
  fullCrawlUpdatedAt:'2026-09-25T10:32:00.000Z',sourceUpdatedAt:{tripcom:'2026-09-25T10:40:00.000Z'}};
 const request={protocol:AGENCY_EVENING_PROTOCOL,id:randomUUID(),slot,createdAt:new Date(now).toISOString(),
  sources:['ybtour','hanatour','onlinetour'],files:{'all-flights-cache.json':initial,'crawl-log.json':{entries:[]}}};
 let calls=0;
 const reply=await executeAgencyEvening(request,{now:()=>now,hostname:'DESKTOP-OFFICE',base:root,collectorRoot:root,
  collector:(_file:any,args:any,options:any)=>{
   calls++;if(args.at(-1)==='hanatour')return {status:1};
   const file=path.join(options.env.TIKITIKIT_DATA_DIR,'all-flights-cache.json');
   fs.writeFileSync(file,JSON.stringify({...initial,flights:[{id:'new-yb',source:'ybtour',price:100000}],
    sourceUpdatedAt:{ybtour:options.env.AGENCY_EVENING_STARTED_AT}}));return {status:0};
  }});
 await verifyReply(reply,request,initial);
 const latest={...initial,flights:[{id:'latest-trip',source:'tripcom',price:120000}],
  sourceUpdatedAt:{tripcom:'2026-09-25T11:40:00.000Z'},unrelated:'keep'};
 const merged=mergeCacheSource(latest,reply.cache,'ybtour');
 assert.equal(calls,2);assert.deepEqual(reply.sources,['ybtour']);assert.equal(reply.failure.source,'hanatour');
 assert.equal(merged.flights.find((f:any)=>f.source==='ybtour')?.price,100000);
 assert.equal(merged.flights.find((f:any)=>f.source==='tripcom')?.price,120000);
 assert.equal(merged.sourceUpdatedAt.tripcom,'2026-09-25T11:40:00.000Z');assert.equal(merged.unrelated,'keep');
});
