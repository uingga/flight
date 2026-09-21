import test from 'node:test';
import assert from 'node:assert/strict';
import {publishTripcom} from './publish-tripcom.mjs';
function fixture(verified=1,operating=true){
 const calls=[];
 return {calls,args:{artifact:{},broker:async action=>{calls.push(action);return action==='readInputs'?{ref:'a'.repeat(40),cache:{}}:{commitSha:'b'.repeat(40)};},
 prepare:async()=>({verifiedCount:verified,requestId:'c'.repeat(64),cache:{}}),
 verifyOperating:async()=>{calls.push('verify');return operating;},
 acknowledge:async()=>{calls.push('ack');},finishEmpty:async()=>{calls.push('empty');}}};
}
test('acknowledges only after operating verification',async()=>{const f=fixture();await publishTripcom(f.args);assert.deepEqual(f.calls,['readInputs','commit','verify','ack']);});
test('no fabricated publication for empty result',async()=>{const f=fixture(0);await publishTripcom(f.args);assert.deepEqual(f.calls,['readInputs','empty']);});
test('uncertain operating result retains admission',async()=>{const f=fixture(1,false);await assert.rejects(publishTripcom(f.args));assert.ok(!f.calls.includes('ack'));});
