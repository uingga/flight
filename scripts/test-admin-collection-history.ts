import assert from 'node:assert/strict';
import { buildCollectionHistory, collectionChange, type CrawlHistoryEntry, type ActiveCollectionRun } from '../src/lib/admin-collection-history';

const history: CrawlHistoryEntry[] = [
    { timestamp: '2026-09-17T06:30:00+09:00', sites: { ybtour: { total: 10, scraped: 30, added: 2, removed: 1 }, hanatour: { total: 7, preserved: true }, myrealtrip: { total: 90 } }, alerts: ['하나투어 실패'] },
    { timestamp: '2026-09-17T07:30:00+09:00', sites: { myrealtrip: { total: 85, scraped: 100, added: 3, removed: 8 } }, alerts: [] },
    { timestamp: '2026-09-17T08:00:00+09:00', runKind: 'pc_fallback', sites: { hanatour: { total: 9, scraped: 20, added: 2, removed: 0, localFallback: true }, ybtour: { total: 10, skipped: true, skipReason: 'not-requested' } }, alerts: [] },
];
const before = JSON.stringify(history);
const rows = buildCollectionHistory(history, []);
assert.equal(rows.length, 3, 'Every actual execution remains visible');
assert.equal(rows[0].title, '일반 여행사 PC 대체 수집');
assert.equal(rows[0].sites.hanatour.total, 9);
assert.equal(rows[0].sites.ybtour, undefined, 'Not-requested placeholders are omitted');
assert.equal(rows[2].sites.hanatour.preserved, true, 'Earlier failure must remain visible');
assert.equal(rows[2].sites.ybtour.scraped, 30);
assert.equal(rows[1].title, '마이리얼트립 수집');
assert.equal(collectionChange(rows[1].sites.myrealtrip), -5);
assert.equal(collectionChange({ total: 10 }), null, 'Missing change is not zero');
assert.equal(collectionChange({ total: 10, added: 0, removed: 0 }), 0);
assert.equal(collectionChange({ total: 10, preserved: true, added: 30, removed: 1 }), null);
const active: ActiveCollectionRun = { id: 1, title: '', status: 'in_progress', stage: 'publishing', event: 'schedule', startedAt: '2026-09-17T06:20:00+09:00', updatedAt: '2026-09-17T06:30:00+09:00', url: 'https://example.com', plannedSources: ['ybtour', 'hanatour'], skippedSources: [] };
const live = buildCollectionHistory(history, [], active);
assert.equal(live.length, 4, 'Do not attach an active run to unrelated stored results');
assert.ok(live.some(row => row.active?.id === 1 && Object.keys(row.sites).length === 0));
assert.equal(JSON.stringify(history), before, 'Presentation must not mutate stored records');
assert.deepEqual(buildCollectionHistory([], []), []);
const lateRuns: CrawlHistoryEntry[] = ['2026-09-17T21:43:00+09:00', '2026-09-18T00:30:00+09:00', '2026-09-18T00:37:00+09:00'].map(timestamp => ({timestamp, sites: {ttang:{total:10,scraped:20}}, alerts:[]}));
assert.equal(buildCollectionHistory(lateRuns, []).length, 3, 'Evening and midnight executions are not merged');
const tripcomRuns: CrawlHistoryEntry[] = [
    { timestamp: '2026-09-22T06:20:00+09:00', sites: { ybtour: { total: 10, scraped: 30 }, tripcom: { total: 2 } }, alerts: [] },
    { timestamp: '2026-09-22T10:20:00+09:00', sites: { tripcom: { total: 3, scraped: 4 } }, alerts: [] },
];
const tripcomRows = buildCollectionHistory(tripcomRuns, []);
assert.equal(tripcomRows.length, 2, 'Carried Trip.com cache is not a collection run');
assert.equal(tripcomRows[0].title, '트립닷컴 수집');
assert.equal(tripcomRows[0].sites.tripcom.scraped, 4);
assert.equal(tripcomRows[1].sites.tripcom, undefined);
console.log('PASS separate executions, MRT carry exclusion, active isolation, immutable history');
