import assert from 'node:assert/strict';
import {
    buildNearbyNaverPriceIndex,
    getNearbyNaverPriceContext,
    getNearbyNaverRecommendationAdjustment,
    type NearbyNaverPriceEntry,
} from '../src/lib/naver-nearby-price';
import type { Flight } from '../src/types/flight';

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
    // 0~7일 전에 수집한 표본
    'ICN-TST_2026-09-08_2026-09-11': sample(100_000, '2026-08-30T12:00:00+09:00'),
    // 8~14일 전에 수집한 표본도 동일하게 포함
    'ICN-TST_2026-09-11_2026-09-14': sample(200_000, '2026-08-21T12:00:00+09:00'),
    'ICN-TST_2026-09-15_2026-09-19': sample(300_000, '2026-08-17T13:00:00+09:00'),
    // 정확한 동일 일정은 인접 일정 표본에서 제외
    'ICN-TST_2026-09-10_2026-09-13': sample(90_000, '2026-08-31T08:00:00+09:00'),
    // 14일을 넘긴 표본, 다른 노선, 여행기간 차이가 큰 표본도 제외
    'ICN-TST_2026-09-09_2026-09-12': sample(1, '2026-08-17T11:59:59+09:00'),
    'ICN-OTHER_2026-09-10_2026-09-13': sample(1, '2026-08-31T08:00:00+09:00'),
    'ICN-TST_2026-09-12_2026-09-20': sample(1, '2026-08-31T08:00:00+09:00'),
}, now);

const context = getNearbyNaverPriceContext(index, flight());
assert.equal(context.sampleCount, 3, '최근 14일의 유효한 인접 일정 세 건만 포함해야 한다.');
assert.equal(
    context.baseline,
    150_000,
    '3개 표본의 25백분위는 최저가 한 건이 아니라 1·2번째 가격 사이의 150,000원이어야 한다.',
);

const adjustment = getNearbyNaverRecommendationAdjustment(flight({
    naverLowest: 300_000,
    naverCheckedAt: '2026-08-31T08:00:00+09:00',
    nearbyNaverBaseline: context.baseline || undefined,
    nearbyNaverSampleCount: context.sampleCount,
}), now);
assert.equal(adjustment.multiplier, 1.3, '인접 기준보다 30% 넘게 비싼 표에는 느슨한 최대 감점을 적용해야 한다.');
assert.equal(adjustment.todayPickExcluded, true, '30%·5만원 이상 비싼 표는 오늘의 표에서 제외해야 한다.');

const sparseIndex = buildNearbyNaverPriceIndex({
    'ICN-TST_2026-09-08_2026-09-11': sample(100_000, '2026-08-30T12:00:00+09:00'),
    'ICN-TST_2026-09-11_2026-09-14': sample(200_000, '2026-08-20T12:00:00+09:00'),
}, now);
const sparseContext = getNearbyNaverPriceContext(sparseIndex, flight());
assert.equal(sparseContext.sampleCount, 2);
assert.equal(sparseContext.baseline, null, '표본이 1~2개면 인접 기준가를 만들지 않아야 한다.');

const sparseAdjustment = getNearbyNaverRecommendationAdjustment(flight({
    naverLowest: 300_000,
    naverCheckedAt: '2026-08-31T08:00:00+09:00',
    nearbyNaverBaseline: 100_000,
    nearbyNaverSampleCount: 2,
}), now);
assert.equal(sparseAdjustment.multiplier, 1, '표본이 3개 미만이면 추천 감점을 적용하지 않아야 한다.');

console.log('✅ 최근 14일 동일 가중치 · 인접 일정 · 25백분위 기준가 · 희소 표본 보호');
