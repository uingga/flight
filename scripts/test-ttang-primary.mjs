import test from 'node:test';
import assert from 'node:assert/strict';
import { ttangDatePlan, assertTtangAllowed, validateTtangEvidence, validateTtangReceivedEvidence, TTANG_PROTOCOL } from './ttang-primary-policy.mjs';
import { evaluatePcCollection } from './pc-collection-policy.mjs';
import { ttangListPageEvidence } from '../src/lib/ttang-request-audit.mjs';
import { crawlOrder, finiteListBudget } from '../src/lib/crawl-order.mjs';
const off={enabled:false,slotsPerDay:4};
test('Ttang primary runs only 08:17/14:23, after upstream and at least five hours since success',()=>{
    for(const [time,due] of [['2026-09-07T00:00:00Z',true],['2026-09-07T03:00:00Z',false],['2026-09-07T06:00:00Z',true],['2026-09-07T09:00:00Z',false]]) {
        const cache={flights:[],fullCrawlUpdatedAt:time};
        const check=delta=>evaluatePcCollection({cache:{...cache,...delta},now:time,config:off,modeConfig:off}).sources;
        assert.equal(check({}).includes('ttang'),due);
        assert.deepEqual(check({ttangPrimary:{lastAttemptAt:time}}),[]);
        assert.deepEqual(check({sourceUpdatedAt:{ttang:time}}),[]);
        assert.deepEqual(check({ttangPrimary:{nextProbeAt:'bad'}}),[]);
        assert.deepEqual(check({fullCrawlUpdatedAt:'2026-09-06T00:00:00Z'}),[]);
    }
});
test('manual primary is independent of upstream age but retains cooldown and five-hour interval',()=>{
    const now=Date.parse('2026-09-07T10:00:00Z'),cache={flights:[],fullCrawlUpdatedAt:'2026-09-07T09:00:00Z'};
    assert.ok(assertTtangAllowed(cache,{now,manual:true}));
    for(const delta of [{sourceCircuits:{ttang:{nextProbeAt:'bad'}}},{ttangPrimary:{nextProbeAt:'2026-09-08'}},
        {sourceUpdatedAt:{ttang:'2026-09-07T08:00:00Z'}}])
        assert.throws(()=>assertTtangAllowed({...cache,...delta},{now,manual:true}));
    for(const fullCrawlUpdatedAt of ['2026-09-06',undefined])
        assert.doesNotThrow(()=>assertTtangAllowed({...cache,fullCrawlUpdatedAt},{now,manual:true}));
});
test('one-month KST plan clamps month end; no 60-day expansion',()=>{
    const a=ttangDatePlan(new Date('2026-09-07T10:00:00Z'));
    assert.equal(a.length,31);assert.equal(a[0],'20260907');assert.equal(a.at(-1),'20261007');
    const b=ttangDatePlan(new Date('2027-01-30T16:00:00Z'));
    assert.equal(b[0],'20270131');assert.equal(b.at(-1),'20270228');assert.equal(b.length,29);
});
function fixture(){
    const startedAt='2026-09-07T10:00:00Z',completedAt='2026-09-07T10:05:00Z';
    return {protocol:TTANG_PROTOCOL,id:'test',startedAt,completedAt,cleanupConfirmed:true,
        manifest:{status:'completed',coverage:'verified',dates:ttangDatePlan(new Date(startedAt)),rawCount:10,
            attempts:31,pages:ttangDatePlan(new Date(startedAt)).map(d=>ttangListPageEvidence(d,10,1))},
        cache:{flights:[{source:'ttang',price:100000,ttangProduct:{fareId:'1'},departure:{date:'2026-09-10'}}],
            scrapedCounts:{ttang:10},sourceUpdatedAt:{ttang:completedAt},staleStreak:{ttang:0}},
        partial:{runId:'test',startedAt,status:'completed',adapterVersion:'v',successes:[],outcomes:[],
            counts:{selected:0,succeeded:0,empty:0,failed:0,unqueried:0,excludedLegacy:0,deferred:0}}};
}
test('shuffled dates validate as a complete permutation; omitted/duplicate dates or a changed seed fail', () => {
    const b = fixture(), ordered = crawlOrder(b.manifest.dates, b.id);
    Object.assign(b.manifest, {orderSeed:b.id, plannedDates:ordered, dates:ordered,
        plannedRequests:ordered.length,maxListRequests:finiteListBudget(ordered.length,2,64),
        pages:ordered.map(d=>ttangListPageEvidence(d,10,1))});
    const now=Date.parse('2026-09-07T10:06:00Z');
    assert.doesNotThrow(()=>validateTtangEvidence(b,'test',now));
    for (const change of [c=>c.manifest.pages[0].date=c.manifest.pages[1].date,
        c=>c.manifest.orderSeed='changed', c=>c.manifest.maxListRequests++,
        c=>c.manifest.plannedDates=c.manifest.plannedDates.slice(1)]) {
        const c=structuredClone(b);change(c);assert.throws(()=>validateTtangEvidence(c,'test',now));
    }
});
test('no-new-detail round is valid; old timestamps never count as new verification',()=>{
    assert.equal(validateTtangEvidence(fixture(),'test',Date.parse('2026-09-07T10:06:00Z')).timeVerified,0);
});
test('68ms remote clock lead waits without future acceptance or network retry',async()=>{
    const b=fixture();let now=Date.parse(b.completedAt)-68,waited=0;
    await validateTtangReceivedEvidence(b,'test',{clock:()=>now,wait:async ms=>{waited+=ms;now+=ms;}});
    assert.equal(waited,88);
    await assert.rejects(validateTtangReceivedEvidence(b,'test',{clock:()=>Date.parse(b.completedAt)-5001,wait:async()=>{throw Error('must_not_wait');}}),/remote_clock_skew/);
    await assert.rejects(validateTtangReceivedEvidence(b,'test',{clock:()=>Date.parse(b.completedAt)-68,wait:async()=>{}}),/invalid_run_evidence/);
});
for(const [name,change] of Object.entries({
    missingCoverage:b=>delete b.manifest.coverage,unknownCoverage:b=>b.manifest.coverage='unverified',
    missingResponse:b=>b.manifest.pages.pop(),unknownContract:b=>b.manifest.pages[0].reason='unknown',
    falseAttempts:b=>b.manifest.attempts++,wrongResponseDate:b=>b.manifest.pages[0].date='20200101',
    missingDate:b=>b.manifest.dates.pop(),unfinished:b=>b.manifest.status='running',badCount:b=>b.cache.scrapedCounts.ttang=1,
    stale:b=>b.cache.sourceUpdatedAt.ttang='2026-09-06',preserved:b=>b.cache.staleStreak.ttang=1,
    cleanup:b=>b.cleanupConfirmed=false,detailLimit:b=>b.partial.counts.selected=21,
    detailFailed:b=>b.partial.counts.failed=1,detailInterrupted:b=>b.partial.status='interrupted',
    legacy:b=>b.partial.counts.excludedLegacy=1,price:b=>b.cache.flights[0].price=0,
    falseSuccess:b=>{b.partial.counts.selected=1;b.partial.counts.succeeded=1;b.partial.successes=[{}];},
}))test('rejects '+name,()=>{const b=fixture();change(b);assert.throws(()=>validateTtangEvidence(b,'test',Date.parse('2026-09-07T10:06:00Z')));});
