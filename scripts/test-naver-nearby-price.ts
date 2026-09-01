import assert from 'node:assert/strict';
import {
    buildNearbyNaverPriceIndex,
    getNearbyNaverPriceContext,
    getNearbyNaverRecommendationAdjustment,
    type NearbyNaverPriceEntry,
} from '../src/lib/naver-nearby-price';
import type { Flight } from '../src/types/flight';
import { buildRecommendationScoreState } from '../src/lib/flight-recommendation';

const now = new Date('2026-08-31T12:00:00+09:00').getTime();

function flight(overrides: Partial<Flight> = {}): Flight {
    return {
        id: 'candidate',
        source: 'modetour',
        airline: '테스트항공',
        departure: { city: '인천', airport: 'ICN', date: '2026-09-10', time: '08:00' },
        arrival: { city: '테스트', airport: 'TST', date: '2026-09-13', time: '18:00' },
        price: 220_000,
        currency: 'KRW',
        link: 'https://example.com',
        ...overrides,
    };
}

function sample(price: number, crawledAt: string, status = 'success'): NearbyNaverPriceEntry {
    return { naverLowest: price, crawledAt, lastAttemptStatus: status };
}

const index = buildNearbyNaverPriceIndex({
    // 출발일 앞뒤 14일은 거리에 따른 감쇠 없이 여행 기간이 달라도 모두 비교한다.
    'ICN-TST_2026-09-08_2026-09-11': sample(100_000, '2026-08-30T12:00:00+09:00'),
    'ICN-TST_2026-09-11_2026-09-18': sample(200_000, '2026-08-21T12:00:00+09:00'),
    'ICN-TST_2026-09-15_2026-09-16': sample(300_000, '2026-08-17T13:00:00+09:00'),
    'ICN-TST_2026-09-22_2026-09-27': sample(400_000, '2026-08-17T13:00:00+09:00'),
    // 정확한 동일 일정은 인접 일정 표본에서 제외
    'ICN-TST_2026-09-10_2026-09-13': sample(90_000, '2026-08-31T08:00:00+09:00'),
    // 60일을 넘긴 수집값, 다른 노선, 출발일이 14일 밖인 표본은 제외
    'ICN-TST_2026-09-09_2026-09-12': sample(1, '2026-06-30T11:59:59+09:00'),
    'ICN-OTHER_2026-09-10_2026-09-13': sample(1, '2026-08-31T08:00:00+09:00'),
    'ICN-TST_2026-09-25_2026-09-27': sample(1, '2026-08-31T08:00:00+09:00'),
}, now);

const context = getNearbyNaverPriceContext(index, flight());
assert.equal(context.sampleCount, 4, '출발일 앞뒤 14일의 일정은 거리 감쇠 없이 포함해야 한다.');
assert.equal(
    context.baseline,
    250_000,
    '인접 일정 네 건의 중간값인 250,000원을 기준가로 사용해야 한다.',
);

const adjustment = getNearbyNaverRecommendationAdjustment(flight({
    price: 400_000,
    naverLowest: 500_000,
    naverCheckedAt: '2026-08-31T08:00:00+09:00',
    nearbyNaverBaseline: context.baseline || undefined,
    nearbyNaverSampleCount: context.sampleCount,
}), now);
assert.equal(adjustment.multiplier, 1.3, '인접 기준보다 30% 넘게 비싼 표에는 느슨한 최대 감점을 적용해야 한다.');
assert.equal(adjustment.todayPickExcluded, true, '30%·5만원 이상 비싼 표는 오늘의 표에서 제외해야 한다.');

const sparseIndex = buildNearbyNaverPriceIndex({
    'ICN-TST_2026-09-08_2026-09-11': sample(100_000, '2026-08-30T12:00:00+09:00'),
}, now);
const sparseContext = getNearbyNaverPriceContext(sparseIndex, flight());
assert.equal(sparseContext.sampleCount, 1);
assert.equal(sparseContext.baseline, 100_000, '표본 한 건도 참고 기준가는 남겨야 한다.');

const sparseAdjustment = getNearbyNaverRecommendationAdjustment(flight({
    naverLowest: 300_000,
    naverCheckedAt: '2026-08-31T08:00:00+09:00',
    nearbyNaverBaseline: 100_000,
    nearbyNaverSampleCount: 1,
}), now);
assert.equal(sparseAdjustment.multiplier, 1, '표본 한 건은 순위를 강하게 바꾸는 감점에 사용하지 않아야 한다.');

const twoSampleIndex = buildNearbyNaverPriceIndex({
    'ICN-TST_2026-09-08_2026-09-11': sample(100_000, '2026-08-30T12:00:00+09:00'),
    'ICN-TST_2026-09-15_2026-09-22': sample(300_000, '2026-08-10T12:00:00+09:00'),
}, now);
const twoSampleContext = getNearbyNaverPriceContext(twoSampleIndex, flight());
assert.equal(twoSampleContext.sampleCount, 2);
assert.equal(twoSampleContext.baseline, 200_000, '표본 두 건부터 중간값을 정식 가격 근거로 사용해야 한다.');

const recommendationFlight = flight({
    price: 200_000,
    naverLowest: 300_000,
    priceCheckedAt: '2026-08-31T11:00:00+09:00',
});
const recommendationRank = (checkedAt: string) => buildRecommendationScoreState([
    { ...recommendationFlight, naverCheckedAt: checkedAt },
], {}, now).explanations.get('candidate')!;
const freshRecommendation = recommendationRank('2026-08-30T12:00:00+09:00');
const graceRecommendation = recommendationRank('2026-08-29T00:00:00+09:00');
const expiredRecommendation = recommendationRank('2026-08-28T11:59:59+09:00');
assert.equal(freshRecommendation.naverCompetitivenessRank, 0, '48시간 이내 비교가는 원래 최상위 근거를 유지해야 한다.');
assert.equal(graceRecommendation.naverCompetitivenessRank, 1, '48~72시간 비교가는 한 단계 낮춰 반영해야 한다.');
assert.equal(graceRecommendation.naverEvidenceStrength, 1, '완화 구간의 강한 근거는 보통 근거로 낮춰야 한다.');
assert.equal(expiredRecommendation.naverCompetitivenessRank, 3, '72시간을 넘기면 동일 일정 비교가 없음으로 처리해야 한다.');
assert.equal(expiredRecommendation.comparisonPrice, null);

console.log('✅ 출발일 ±14일 · 네이버 비교가 48시간 정상/72시간 완화 · 제거 필터 24시간 유지');
