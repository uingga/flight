import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluatePcCollection } from './pc-collection-policy.mjs';
import { assertOnlineGithubFallback,claimOnlineGithubFallback,assertOnlineGithubClaim } from './online-github-fallback-policy.mjs';

const config={enabled:true,slotsPerDay:4};
const expectedAt='2026-09-07T05:23:00.000Z',now=new Date('2026-09-07T06:00:00Z');
const base=()=>({fullCrawlUpdatedAt:'2026-09-07T05:40:00Z',sourceCircuits:{},onlinePrimary:{
    status:'failed',lastAttemptAt:'2026-09-07T05:55:00Z',failureOpenedAt:'2026-09-07T05:55:00Z',githubFallbackSafe:true}});
const policy=(cache=base(),time=now)=>evaluatePcCollection({cache,now:time,config,modeConfig:{enabled:false,slotsPerDay:4}});

test('late PC failure belongs to current slot and dispatches GitHub, not PC',()=>{
    assert.equal(policy().githubFallbackDue,true);
    assert.deepEqual(policy().sources,[]);
});
test('consecutive PC failure alternates collect/rest across midnight and days',()=>{
    const slots=['2026-09-07T05:23:00Z','2026-09-07T08:31:00Z','2026-09-07T23:17:00Z','2026-09-08T02:12:00Z','2026-09-08T05:23:00Z'];
    slots.forEach((slot,index)=>{
        const time=new Date(Date.parse(slot)+40*60_000),cache=base();
        cache.fullCrawlUpdatedAt=time.toISOString();cache.onlinePrimary.lastAttemptAt=time.toISOString();
        assert.equal(policy(cache,time).githubFallbackDue,index%2===0);
    });
});
test('no GitHub request for successful PC, pending PC, stale upstream or already attempted slot',()=>{
    for(const mutate of [
        c=>c.onlinePrimary.status='success',
        c=>c.onlinePrimary.githubFallbackSafe=false,
        c=>delete c.onlinePrimary.githubFallbackSafe,
        c=>c.onlinePrimary.lastAttemptAt='2026-09-07T02:30:00Z',
        c=>c.fullCrawlUpdatedAt='2026-09-07T02:30:00Z',
        c=>c.onlinePrimary.githubAttemptAt='2026-09-07T05:57:00Z',
        c=>c.onlinePrimary.failureOpenedAt='bad',
        c=>c.onlinePrimary.failureOpenedAt='2026-09-08T05:57:00Z',
    ]) {const c=base();mutate(c);assert.equal(policy(c).githubFallbackDue,false);}
});
test('PC cooldown permits alternating GitHub backup, GitHub cooldown blocks GitHub only',()=>{
    const c=base();c.onlinePrimary.lastAttemptAt='2026-09-07T02:30:00Z';
    c.onlinePrimary.circuit={nextProbeAt:'2026-09-08T00:00:00Z'};
    assert.equal(policy(c).githubFallbackDue,true);assert.deepEqual(policy(c).sources,[]);
    for(const nextProbeAt of ['2026-09-08T00:00:00Z','bad']) {
        c.sourceCircuits.onlinetour={nextProbeAt};assert.equal(policy(c).githubFallbackDue,false);
    }
    delete c.onlinePrimary.circuit;
    assert.ok(policy(c).sources.includes('onlinetour'));
});
test('PC recovery ends fallback, a later failure starts a new alternating sequence',()=>{
    const c=base();c.onlinePrimary.status='success';delete c.onlinePrimary.failureOpenedAt;
    assert.equal(policy(c).githubFallbackDue,false);
    const time=new Date('2026-09-07T09:00:00Z');
    c.fullCrawlUpdatedAt=time.toISOString();c.onlinePrimary={status:'failed',lastAttemptAt:time.toISOString(),failureOpenedAt:time.toISOString(),githubFallbackSafe:true};
    assert.equal(policy(c,time).githubFallbackDue,true);
});
test('claim is immutable from policy perspective and only originating non-rerun consumes it',()=>{
    const args={cache:base(),expectedAt,runId:'123',runAttempt:'1',now,config};
    const before=JSON.stringify(args.cache),claimed=claimOnlineGithubFallback(args);
    assert.equal(JSON.stringify(args.cache),before);
    assert.equal(policy(claimed).githubFallbackDue,false);
    assertOnlineGithubClaim({...args,cache:claimed});
    for(const override of [{runId:'124'},{runAttempt:'2'},{expectedAt:'2026-09-07T02:12:00.000Z'},
        {now:new Date(now.getTime()+31*60_000)},{config:{enabled:false,slotsPerDay:4}},
        {cache:{...claimed,onlinePrimary:{...claimed.onlinePrimary,status:'success'}}}]) {
        assert.throws(()=>assertOnlineGithubClaim({...args,cache:claimed,...override}));
    }
    assert.throws(()=>claimOnlineGithubFallback({...args,cache:claimed}));
    assert.throws(()=>claimOnlineGithubFallback({...args,runAttempt:'2'}));
});
test('disabled rollout and stale dispatch fail closed',()=>{
    assert.throws(()=>assertOnlineGithubFallback({cache:base(),expectedAt,now,config:{enabled:false,slotsPerDay:4}}));
    assert.throws(()=>assertOnlineGithubFallback({cache:base(),expectedAt:'2026-09-07T02:12:00.000Z',now,config}));
});
test('workflow reserves durably before collecting, shares general mutex and only merges OnlineTour',()=>{
    const workflow=fs.readFileSync('.github/workflows/onlinetour-fallback.yml','utf8');
    assert.match(workflow,/group: daily-flight-crawl/);
    assert.ok(workflow.indexOf('git push origin HEAD:main')<workflow.indexOf('tsx scripts/crawl-all.ts'));
    assert.match(workflow,/crawl-all\.ts --sources=onlinetour/);
    assert.doesNotMatch(workflow,/naver|archive:prices|schedule:/);
    assert.match(workflow,/merge-cache-source\.mjs data\/all-flights-cache.json \/tmp\/online-fallback-cache.json onlinetour/);
    const general=fs.readFileSync('.github/workflows/daily-crawl.yml','utf8');
    assert.match(general,/merge-cache-source\.mjs data\/all-flights-cache.json \/tmp\/origin-cache.json onlinetour/);
});
