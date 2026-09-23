import assert from 'node:assert/strict';
import {
    buildNaverSourceSignature,
    evaluateNaverRefresh,
    getNaverRefreshTier,
    type NaverRefreshConfig,
    type NaverRefreshFlight,
} from '../src/lib/naver-refresh-policy.ts';

const config: NaverRefreshConfig = {
    priorityRefreshDays: 2,
    standardRefreshDays: 5,
    priorityDepartureDays: 14,
    priorityDiscountRate: 20,
    priceChangeAmount: 10_000,
    priceChangeRatio: 0.03,
};
const now = new Date('2026-08-29T05:30:00Z').getTime();

const flight = (overrides: Partial<NaverRefreshFlight> = {}): NaverRefreshFlight => ({
    source: 'ybtour',
    price: 220_000,
    airline: '티키항공',
    flightNumber: 'TK101',
    discountRate: 10,
    departure: {
        airport: 'ICN',
        city: '인천',
        date: '2026-09-20',
        time: '08:00',
        arrivalTime: '10:00',
    },
    arrival: {
        date: '2026-09-23',
        time: '18:00',
        arrivalTime: '20:00',
    },
    ...overrides,
});

assert.equal(getNaverRefreshTier(flight(), now, config), 'standard');
assert.equal(getNaverRefreshTier(flight({ discountRate: 20 }), now, config), 'priority');
assert.equal(getNaverRefreshTier(flight({
    discountRate: 20,
    departure: { airport: 'PUS', city: '부산', date: '2026-09-20' },
}), now, config), 'priority');
assert.equal(getNaverRefreshTier(flight({
    departure: { airport: 'ICN', city: '인천', date: '2026-09-10', time: '08:00', arrivalTime: '10:00' },
}), now, config), 'priority');

const baseline = flight();
const signature = buildNaverSourceSignature(baseline);
assert.equal(buildNaverSourceSignature({ ...baseline, price: 230_000 }) === signature, false);
assert.equal(buildNaverSourceSignature({
    ...baseline,
    departure: { ...baseline.departure, time: '09:00' },
}), signature);
assert.equal(buildNaverSourceSignature({ ...baseline, discountRate: 30 }), signature);

assert.equal(evaluateNaverRefresh(undefined, baseline, now, config).reason, 'new');
assert.equal(evaluateNaverRefresh({
    crawledAt: '2026-08-28T05:30:00Z',
    lastAttemptStatus: 'success',
    sourceSignature: signature,
    sourcePrice: 220_000,
}, baseline, now, config).reason, 'standard_fresh');
assert.equal(evaluateNaverRefresh({
    crawledAt: '2026-08-24T05:30:00Z',
    lastAttemptStatus: 'success',
    sourceSignature: signature,
    sourcePrice: 220_000,
}, baseline, now, config).reason, 'standard_periodic');
assert.equal(evaluateNaverRefresh({
    crawledAt: '2026-08-28T05:30:00Z',
    lastAttemptStatus: 'success',
    sourceSignature: signature,
    sourcePrice: 220_000,
}, { ...baseline, price: 230_000 }, now, config).reason, 'standard_fresh');
assert.equal(evaluateNaverRefresh({
    crawledAt: '2026-08-28T05:31:00Z',
    lastAttemptStatus: 'success',
    sourceSignature: signature,
    sourcePrice: 220_000,
}, { ...baseline, price: 230_000 }, now, config).reason, 'standard_fresh');
assert.equal(evaluateNaverRefresh({
    crawledAt: '2026-08-29T01:30:00Z',
    lastAttemptStatus: 'success',
    sourceSignature: signature,
    sourcePrice: 220_000,
}, { ...baseline, price: 230_000 }, now, config).reason, 'standard_fresh');
assert.equal(evaluateNaverRefresh({
    crawledAt: '2026-08-28T05:30:00Z',
    lastAttemptStatus: 'success',
    sourceSignature: signature,
    sourcePrice: 220_000,
}, { ...baseline, price: 225_000 }, now, config).reason, 'standard_fresh');

for (const source of ['myrealtrip', 'tripcom']) {
    const shortWindowFlight = flight({ source, price: 220_000, priceCheckedAt: '2026-08-29T02:00:00Z' });
    const sameDayEntry = {
        naverLowest: 230_000,
        crawledAt: '2026-08-29T01:30:00Z',
        lastAttemptStatus: 'success',
    };
    assert.equal(evaluateNaverRefresh(sameDayEntry, shortWindowFlight, now, config).reason, 'same_day_recheck');
    assert.equal(evaluateNaverRefresh({ ...sameDayEntry, sameDayRecheckAt: '2026-08-29T03:00:00Z' }, shortWindowFlight, now, config).fresh, true);
    assert.equal(evaluateNaverRefresh({ ...sameDayEntry, lastAttemptAt: '2026-08-29T03:00:00Z', lastAttemptStatus: 'miss' }, shortWindowFlight, now, config).reason, 'retry_wait');
    assert.equal(evaluateNaverRefresh({ ...sameDayEntry, naverLowest: 210_000 }, shortWindowFlight, now, config).fresh, true);
    assert.equal(evaluateNaverRefresh({ ...sameDayEntry, crawledAt: '2026-08-28T05:30:00Z' }, shortWindowFlight, now, config).reason, 'standard_periodic');
    assert.equal(evaluateNaverRefresh({ ...sameDayEntry, crawledAt: '2026-08-28T22:30:00Z' }, flight({ source, price: 220_000 }), now, config).reason, 'same_day_recheck');
}
assert.equal(evaluateNaverRefresh({ naverLowest: 230_000, crawledAt: '2026-08-29T00:00:00Z', lastAttemptStatus: 'success' }, baseline, now, config).reason, 'standard_fresh');
assert.equal(evaluateNaverRefresh({
    crawledAt: '2026-08-25T05:30:00Z',
    lastAttemptAt: '2026-08-29T01:30:00Z',
    lastAttemptStatus: 'transient_error',
    sourceSignature: signature,
    sourcePrice: 220_000,
}, { ...baseline, price: 230_000 }, now, config).reason, 'retry_wait');

assert.equal(evaluateNaverRefresh({
    crawledAt: '2026-08-25T05:30:00Z',
    lastAttemptAt: '2026-08-28T12:30:00Z',
    lastAttemptStatus: 'transient_error',
    sourceSignature: signature,
    sourcePrice: 220_000,
}, { ...baseline, price: 230_000 }, now, config).reason, 'retry_due');

for (const price of [219_000, 221_000, 100_000, 500_000]) {
    const entry = {crawledAt:'2026-08-28T05:30:00Z',lastAttemptStatus:'success',
        sourceSignature:signature,sourcePrice:220_000};
    const before = JSON.stringify(entry);
    assert.equal(evaluateNaverRefresh(entry,{...baseline,price},now,config).fresh,true);
    assert.equal(JSON.stringify(entry),before);
    assert.equal(evaluateNaverRefresh({...entry,crawledAt:'2026-08-24T05:30:00Z'},
        {...baseline,price},now,config).reason,'standard_periodic');
    assert.equal(evaluateNaverRefresh(undefined,{...baseline,price},now,config).reason,'new');
}
console.log('Naver refresh policy tests passed');
