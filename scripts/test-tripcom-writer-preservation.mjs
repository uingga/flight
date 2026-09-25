import test from 'node:test';
import assert from 'node:assert/strict';
import {preserveTripcomForForeignWriter} from '../src/lib/tripcom-writer-preservation.mjs';

const current={
 flights:[{id:'y-old',source:'ybtour'},{id:'t-new',source:'tripcom',price:180000}],count:2,
 sources:{ybtour:1,tripcom:1},sourceUpdatedAt:{tripcom:'2026-09-24T06:34:00+09:00'},
 tripcomPrimary:{runId:'2026-09-24T06:17:00+09:00',verifiedCities:1,
  history:[{runId:'2026-09-23T16:31:00+09:00',host:'C',status:'collected',verifiedCities:1,unconfirmedCities:0}]},
};
const proposed={
 flights:[{id:'y-new',source:'ybtour'},{id:'t-stale',source:'tripcom',price:220000}],count:2,
 sources:{ybtour:1,tripcom:1},sourceUpdatedAt:{tripcom:'2026-09-23T20:30:00+09:00'},
 tripcomPrimary:{runId:'stale'},
};

test('foreign writer keeps current Trip.com rows and metadata while updating its own source',()=>{
 const entries=[['data/all-flights-cache.json',proposed],['data/crawl-log.json',{latest:'daily'}]];
 const rawEntries=entries.map(([file,value])=>[file,JSON.stringify(value)]);
 const result=preserveTripcomForForeignWriter(current,entries,rawEntries);
 assert.deepEqual(result.entries[0][1].flights,[proposed.flights[0],current.flights[1]]);
 assert.equal(result.entries[0][1].count,2);
 assert.deepEqual(result.entries[0][1].tripcomPrimary,current.tripcomPrimary);
 assert.equal(result.entries[0][1].sourceUpdatedAt.tripcom,current.sourceUpdatedAt.tripcom);
 assert.deepEqual(JSON.parse(result.rawEntries[0][1]),result.entries[0][1]);
 assert.deepEqual(result.entries[1],entries[1]);
 assert.deepEqual(result.rawEntries[1],rawEntries[1]);
 assert.deepEqual(proposed.flights[1],{id:'t-stale',source:'tripcom',price:220000});
});

test('foreign writer cannot introduce Trip.com rows absent from current main',()=>{
 const previous={flights:[{id:'y',source:'ybtour'}],count:1};
 const result=preserveTripcomForForeignWriter(previous,[['data/all-flights-cache.json',proposed]]);
 assert.deepEqual(result.entries[0][1].flights,[proposed.flights[0]]);
 assert.equal(result.entries[0][1].sources.tripcom,undefined);
 assert.equal(result.entries[0][1].tripcomPrimary,undefined);
});

test('identical Trip.com data keeps the exact local cache bytes for reconciliation',()=>{
 const alreadyCurrent={...current,flights:[current.flights[1],{id:'y-new',source:'ybtour'}]};
 const entries=[['data/all-flights-cache.json',alreadyCurrent],['data/crawl-log.json',{latest:'fallback'}]];
 const rawEntries=[['data/all-flights-cache.json',JSON.stringify(alreadyCurrent,null,2)+'\n'],['data/crawl-log.json','{"latest":"fallback"}\n']];
 const result=preserveTripcomForForeignWriter(current,entries,rawEntries);
 assert.equal(result.entries,entries);
 assert.equal(result.rawEntries,rawEntries);
 assert.equal(result.rawEntries[0][1],rawEntries[0][1]);
});

test('changed Trip.com field still uses the current main slice',()=>{
 const stale={...current,sourceUpdatedAt:{tripcom:'old'}};
 const result=preserveTripcomForForeignWriter(current,[['data/all-flights-cache.json',stale]]);
 assert.equal(result.entries[0][1].sourceUpdatedAt.tripcom,current.sourceUpdatedAt.tripcom);
 assert.notEqual(result.entries[0][1],stale);
});

test('non-cache publication remains unchanged',()=>{
 const entries=[['data/crawl-log.json',{latest:'daily'}]];
 const result=preserveTripcomForForeignWriter(current,entries);
 assert.equal(result.entries,entries);
 assert.equal(result.rawEntries,undefined);
});
