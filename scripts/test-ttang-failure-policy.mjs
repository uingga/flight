import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isTtangPreflightFailure } from './ttang-failure-policy.mjs';
import { beginTtangDispatch } from './ttang-worker-routing.mjs';
import { TTANG_PROTOCOL } from './ttang-primary-policy.mjs';

const id='a338bd4b-c1d9-4bc3-a3ad-f4ae073cb965';
const proof=()=>({protocol:TTANG_PROTOCOL,id,status:'failed',reason:'dedicated_chrome_owner_query_timeout',
    phase:'browser_preflight',siteRequestsStarted:false,uncertain:false,restricted:false,cleanupConfirmed:true,observedCount:0});

test('only complete correlated pre-browser proof may omit a new source cooldown',()=>{
    assert.equal(isTtangPreflightFailure(proof(),id),true);
    for(const reason of ['dedicated_chrome_owner_unverified','dedicated_chrome_unavailable','dedicated_chrome_owner_query_failed'])
        assert.equal(isTtangPreflightFailure({...proof(),reason},id),true);
    for(const key of ['protocol','id','status','reason','phase','siteRequestsStarted','uncertain','restricted','cleanupConfirmed','observedCount']) {
        const bad=proof();delete bad[key];assert.equal(isTtangPreflightFailure(bad,id),false,key);
    }
    for(const change of [{id:'other'},{reason:'access_restriction'},{reason:'remote_transport_timeout'},
        {phase:'collection'},{siteRequestsStarted:true},{uncertain:true},{restricted:true},{cleanupConfirmed:false},
        {observedCount:1},{cooldown:{nextProbeAt:'2026-09-27'}},{bundle:{}}])
        assert.equal(isTtangPreflightFailure({...proof(),...change},id),false);
    assert.equal(isTtangPreflightFailure({protocol:TTANG_PROTOCOL,id,status:'failed',reason:'dedicated_chrome_owner_unverified',
        uncertain:false,observedCount:0},id),false,'legacy evidence does not automatically unlock anything');
});

function withJournal(run) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'ttang-preflight-test-'));
    try{return run(root);}finally{
        assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('ttang-preflight-test-'));
        fs.rmSync(root,{recursive:true,force:true});
    }
}
test('zero-request failure keeps the spent slot but permits a different next regular slot',()=>withJournal(root=>{
    const now=Date.parse('2026-09-26T06:17:00+09:00');
    beginTtangDispatch(root,'06:17',id,now).finish(true,undefined,proof());
    assert.equal(fs.existsSync(path.join(root,'cooldown.json')),false);
    assert.throws(()=>beginTtangDispatch(root,'06:17',id,now+1000),/EEXIST/);
    beginTtangDispatch(root,'10:12','second',now+4*3600000).finish(false);
}));
test('unknown/blocked/incomplete failures and existing cooldowns still protect both hosts',()=>{
    for(const reply of [undefined,{...proof(),restricted:true},{...proof(),cleanupConfirmed:false},{...proof(),siteRequestsStarted:true}])
        withJournal(root=>{
            const now=Date.parse('2026-09-26T06:17:00+09:00');
            beginTtangDispatch(root,'06:17',id,now).finish(true,undefined,reply);
            const previous=fs.readFileSync(path.join(root,'cooldown.json'),'utf8');
            assert.throws(()=>beginTtangDispatch(root,'10:12','second',now+4*3600000),/shared_source_cooldown/);
            assert.equal(fs.readFileSync(path.join(root,'cooldown.json'),'utf8'),previous);
        });
});
