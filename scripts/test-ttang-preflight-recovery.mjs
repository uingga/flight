import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewLegacyTtangPreflight,REVIEWED_TTANG_FAILURE as id} from './ttang-preflight-recovery.mjs';
const fixture=()=>({cache:{flights:[{id:'preserve'}],sourceUpdatedAt:{ttang:'old'},ttangPrimary:{runId:id,status:'failed',
    detail:'B PC Chrome 수집 실패 (dedicated_chrome_owner_unverified)',nextProbeAt:'2026-09-26T21:57:39.034Z'}},
    request:{id,manual:false,expectedAt:'2026-09-25T21:17:00.000Z',createdAt:'2026-09-25T21:47:47.743Z'},
    reply:{protocol:'ttang-20260907.1',id,status:'failed',reason:'dedicated_chrome_owner_unverified',uncertain:false,observedCount:0},
    sharedCooldown:{id,nextProbeAt:'2026-09-26T21:57:39.034Z'},observation:{
        workerSha:'8a2139fe2639085700fcf3070483020e7c838e8edc928b20b6dd24750093a5fa',
        ownerSha:'3d53d43c46156536e569bea68ac15b1377968d6cbaac9108099d4149a93271b7',
        fenceExists:true,stageExists:false,sharedLockExists:false,cooldownExists:false,
        claims:[{data:{id,at:'2026-09-25T21:47:47.743Z'}}]}});
test('only independently audited legacy preflight drops its exact cooldown; prices and old failure remain',()=>{
    const value=fixture(), old=JSON.stringify(value), result=reviewLegacyTtangPreflight(value);
    assert.equal(result.cache.ttangPrimary.nextProbeAt,undefined);
    assert.equal(result.cache.ttangPrimary.runId,id);
    assert.equal(result.cache.ttangPrimary.status,'failed');
    assert.deepEqual(result.cache.flights,value.cache.flights);
    assert.deepEqual(result.cache.sourceUpdatedAt,value.cache.sourceUpdatedAt);
    assert.equal(JSON.stringify(value),old);
});
test('changed reply, unknown worker, site evidence or a different cooldown cannot be cleared',()=>{
    const mutations=[x=>x.reply.uncertain=true,x=>x.reply.reason='access_restriction',x=>x.reply.observedCount=1,
        x=>x.reply.cooldown={},x=>x.observation.stageExists=true,x=>x.observation.workerSha='x',
        x=>x.observation.sharedLockExists=true,x=>x.observation.cooldownExists=true,x=>x.observation.fenceExists=false,
        x=>x.observation.claims=[],x=>x.sharedCooldown.id='another',x=>x.cache.ttangPrimary.runId='another',
        x=>x.sharedCooldown.nextProbeAt='2026-09-27T21:00:00Z',
        x=>x.cache.sourceCircuits={ttang:{nextProbeAt:'2099-01-01T00:00:00Z'}}];
    for(const mutate of mutations){const value=fixture();mutate(value);assert.throws(()=>reviewLegacyTtangPreflight(value));}
});
