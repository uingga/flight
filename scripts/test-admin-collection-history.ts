import assert from 'node:assert/strict';
import { buildCollectionHistory, collectionChange, type CrawlHistoryEntry, type ActiveCollectionRun } from '../src/lib/admin-collection-history';

const history: CrawlHistoryEntry[] = [
    { timestamp: '2026-09-17T06:30:00+09:00', sites: { ybtour: { total: 10, scraped: 30, added: 2, removed: 1 }, hanatour: { total: 7, preserved: true }, myrealtrip: { total: 90 } }, alerts: ['하나투어 실패'] },
    { timestamp: '2026-09-17T07:30:00+09:00', sites: { myrealtrip: { total: 85, scraped: 100, added: 3, removed: 8 } }, alerts: [] },
    { timestamp: '2026-09-17T08:00:00+09:00', runKind: 'pc_fallback', sites: { hanatour: { total: 9, scraped: 20, added: 2, removed: 0, localFallback: true }, ybtour: { total: 10, skipped: true, skipReason: 'not-requested' } }, alerts: [] },
];
const before = JSON.stringify(history);
const rows = buildCollectionHistory(history, []);
assert.equal(rows.length, 2, 'General round appears once, actual MRT run joins same list');
assert.equal(rows[0].title, '일반 여행사 수집');
assert.equal(rows[0].sites.hanatour.total, 9, 'Final fallback result replaces earlier failure');
assert.equal(rows[0].sites.ybtour.scraped, 30, 'Carry placeholder must not erase result');
assert.equal(rows[1].title, '마이리얼트립 수집');
assert.equal(collectionChange(rows[1].sites.myrealtrip), -5);
assert.equal(collectionChange({ total: 10 }), null, 'Missing change is not zero');
assert.equal(collectionChange({ total: 10, added: 0, removed: 0 }), 0);
assert.equal(collectionChange({ total: 10, preserved: true, added: 30, removed: 1 }), null);
const active: ActiveCollectionRun = { id: 1, title: '', status: 'in_progress', stage: 'publishing', event: 'schedule', startedAt: '2026-09-17T06:20:00+09:00', updatedAt: '2026-09-17T06:30:00+09:00', url: 'https://example.com', plannedSources: ['ybtour', 'hanatour'], skippedSources: [] };
const live = buildCollectionHistory(history, [], active);
assert.equal(live.length, 2, 'Active and completed data for one slot must not duplicate');
assert.ok(live.some(row => row.active?.id === 1 && row.sites.hanatour.total === 9));
assert.equal(JSON.stringify(history), before, 'Presentation must not mutate stored records');
assert.deepEqual(buildCollectionHistory([], []), []);
console.log('PASS unified rounds, MRT carry exclusion, active deduplication, missing values, immutable history');
