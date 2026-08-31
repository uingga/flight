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
    // 출발일 ±30일 안에서 다섯 건을 우선 사용
    'ICN-TST_2026-09-08_2026-09-11': sample(100_000, '2026-08-30T12:00:00+09:00'),
    'ICN-TST_2026-09-11_2026-09-14': sample(200_000, '2026-08-21T12:00:00+09:00'),
    'ICN-TST_2026-09-15_2026-09-19': sample(300_000, '2026-08-17T13:00:00+09:00'),
    'ICN-TST_2026-09-20_2026-09-23': sample(250_000, '2026-08-10T13:00:00+09:00'),
    'ICN-TST_2026-10-05_2026-10-08': sample(150_000, '2026-08-01T13:00:00+09:00'),
    // 정확한 동일 일정은 인접 일정 표본에서 제외
    'ICN-TST_2026-09-10_2026-09-13': sample(90_000, '2026-08-31T08:00:00+09:00'),
    // 60일을 넘긴 수집값, 다른 노선, 여행기간 차이가 큰 표본도 제외
    'ICN-TST_2026-09-09_2026-09-12': sample(1, '2026-06-30T11:59:59+09:00'),
    'ICN-OTHER_2026-09-10_2026-09-13': sample(1, '2026-08-31T08:00:00+09:00'),
    'ICN-TST_2026-09-12_2026-09-20': sample(1, '2026-08-31T08:00:00+09:00'),
}, now);

const context = getNearbyNaverPriceContext(index, flight());
assert.equal(context.sampleCount, 5, '출발일 ±30일의 유효한 인접 일정 다섯 건을 포함해야 한다.');
assert.equal(
    context.baseline,
    150_000,
    '5개 표본의 25백분위인 150,000원을 기준가로 사용해야 한다.',
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
    'ICN-TST_2026-09-15_2026-09-18': sample(300_000, '2026-08-10T12:00:00+09:00'),
    'ICN-TST_2026-10-20_2026-10-23': sample(400_000, '2026-08-01T12:00:00+09:00'),
}, now);
const sparseContext = getNearbyNaverPriceContext(sparseIndex, flight());
assert.equal(sparseContext.sampleCount, 4);
assert.equal(sparseContext.baseline, null, '±60일까지 넓혀도 표본이 5개 미만이면 기준가를 만들지 않아야 한다.');

const sparseAdjustment = getNearbyNaverRecommendationAdjustment(flight({
    naverLowest: 300_000,
    naverCheckedAt: '2026-08-31T08:00:00+09:00',
    nearbyNaverBaseline: 100_000,
    nearbyNaverSampleCount: 4,
}), now);
assert.equal(sparseAdjustment.multiplier, 1, '표본이 5개 미만이면 추천 감점을 적용하지 않아야 한다.');

const fallbackIndex = buildNearbyNaverPriceIndex({
    'ICN-TST_2026-09-08_2026-09-11': sample(100_000, '2026-08-30T12:00:00+09:00'),
    'ICN-TST_2026-09-11_2026-09-14': sample(150_000, '2026-08-20T12:00:00+09:00'),
    'ICN-TST_2026-09-15_2026-09-18': sample(200_000, '2026-08-10T12:00:00+09:00'),
    'ICN-TST_2026-09-20_2026-09-23': sample(250_000, '2026-08-05T12:00:00+09:00'),
    'ICN-TST_2026-10-20_2026-10-23': sample(300_000, '2026-08-01T12:00:00+09:00'),
}, now);
const fallbackContext = getNearbyNaverPriceContext(fallbackIndex, flight());
assert.equal(fallbackContext.sampleCount, 5);
assert.equal(fallbackContext.baseline, 150_000, '±30일 표본이 네 건이면 ±60일의 다섯 번째 표본까지 사용해야 한다.');

console.log('✅ ±30일 우선·±60일 보완 · 25백분위 기준가 · 희소 표본 보호');
