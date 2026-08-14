import assert from 'node:assert/strict';
import {
    DEAL_ALERT_SCORE_THRESHOLD,
    decodeDealAlertRegion,
    encodeDealAlertRegion,
    evaluateDealAlert,
    isDealAlertDestination,
    type DealAlertCondition,
} from '../src/lib/deal-alerts';
import type { Flight } from '../src/types/flight';

const now = new Date('2026-08-14T12:00:00+09:00');

function flight(overrides: Partial<Flight> & Pick<Flight, 'id'>): Flight & { firstSeen?: string } {
    return {
        id: overrides.id,
        source: overrides.source || 'ybtour',
        airline: overrides.airline || '제주항공',
        departure: overrides.departure || { city: '인천', airport: 'ICN', date: '2026-08-21', time: '07:00' },
        arrival: overrides.arrival || { city: '오사카(간사이)', airport: 'KIX', date: '2026-08-24', time: '20:00' },
        price: overrides.price || 129_000,
        currency: 'KRW',
        link: 'https://example.com',
        region: overrides.region || '일본',
        naverLowest: overrides.naverLowest ?? 159_000,
        priceCheckedAt: overrides.priceCheckedAt || '2026-08-14T08:00:00+09:00',
        firstSeen: '2026-08-14',
        ...overrides,
    };
}

const condition: DealAlertCondition = {
    id: 'test-alert',
    departureCity: '인천',
    region: '일본',
    maxPrice: 150_000,
};

assert.equal(encodeDealAlertRegion('일본'), '@deal:일본');
assert.equal(decodeDealAlertRegion('@deal:all'), 'all');
assert.equal(decodeDealAlertRegion('오사카'), null);
assert.equal(isDealAlertDestination('@deal:동남아'), true);
assert.equal(isDealAlertDestination('방콕'), false);

const review = evaluateDealAlert(
    condition,
    [
        flight({ id: 'qualified' }),
        flight({ id: 'same-destination-lower-score', price: 149_000, naverLowest: 140_000 }),
        flight({ id: 'ttang-fee-over-budget', source: 'ttang', price: 140_000 }),
        flight({ id: 'stale', priceCheckedAt: '2026-08-10T08:00:00+09:00' }),
        flight({ id: 'other-region', region: '동남아', arrival: { city: '다낭', airport: 'DAD', date: '2026-08-24', time: '20:00' } }),
        flight({ id: 'expired', departure: { city: '인천', airport: 'ICN', date: '2026-08-10', time: '07:00' } }),
    ],
    {
        '인천-오사카(간사이)': [
            { date: '2026-08-10', minPrice: 180_000 },
            { date: '2026-08-11', minPrice: 175_000 },
        ],
    },
    {},
    now,
);

assert.equal(review.qualifiedCount, 1, '같은 목적지는 가장 좋은 후보 하나만 남겨야 한다.');
assert.equal(review.candidates[0].flightId, 'qualified');
assert.ok(review.candidates[0].score >= DEAL_ALERT_SCORE_THRESHOLD);
assert.equal(review.rejectionCounts.overBudget, 1, '땡처리닷컴 수수료를 더한 금액으로 예산을 검사해야 한다.');
assert.equal(review.rejectionCounts.stale, 1);
assert.equal(review.rejectionCounts.otherRegion, 1);
assert.equal(review.rejectionCounts.expired, 1);

const anywhere = evaluateDealAlert(
    { ...condition, id: 'anywhere', region: 'all', maxPrice: 200_000 },
    [
        flight({ id: 'japan', arrival: { city: '후쿠오카', airport: 'FUK', date: '2026-08-23', time: '20:00' } }),
        flight({ id: 'sea', region: '동남아', arrival: { city: '다낭', airport: 'DAD', date: '2026-08-24', time: '20:00' } }),
    ],
    {},
    {},
    now,
);
assert.equal(anywhere.qualifiedCount, 2, '아무데나는 지역과 관계없이 후보를 평가해야 한다.');

console.log('✅ 조건형 특가 알림 점수·필터 테스트 통과');
