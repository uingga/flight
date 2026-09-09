import test from 'node:test';
import assert from 'node:assert/strict';
import { onlineCollectionInterval } from './online-collection-interval.mjs';
import { evaluatePcCollection } from './pc-collection-policy.mjs';
import { surroundingSlots } from './local-source-fallback-policy.mjs';
import { assertOnlineGithubFallback, claimOnlineGithubFallback, assertOnlineGithubClaim } from './online-github-fallback-policy.mjs';

const anchor = '2026-09-09T07:55:43.167Z';
const cache = () => ({onlinePrimary:{lastAttemptAt:anchor,status:'failed',failureOpenedAt:anchor,githubFallbackSafe:true},sourceCircuits:{}});
test('both 2 and 3 days occur, stable across polls and serialized cache', () => {
    const choices = new Set();
    for (let i=0;i<100;i++) {
        const c = cache(); c.onlinePrimary.lastAttemptAt = new Date(Date.parse(anchor)+i*1000).toISOString();
        const result = onlineCollectionInterval(c, anchor);
        choices.add(result.intervalDays);
        assert.deepEqual(onlineCollectionInterval(JSON.parse(JSON.stringify(c)), anchor), result);
        assert.equal(onlineCollectionInterval(c, '2026-09-10').nextCollectionAt, result.nextCollectionAt);
    }
    assert.deepEqual([...choices].sort(), [2,3]);
});
test('exact boundary, failures, latest GitHub attempt and legacy migration', () => {
    const c=cache(), result=onlineCollectionInterval(c,anchor), due=Date.parse(result.nextCollectionAt);
    assert.equal(onlineCollectionInterval(c,new Date(due-1)).due,false);
    assert.equal(onlineCollectionInterval(c,new Date(due)).due,true);
    c.onlinePrimary.githubAttemptAt=new Date(due).toISOString();
    assert.equal(onlineCollectionInterval(c,new Date(due)).due,false);
    assert.equal(onlineCollectionInterval({sourceUpdatedAt:{onlinetour:anchor}},anchor).nextCollectionAt,result.nextCollectionAt);
    assert.equal(onlineCollectionInterval({onlinePrimary:{lastAttemptAt:'bad'}},anchor).due,false);
    assert.equal(onlineCollectionInterval(c,'bad').due,false);
});
test('production policy prevents PC and GitHub requests throughout waiting period', () => {
    const c=cache(), end=Date.parse(onlineCollectionInterval(c,anchor).nextCollectionAt);
    c.onlinePrimary.circuit={nextProbeAt:'2026-09-20T00:00:00Z'};
    for(let ms=Date.parse(anchor);ms<end;ms+=3600000) {
        const now=new Date(ms); c.fullCrawlUpdatedAt=now.toISOString();
        const policy=evaluatePcCollection({cache:c,now});
        assert.equal(policy.sources.includes('onlinetour'),false);
        assert.equal(policy.githubFallbackDue,false);
        assert.throws(()=>assertOnlineGithubFallback({cache:c,expectedAt:policy.expectedAt,now}));
    }
});
test('next normal slot permits one PC collection; other agencies remain unchanged', () => {
    const c=cache(), due=Date.parse(onlineCollectionInterval(c,anchor).nextCollectionAt);
    const now=new Date(surroundingSlots(due).nextExpectedAt+60000);
    c.fullCrawlUpdatedAt=now.toISOString();
    const policy=evaluatePcCollection({cache:c,now});
    assert.ok(policy.sources.includes('onlinetour'));
    assert.ok(policy.sources.includes('modetour'));
    c.onlinePrimary.lastAttemptAt=now.toISOString();
    const after=evaluatePcCollection({cache:c,now});
    assert.equal(after.sources.includes('onlinetour'),false);
    assert.equal(after.githubFallbackDue,false);
    assert.deepEqual(after.sources,policy.sources.filter(s=>s!=='onlinetour'));
});
test('due fallback claim runs once, while claimed timestamp blocks other dispatchers', () => {
    const c=cache(), due=Date.parse(onlineCollectionInterval(c,anchor).nextCollectionAt);
    c.onlinePrimary.circuit={nextProbeAt:'2026-09-20T00:00:00Z'};
    let found=false;
    for(let ms=due;ms<due+86400000;ms+=3600000) {
        const now=new Date(ms); c.fullCrawlUpdatedAt=now.toISOString();
        const policy=evaluatePcCollection({cache:c,now});
        if(!policy.githubFallbackDue) continue;
        const args={cache:c,now,expectedAt:policy.expectedAt,runId:'123',runAttempt:'1'};
        const claimed=claimOnlineGithubFallback(args);
        assert.equal(evaluatePcCollection({cache:claimed,now}).githubFallbackDue,false);
        assertOnlineGithubClaim({...args,cache:claimed});
        assert.throws(()=>claimOnlineGithubFallback({...args,cache:claimed}));
        found=true; break;
    }
    assert.equal(found,true);
});
