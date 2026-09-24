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
test('OnlineTour and ModeTour share all five general slots while Ttang retains four PC slots', () => {
    const c=cache();
    for(const expectedAt of [
        '2026-09-09T07:31:00.000Z', '2026-09-09T10:31:00.000Z',
        '2026-09-09T21:17:00.000Z', '2026-09-10T01:12:00.000Z',
        '2026-09-10T04:23:00.000Z', '2026-09-10T07:31:00.000Z',
    ]) {
        const now=new Date(Date.parse(expectedAt)+60_000);
        const general=surroundingSlots(now.getTime()).expectedAt;
        c.fullCrawlUpdatedAt=new Date(Date.parse(expectedAt)+30_000).toISOString();
        c.onlinePrimary.lastAttemptAt=new Date(Date.parse(expectedAt)-60_000).toISOString();
        const policy=evaluatePcCollection({cache:c,now});
        assert.equal(policy.onlineExpectedAt,expectedAt);
        assert.equal(policy.sources.includes('onlinetour'),true);
        assert.equal(policy.eveningSlot,expectedAt==='2026-09-09T10:31:00.000Z');
        assert.equal(general,Date.parse(expectedAt));
        assert.equal(policy.sources.includes('modetour'),true);
        if(policy.eveningSlot) assert.equal(policy.sources.includes('ttang'),false);
        c.onlinePrimary.lastAttemptAt=now.toISOString();
        assert.equal(evaluatePcCollection({cache:c,now}).sources.includes('onlinetour'),false);
    }
});
test('evening slot waits for its own general crawl and respects access cooldown', () => {
    const c=cache(), now=new Date('2026-09-09T10:32:00.000Z');
    c.fullCrawlUpdatedAt='2026-09-09T07:30:00.000Z';
    assert.equal(evaluatePcCollection({cache:c,now}).sources.includes('onlinetour'),false);
    c.fullCrawlUpdatedAt='2026-09-09T07:32:00.000Z';
    assert.equal(evaluatePcCollection({cache:c,now}).sources.includes('onlinetour'),false);
    c.fullCrawlUpdatedAt='2026-09-09T10:31:30.000Z';
    assert.equal(evaluatePcCollection({cache:c,now}).sources.includes('onlinetour'),true);
    c.onlinePrimary.circuit={nextProbeAt:'2026-09-10T00:00:00.000Z'};
    assert.equal(evaluatePcCollection({cache:c,now}).sources.includes('onlinetour'),false);
});
test('five-slot GitHub fallback claim runs once for the matching general slot', () => {
    const c=cache(), now=new Date('2026-09-10T10:32:00.000Z');
    c.fullCrawlUpdatedAt='2026-09-10T10:31:30.000Z';
    c.onlinePrimary.circuit={nextProbeAt:'2026-09-20T00:00:00Z'};
    const policy=evaluatePcCollection({cache:c,now});
    assert.equal(policy.githubFallbackDue,true);
    const args={cache:c,now,expectedAt:policy.onlineExpectedAt,runId:'123',runAttempt:'1'};
    const claimed=claimOnlineGithubFallback(args);
    assert.equal(evaluatePcCollection({cache:claimed,now}).githubFallbackDue,false);
    assertOnlineGithubClaim({...args,cache:claimed});
    assert.throws(()=>claimOnlineGithubFallback({...args,cache:claimed}));
    assert.equal(policy.expectedAt,policy.onlineExpectedAt);
    assert.throws(()=>claimOnlineGithubFallback({...args,expectedAt:'2026-09-10T07:31:00.000Z'}));
});
