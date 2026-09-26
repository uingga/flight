import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateTtangManualGrant, readTtangManualGrant, claimTtangManualGrant, manualGrantPaths } from '../src/lib/temporary-ttang-manual-grant.mjs';
import { replacementFor, replacementLaunch } from '../src/lib/temporary-b-replacement.mjs';

const now=Date.parse('2026-09-26T03:40:00Z');
const id='02a9b6bf-a253-455b-8860-2a026d43294a';
const config={id:'b-on-a-20260926',status:'active',notBefore:'2026-09-26T02:40:00Z',releaseVersion:'a'.repeat(64),root:'C:/fixed',regularOnly:true};
const grant=()=>({format:1,source:'ttang',runId:id,replacementId:config.id,releaseVersion:config.releaseVersion,
    userApproved:true,maxRuns:1,createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600_000).toISOString()});

test('one exact approved ttang run may use A while all other manual requests remain refused',()=>{
    const options={manual:true,id,read:()=>config,readGrant:(value,runId)=>validateTtangManualGrant(grant(),value,runId,now)};
    assert.equal(replacementFor('ttang','2026-09-26T01:12:00Z',options),config,'manual keeps the actual policy slot even if older than replacement activation');
    assert.ok(replacementLaunch('ttang','2026-09-26T01:12:00Z',options).args.includes('--manual-once'));
    for(const source of ['modetour','onlinetour','myrealtrip','naver','tripcom'])
        assert.throws(()=>replacementFor(source,'2026-09-26T01:12:00Z',options),/slot_not_allowed/);
    assert.throws(()=>replacementFor('ttang','2026-09-26T01:12:00Z',{...options,manual:false}),/slot_not_allowed/);
});
test('wrong ID, source, release, expiry or missing approval is refused',()=>{
    assert.equal(validateTtangManualGrant(grant(),config,id,now).maxRuns,1);
    for(const change of [{source:'modetour'},{runId:'bad'},{replacementId:'other'},{releaseVersion:'b'.repeat(64)},
        {userApproved:false},{maxRuns:2},{createdAt:new Date(now+1).toISOString()},
        {expiresAt:new Date(now).toISOString()},{expiresAt:new Date(now+3*3600_000).toISOString()},
        {createdAt:'invalid'},{createdAt:'2026-09-25T00:00:00Z'}])
        assert.throws(()=>validateTtangManualGrant({...grant(),...change},config,id,now),/manual_grant_required/);
    assert.throws(()=>validateTtangManualGrant(grant(),config,'../other',now),/manual_grant_required/);
});
test('grant is durably single-use, even after failure; source cooldown files are untouched',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'tikit-ttang-grant-'));
    const c={...config,root};
    try {
        const files=manualGrantPaths(c,id);
        fs.mkdirSync(files.directory);
        fs.writeFileSync(files.grant,JSON.stringify(grant()));
        fs.writeFileSync(path.join(root,'cooldown.json'),'preserve');
        assert.equal(readTtangManualGrant(c,id,now).runId,id);
        claimTtangManualGrant(c,id,now);
        assert.throws(()=>readTtangManualGrant(c,id,now),/spent/);
        assert.throws(()=>claimTtangManualGrant(c,id,now),/spent/);
        assert.equal(fs.readFileSync(path.join(root,'cooldown.json'),'utf8'),'preserve');
    } finally {
        assert.equal(path.dirname(root),os.tmpdir());
        assert.ok(path.basename(root).startsWith('tikit-ttang-grant-'));
        fs.rmSync(root,{recursive:true});
    }
});
