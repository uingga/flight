import test from 'node:test';
import assert from 'node:assert/strict';
import {publishTripcom,withTripcomRunHistory} from './publish-tripcom.mjs';

const oldRun={runId:'2026-09-24T16:31:00+09:00',host:'BC',status:'partial',verifiedCities:15,unconfirmedCities:5};
const newRun={runId:'2026-09-25T06:17:00+09:00',host:'B',status:'collected',verifiedCities:20,unconfirmedCities:0};

function fixture(verified=20,operating=true){
 const calls=[];
 return {calls,args:{artifact:{},broker:async(action,payload)=>{
  calls.push([action,payload]);
  return action==='readInputs'?{ref:'a'.repeat(40),cache:{flights:[],tripcomPrimary:oldRun}}:{commitSha:'b'.repeat(40)};
 },prepare:async()=>({verifiedCount:verified,requestId:'c'.repeat(64),cache:{flights:[],tripcomPrimary:{...newRun,verifiedCities:verified}}}),
 verifyOperating:async(value)=>{calls.push(['verify',value]);return operating;},
 acknowledge:async()=>{calls.push(['ack']);},finishEmpty:async()=>{calls.push(['empty']);}}};
}

test('publishes witnessed run history and acknowledges only after operating verification',async()=>{
 const f=fixture();await publishTripcom(f.args);
 assert.deepEqual(f.calls.map(([action])=>action),['readInputs','commit','verify','ack']);
 const committed=f.calls[1][1].entries[0][1];
 assert.deepEqual(committed.tripcomPrimary.history,[oldRun,newRun]);
 assert.deepEqual(f.calls[2][1].cache,committed);
});
test('no fabricated publication for empty result',async()=>{
 const f=fixture(0);await publishTripcom(f.args);
 assert.deepEqual(f.calls.map(([action])=>action),['readInputs','empty']);
});
test('uncertain operating result retains admission',async()=>{
 const f=fixture(1,false);await assert.rejects(publishTripcom(f.args));
 assert.ok(!f.calls.some(([action])=>action==='ack'));
});
test('mismatched run count refuses publication',async()=>{
 const f=fixture();
 f.args.prepare=async()=>({verifiedCount:1,requestId:'c'.repeat(64),cache:{flights:[],tripcomPrimary:newRun}});
 await assert.rejects(publishTripcom(f.args),/run count mismatch/);
 assert.deepEqual(f.calls.map(([action])=>action),['readInputs']);
});
test('run history deduplicates replayed slots and does not mutate the input',()=>{
 const previous={tripcomPrimary:{...oldRun,history:[oldRun]}};
 const proposed={tripcomPrimary:{...oldRun,publication:'pending'}};
 const result=withTripcomRunHistory(previous,proposed);
 assert.deepEqual(result.tripcomPrimary.history,[oldRun]);
 assert.equal(proposed.tripcomPrimary.history,undefined);
});
test('run history keeps enough records for the common time window',()=>{
 const previous={tripcomPrimary:{...oldRun,history:Array.from({length:65},(_,index)=>({
  ...oldRun,runId:new Date(Date.parse('2026-09-01T00:00:00Z')+index*3600000).toISOString(),
 }))}};
 const result=withTripcomRunHistory(previous,{tripcomPrimary:newRun});
 assert.equal(result.tripcomPrimary.history.length,60);
 assert.equal(result.tripcomPrimary.history.at(-1).runId,newRun.runId);
});
