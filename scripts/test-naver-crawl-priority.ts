import assert from 'node:assert/strict';
import {
    selectNaverCrawlCandidates,
    type NaverCrawlPriorityCandidate,
} from '../src/lib/naver-crawl-priority';
import {
    buildNaverSourceSignature,
    getNaverSourcePrice,
    type NaverRefreshConfig,
    type NaverRefreshFlight,
} from '../src/lib/naver-refresh-policy';

const now = new Date('2026-08-30T03:00:00Z').getTime();
const refreshConfig: NaverRefreshConfig = {
    priorityRefreshDays: 1,
    standardRefreshDays: 1,
    minSuccessRefreshHours: 48,
    priorityDepartureDays: 14,
    priorityDiscountRate: 20,
    priceChangeAmount: 10_000,
    priceChangeRatio: 0.03,
    missRetryHours: 24,
    noResultRetryHours: 24,
};

const flight = (key: string, score: number): NaverCrawlPriorityCandidate<NaverRefreshFlight> => {
    const value: NaverRefreshFlight = {
        source: 'ybtour',
        price: 200_000 + score * 1_000,
        airline: '티키항공',
        departure: { date: '2026-09-20', time: '08:00' },
        arrival: { date: '2026-09-23', time: '18:00' },
    };
    return { key, flight: value, provisionalScore: score };
};
const candidates = [
    flight('changed-top', 1),
    flight('stable-top', 2),
    flight('standard-a', 3),
    flight('standard-b', 4),
    flight('deadline', 5),
    flight('standard-c', 6),
    flight('low', 7),
    flight('fresh-low', 8),
];
const successEntry = (candidate: NaverCrawlPriorityCandidate<NaverRefreshFlight>, crawledAt: string) => ({
    crawledAt,
    lastAttemptAt: crawledAt,
    lastAttemptStatus: 'success',
    sourceSignature: buildNaverSourceSignature(candidate.flight),
    sourcePrice: getNaverSourcePrice(candidate.flight),
});
const entries = {
    'changed-top': {
        ...successEntry(candidates[0], '2026-08-28T03:00:00Z'),
        sourceSignature: buildNaverSourceSignature({ ...candidates[0].flight, price: 180_000 }),
        sourcePrice: 180_000,
    },
    'stable-top': successEntry(candidates[1], '2026-08-28T03:00:00Z'),
    'standard-a': successEntry(candidates[2], '2026-08-27T03:00:00Z'),
    'standard-b': successEntry(candidates[3], '2026-08-28T03:00:00Z'),
    deadline: {
        firstQueuedAt: '2026-08-23T03:00:00Z',
        sourceSignature: buildNaverSourceSignature(candidates[4].flight),
        sourcePrice: getNaverSourcePrice(candidates[4].flight),
    },
    'standard-c': successEntry(candidates[5], '2026-08-29T03:00:00Z'),
    low: successEntry(candidates[6], '2026-08-28T03:00:00Z'),
    'fresh-low': successEntry(candidates[7], '2026-08-30T01:00:00Z'),
};

const selection = selectNaverCrawlCandidates(candidates, entries, {
    limit: 5,
    now,
    topCandidateCount: 2,
    lowCandidateRatio: 0.25,
    maxDeferDays: 7,
    refreshConfig,
});

assert.deepEqual(selection.selected.map(row => row.key), [
    'deadline',
    'changed-top',
    'stable-top',
    'standard-a',
    'standard-b',
]);
assert.equal(selection.selected[0].group, 'deadline');
assert.equal(selection.selected[1].group, 'changed_top');
assert.equal(selection.selected[2].group, 'top');
assert.equal(selection.pending.at(-1)?.key, 'low');
assert.equal(selection.pending.at(-1)?.group, 'low');
assert.equal(selection.skippedFresh, 2);
assert.equal(selection.eligible.length, selection.selected.length + selection.pending.length);

console.log('Naver crawl priority tests passed');
