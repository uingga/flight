import test from 'node:test';
import assert from 'node:assert/strict';
import {planPcPublicationRecovery as plan} from './pc-publication-recovery.mjs';
function fixture() {
    const expectedAt = '2026-09-25T07:31:00.000Z';
    const stamp = '2026-09-25T07:37:00.000Z';
    const flight = source => ({source, id: source + '-new', price: 100000});
    return {expectedAt, now: Date.parse('2026-09-25T09:00:00Z'),
        current: {fullCrawlUpdatedAt: '2026-09-25T07:50:00Z', flights: [flight('myrealtrip'), flight('tripcom')],
            sourceUpdatedAt: {myrealtrip: '2026-09-25T08:00:00Z'}, naverCoordination: {id: 'keep'},
            sourceCircuits: {onlinetour: {reason: 'keep'}}}, currentLogs: {entries: []},
        saved: {flights: [flight('modetour'), flight('ttang')],
            sourceUpdatedAt: {modetour: stamp, ttang: stamp},
            modetourPrimary: {status: 'success'}, ttangPrimary: {status: 'success'}},
        savedLogs: {entries: [{timestamp: stamp, sites: {modetour: {scraped: 796}, ttang: {scraped: 552}}}]}};
}
test('saved successful sources merge without recrawling or altering unrelated state', () => {
    const data = fixture(); const before = structuredClone(data.current); const result = plan(data);
    assert.deepEqual(result.sources, ['modetour', 'ttang']);
    assert.deepEqual(result.cache.flights.filter(f => ['myrealtrip', 'tripcom'].includes(f.source)), before.flights);
    assert.deepEqual(result.cache.naverCoordination, before.naverCoordination);
    assert.deepEqual(result.cache.sourceCircuits.onlinetour, before.sourceCircuits.onlinetour);
    assert.equal(result.cache.fullCrawlUpdatedAt, before.fullCrawlUpdatedAt);
    assert.deepEqual(data.current, before);
    assert.equal(plan({...data, current: result.cache}).action, 'already_current');
});
test('newer current data is never replaced by an old saved result', () => {
    const data = fixture(); data.current.sourceUpdatedAt.modetour = '2026-09-25T08:00:00Z';
    assert.deepEqual(plan(data).sources, ['ttang']);
});
test('pending general, stale/failed evidence, missing success logs and circuits refuse recovery', () => {
    const mutations = [
        d => { d.current.fullCrawlUpdatedAt = '2026-09-25T04:00:00Z'; },
        d => { d.current.fullCrawlUpdatedAt = '2026-09-26T04:00:00Z'; },
        d => { d.now += 25 * 60 * 60_000; },
        d => { d.saved.ttangPrimary.status = 'failed'; },
        d => { d.saved.sourceUpdatedAt.modetour = '2026-09-25T04:00:00Z'; },
        d => { d.savedLogs.entries[0].sites.ttang.skipped = true; },
        d => { d.current.sourceCircuits.ttang = {reason: 'new block'}; },
        d => { d.saved.flights = d.saved.flights.filter(f => f.source !== 'ttang'); },
    ];
    for (const mutate of mutations) {const data = fixture(); mutate(data); assert.throws(() => plan(data));}
});
