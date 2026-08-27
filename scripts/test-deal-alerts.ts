import assert from 'node:assert/strict';
import {
    DEAL_ALERT_SCORE_THRESHOLD,
    decodeDealAlertRegion,
    encodeDealAlertRegion,
    evaluateDealAlert,
    isDealAlertDestination,
    type DealAlertCondition,
} from '../src/lib/deal-alerts';
import {
    appendDealSentEvent,
    buildDealNotificationText,
    decodeDealSentEvent,
    encodeDealSentEvent,
    selectDealCandidateForNotification,
} from '../src/lib/deal-alert-delivery';
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
        naverCheckedAt: overrides.naverCheckedAt || '2026-08-14T08:00:00+09:00',
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
assert.ok(review.candidates[0].scoreBreakdown.comparison > 0,
    '최근 비교가는 좋은 표 알림 점수에 반영해야 한다.');
assert.equal(review.rejectionCounts.overBudget, 1, '땡처리닷컴 수수료를 더한 금액으로 예산을 검사해야 한다.');
assert.equal(review.rejectionCounts.stale, 1);
assert.equal(review.rejectionCounts.otherRegion, 1);
assert.equal(review.rejectionCounts.expired, 1);
assert.equal(review.candidates[0].reasons.some(reason => /네이버|naver/i.test(reason)), false,
    '사용자에게 보이는 비교 근거에 특정 비교 서비스명을 노출하면 안 된다.');

const staleComparisonReview = evaluateDealAlert(
    { ...condition, id: 'stale-comparison', maxPrice: 200_000 },
    [flight({
        id: 'stale-comparison-flight',
        naverLowest: 220_000,
        naverCheckedAt: '2026-08-05T08:00:00+09:00',
    })],
    {
        '인천-오사카(간사이)': [
            { date: '2026-08-10', minPrice: 180_000 },
            { date: '2026-08-11', minPrice: 175_000 },
        ],
    },
    {},
    now,
);
const noComparisonReview = evaluateDealAlert(
    { ...condition, id: 'no-comparison', maxPrice: 200_000 },
    [flight({ id: 'no-comparison-flight', naverLowest: 0 })],
    {
        '인천-오사카(간사이)': [
            { date: '2026-08-10', minPrice: 180_000 },
            { date: '2026-08-11', minPrice: 175_000 },
        ],
    },
    {},
    now,
);
assert.equal(
    staleComparisonReview.candidates[0].scoreBreakdown.comparison,
    noComparisonReview.candidates[0].scoreBreakdown.comparison,
    '3일이 지난 비교가는 비교 데이터가 없는 표와 같은 점수를 받아야 한다.',
);
assert.equal(staleComparisonReview.candidates[0].reasons.some(reason => reason.includes('외부 비교')), false,
    '3일이 지난 비교가는 알림 이유에도 사용하면 안 된다.');

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

const topCandidate = review.candidates[0];
const otherDestination = {
    ...topCandidate,
    flightId: 'other-destination',
    arrivalCity: '후쿠오카',
    effectivePrice: 135_000,
};
const recentSentAt = '2026-08-13T12:00:00+09:00';
const recentHistory = [encodeDealSentEvent({
    arrivalCity: topCandidate.arrivalCity,
    sentAt: recentSentAt,
    effectivePrice: topCandidate.effectivePrice,
    flightId: topCandidate.flightId,
})];

assert.equal(
    selectDealCandidateForNotification([topCandidate, otherDestination], recentHistory, now).candidate?.flightId,
    'other-destination',
    '최근 보낸 목적지는 건너뛰고 다음 목적지를 골라야 한다.',
);
assert.equal(
    selectDealCandidateForNotification([topCandidate], recentHistory, now).candidate,
    null,
    '같은 목적지를 가격 변화 없이 7일 안에 다시 보내면 안 된다.',
);

const cheaperCandidate = { ...topCandidate, effectivePrice: topCandidate.effectivePrice - 6_000 };
assert.equal(
    selectDealCandidateForNotification([cheaperCandidate], recentHistory, now).candidate?.flightId,
    topCandidate.flightId,
    '같은 목적지라도 5천원 이상 저렴해지면 다시 보낼 수 있어야 한다.',
);

const oldHistory = [encodeDealSentEvent({
    arrivalCity: topCandidate.arrivalCity,
    sentAt: '2026-08-05T12:00:00+09:00',
    effectivePrice: topCandidate.effectivePrice,
    flightId: topCandidate.flightId,
})];
assert.equal(
    selectDealCandidateForNotification([topCandidate], oldHistory, now).candidate?.flightId,
    topCandidate.flightId,
    '7일이 지난 목적지는 다시 추천할 수 있어야 한다.',
);

const appendedHistory = appendDealSentEvent([], {
    arrivalCity: '마츠야마',
    sentAt: recentSentAt,
    effectivePrice: 140_440,
    flightId: 'matsuyama-flight',
});
assert.equal(decodeDealSentEvent(appendedHistory[0])?.arrivalCity, '마츠야마');
assert.equal(decodeDealSentEvent('@deal-sent:%E0%A4%A|broken|price|id'), null,
    '깨진 과거 기록이 있어도 전체 알림 발송을 중단하면 안 된다.');

const publicNotification = buildDealNotificationText(condition, {
    ...topCandidate,
    reasons: ['네이버 최저가보다 10% 저렴'],
});
assert.equal(/네이버|naver/i.test(`${publicNotification.title} ${publicNotification.body}`), false,
    '푸시 알림 제목과 본문에 특정 비교 서비스명을 노출하면 안 된다.');
assert.match(publicNotification.body, /외부 비교/);
assert.match(publicNotification.body, /129,000원/);

console.log('✅ 조건형 특가 알림 점수·반복 방지·공개 문구 테스트 통과');
