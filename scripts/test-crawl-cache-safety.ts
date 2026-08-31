import assert from 'node:assert/strict';
import { preserveCrawlCacheWithSafetyState } from '../src/lib/crawl-cache-safety';

const previous = {
    timestamp: '2026-08-29T00:00:00.000Z',
    fullCrawlUpdatedAt: '2026-08-29T00:00:00.000Z',
    count: 2,
    flights: [{ id: 'old-1' }, { id: 'old-2' }],
    scrapedCounts: { ybtour: 300, ttang: 1_600 },
    sourceCircuits: {},
    manualCaptureStatus: {
        modetour: {
            lastImportedAt: '2026-08-30T06:00:00.000Z',
            accepted: 60,
        },
    },
};
const circuit = {
    ttang: {
        reason: 'blocked',
        nextProbeAt: '2026-08-31T00:00:00.000Z',
    },
};

const preserved = preserveCrawlCacheWithSafetyState({
    previous,
    sourceCircuits: circuit,
    staleStreak: { ttang: 1 },
    scrapedCounts: { ttang: 1_600 },
    integrityAlerts: ['ttang 차단'],
    fullCrawlCompletedAt: '2026-08-30T00:00:00.000Z',
});

assert.equal(preserved.timestamp, previous.timestamp);
assert.equal(preserved.fullCrawlUpdatedAt, '2026-08-30T00:00:00.000Z');
assert.equal(preserved.count, previous.count);
assert.deepEqual(preserved.flights, previous.flights);
assert.deepEqual(preserved.sourceCircuits, circuit);
assert.deepEqual(preserved.staleStreak, { ttang: 1 });
assert.deepEqual(preserved.scrapedCounts, { ybtour: 300, ttang: 1_600 });
assert.deepEqual(preserved.integrityAlerts, ['ttang 차단']);
assert.deepEqual(preserved.manualCaptureStatus, previous.manualCaptureStatus);
assert.equal(previous.fullCrawlUpdatedAt, '2026-08-29T00:00:00.000Z');

console.log('전체 캐시 보존 시 차단 회로 유지 테스트 통과');
