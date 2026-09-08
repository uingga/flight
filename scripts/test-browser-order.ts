import test from 'node:test';
import assert from 'node:assert/strict';
import { modeBrowserPlan, validateModePlan } from '../src/lib/modetour-browser';
import { operationalPlan } from '../src/lib/onlinetour-operational';
import { inventoryListRequests, parseCataloguePlan } from '../src/lib/onlinetour-catalogue';
import { prepareTtangTimeQueue, ttangTimeKeyOf, TTANG_TIME_ADAPTER_VERSION } from '../src/lib/ttang-time-enrichment';
import type { Flight } from '../src/types/flight';

test('Mode shuffles all 15 scopes without changing dates or exceeding its derived limit', () => {
    const now = new Date('2026-09-08T00:00:00Z');
    const first = modeBrowserPlan(now, 'round-a'), other = modeBrowserPlan(now, 'round-b');
    validateModePlan(first); validateModePlan(other);
    assert.equal(first.maxListRequests, 15);
    assert.notDeepEqual(first.scopes, other.scopes);
    assert.deepEqual(modeBrowserPlan(now, 'round-a'), first);
    assert.equal(first.from, other.from); assert.equal(first.through, other.through);
    assert.throws(() => validateModePlan({...first, scopes: first.scopes.slice(1)}));
});
test('Online keeps entry region, covers all regions, persists seed, retains 60 days and zero retries', () => {
    const now = Date.parse('2026-09-08T00:00:00Z');
    const p = operationalPlan('AS', now, 'round-a');
    assert.deepEqual(parseCataloguePlan(JSON.parse(JSON.stringify(p))), p);
    assert.equal(p.regions[0], 'AS'); assert.equal(new Set(p.regions).size, 7);
    assert.equal(p.maxProductRequests, 100); assert.equal(p.maxRetries, 0);
    assert.deepEqual(p.departureWindow, operationalPlan('AS', now).departureWindow);
    assert.ok(['round-b','round-c','round-d'].some(seed =>
        JSON.stringify(p.regions) !== JSON.stringify(operationalPlan('AS', now, seed).regions)));
    assert.throws(() => parseCataloguePlan({...p, maxProductRequests: 101}));
});
test('Online calculates every visible city-month, not first 40 queries or first nonempty month', () => {
    const cities = Array.from({length: 16}, (_, i) => ({code: 'C' + i, firstDepartureDate: '20260908'}));
    assert.equal(inventoryListRequests(cities, '202611'), 48);
    assert.equal(inventoryListRequests([{code: 'A', firstDepartureDate: '20261001'}], '202611'), 2);
});
test('Ttang only shuffles equal-priority details and retains the 20-request cap', () => {
    const previousWorker=process.env.TTANG_BROWSER_WORKER, previousSeed=process.env.TTANG_STAGING_RUN_ID;
    try {
        process.env.TTANG_BROWSER_WORKER='1';
        const flights:Flight[]=Array.from({length:30},(_,i)=>({id:'f'+i,source:'ttang',airline:'제주항공',
            departure:{airport:'ICN',city:'서울',date:'2026-09-15',time:''},
            arrival:{airport:'BKK',city:'방콕',date:'2026-09-19',time:''},
            price:300000,currency:'KRW',link:'https://example.invalid',
            ttangProduct:{masterId:'m'+i,fareId:'f'+i,carrierCode:'7C',fareType:'VV'}}));
        const retryKey=ttangTimeKeyOf(flights[0]);
        const state={version:2 as const,entries:{[retryKey]:{status:'transient_error' as const,
            lastAttemptAt:'2026-09-06T00:00:00Z',nextAttemptAt:'2026-09-06T02:00:00Z',attemptCount:1,
            departureDate:'20260915',adapterVersion:TTANG_TIME_ADAPTER_VERSION}}};
        const run=(seed:string)=>{
            process.env.TTANG_STAGING_RUN_ID=seed;
            const q=prepareTtangTimeQueue(structuredClone(flights),state,{now:new Date('2026-09-08T00:00:00Z')});
            assert.equal(q.selected.length,20);
            assert.ok(q.selected.every(c=>c.key!==retryKey));
            return q.selected.map(c=>c.key);
        };
        assert.deepEqual(run('round-a'),run('round-a'));
        assert.notDeepEqual(run('round-a'),run('round-b'));
    } finally {
        if(previousWorker===undefined)delete process.env.TTANG_BROWSER_WORKER;else process.env.TTANG_BROWSER_WORKER=previousWorker;
        if(previousSeed===undefined)delete process.env.TTANG_STAGING_RUN_ID;else process.env.TTANG_STAGING_RUN_ID=previousSeed;
    }
});
