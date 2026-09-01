import assert from 'node:assert/strict';
import {
    filterStaleSourceFlights,
    getEffectiveSourceUpdatedAt,
    getSourceFreshness,
    getStaleSources,
} from '../src/lib/source-freshness';

const now = Date.parse('2026-08-29T12:00:00.000Z');
const sourceUpdatedAt = {
    myrealtrip: '2026-08-28T13:00:00.000Z',
    ttang: '2026-08-27T13:00:00.000Z',
    onlinetour: '2026-08-27T11:59:59.000Z',
    ybtour: '2026-08-29T10:00:00.000Z',
    hanatour: '2026-08-29T10:00:00.000Z',
    modetour: '2026-08-29T10:00:00.000Z',
};

assert.equal(getSourceFreshness('myrealtrip', sourceUpdatedAt, now).fresh, true);
assert.equal(getSourceFreshness('ttang', sourceUpdatedAt, now).fresh, true);
assert.equal(getSourceFreshness('onlinetour', sourceUpdatedAt, now).fresh, false);

const stale = getStaleSources(sourceUpdatedAt, now).map(result => result.source);
assert.deepEqual(stale, ['onlinetour']);

const flights = [
    { source: 'ybtour' as const, id: 'fresh' },
    { source: 'onlinetour' as const, id: 'stale' },
];
assert.deepEqual(filterStaleSourceFlights(flights, sourceUpdatedAt, now), [flights[0]]);

const manualFreshness = getEffectiveSourceUpdatedAt(
    { ...sourceUpdatedAt, modetour: '2026-08-26T10:00:00.000Z' },
    { modetour: { capturedAt: '2026-08-29T09:00:00.000Z' } },
);
assert.equal(manualFreshness.modetour, '2026-08-29T09:00:00.000Z');
assert.equal(getSourceFreshness('modetour', manualFreshness, now).fresh, true);

const olderManualCapture = getEffectiveSourceUpdatedAt(
    sourceUpdatedAt,
    { modetour: { capturedAt: '2026-08-28T09:00:00.000Z' } },
);
assert.equal(olderManualCapture.modetour, sourceUpdatedAt.modetour);

console.log('여행사 가격 확인 시한 테스트 통과');
