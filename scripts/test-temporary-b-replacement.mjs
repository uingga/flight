import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReplacement, replacementFor, replacementWorkerContext, REPLACEMENT_ROOT } from '../src/lib/temporary-b-replacement.mjs';
const now=Date.parse('2026-09-26T04:23:00Z');
const config=()=>({format:1,id:'b-on-a-20260926',from:'B',to:'A',hostname:'OFFICE-OMEN',status:'active',
    notBefore:'2026-09-26T03:00:00Z',bFenced:true,fenceSha:'a'.repeat(64),stateSha:'b'.repeat(64),
    releaseVersion:'c'.repeat(64),root:REPLACEMENT_ROOT,regularOnly:true});
test('explicit fenced physical A retains logical B identity',()=>{
    const value=validateReplacement(config(),{now,hostname:'Office-OMEN'});
    const context=replacementWorkerContext({env:{TIKITIKIT_TEMP_B_EXECUTION:'1',TIKITIKIT_TEMP_B_VERSION:value.releaseVersion},hostname:'OFFICE-OMEN',read:()=>value});
    assert.equal(context.physicalHost,'A');assert.equal(context.logicalHost,'B');assert.equal(context.chrome.port,9223);
});
test('no configuration means existing dispatch path remains unchanged',()=>{
    assert.equal(replacementFor('modetour','2026-09-26T04:23:00Z',{read:()=>null}),null);
    assert.equal(replacementWorkerContext({env:{}}),null);
});
test('never fall back to B after maintenance fencing',()=>{
    for(const status of ['paused','prepared'])assert.throws(()=>replacementFor('ttang','2026-09-26T04:23:00Z',{read:()=>({...config(),status})}),/not_active/);
});
test('reject past slots, manual requests and non-B sources',()=>{
    for(const [source,slot,manual] of [['ttang','2026-09-25T21:17:00Z',false],['ttang','2026-09-26T04:23:00Z',true],['naver','2026-09-26T04:23:00Z',false],['lottetour','2026-09-26T04:23:00Z',false]])
        assert.throws(()=>replacementFor(source,slot,{manual,read:config}),/slot_not_allowed/);
});
test('host, fence, state and exact release proofs are mandatory',()=>{
    for(const patch of [{from:'C'},{to:'B'},{bFenced:false},{stateSha:''},{root:'C:/other'},{notBefore:'invalid'},{regularOnly:false}])
        assert.throws(()=>validateReplacement({...config(),...patch},{now,hostname:'OFFICE-OMEN'}));
    assert.throws(()=>validateReplacement(config(),{now,hostname:'DESKTOP-OFFICE'}));
    assert.throws(()=>replacementWorkerContext({env:{TIKITIKIT_TEMP_B_EXECUTION:'1',TIKITIKIT_TEMP_B_VERSION:'d'.repeat(64)},read:config}),/not_authorized/);
});
