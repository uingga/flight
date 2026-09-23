import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import {
    isVerifiedMyrealtripOffer,
    selectMyrealtripNaverComparison,
} from '../src/lib/myrealtrip-naver-verification';
import { getRecommendationNaverComparison } from '../src/lib/naver-comparison';
import {
    getComparisonPriceTier,
    getPriceExclusionFreshness,
    getRecommendationComparisonFreshness,
} from '../src/lib/price-quality';

const now = Date.parse('2026-09-23T08:10:00.000Z');
const flight = (overrides: Partial<Flight> = {}): Flight => ({
    id: 'mrt-ICN-WEH-20261001-395800', source: 'myrealtrip', price: 183_200,
    departure: { airport: 'ICN', city: '인천', date: '2026-10-01', time: '10:00' },
    arrival: { airport: 'WEH', city: '웨이하이', date: '2026-10-03', time: '10:00' },
    routeAirports: {
        outboundDeparture: 'ICN', outboundArrival: 'WEH',
        returnDeparture: 'WEH', returnArrival: 'ICN',
    },
    airline: 'test', region: '중국', link: 'https://example.com',
    ...overrides,
} as Flight);

const original = flight();
const manual = selectMyrealtripNaverComparison(original, {
    price: 210_000, checkedAt: '2026-09-22T08:00:00.000Z',
}, now);
assert.deepEqual(manual, { price: 177_900, checkedAt: '2026-09-23T07:05:51.201Z' });
assert.equal(isVerifiedMyrealtripOffer(flight({
    naverLowest: manual!.price, naverCheckedAt: manual!.checkedAt,
}), now), false, 'any MRT fare above Naver must be hidden');
assert.deepEqual(selectMyrealtripNaverComparison(original, {
    price: 220_000, checkedAt: '2026-09-23T08:05:00.000Z',
}, now), { price: 220_000, checkedAt: '2026-09-23T08:05:00.000Z' });
assert.equal(selectMyrealtripNaverComparison(flight({ price: 182_000 }), null, now), null);
assert.equal(selectMyrealtripNaverComparison(flight({ routeAirports: {
    outboundDeparture: 'ICN', outboundArrival: 'YNT',
    returnDeparture: 'YNT', returnArrival: 'ICN',
} }), null, now), null, 'manual price must not attach to a different airport');
assert.equal(isVerifiedMyrealtripOffer(original, now), false, 'uncompared MRT must wait');
assert.equal(isVerifiedMyrealtripOffer(flight({
    naverLowest: 190_000, naverCheckedAt: '2026-09-20T00:00:00.000Z',
}), now), false, 'expired comparison must not qualify');
assert.equal(isVerifiedMyrealtripOffer(flight({
    naverLowest: 183_200, naverCheckedAt: '2026-09-23T08:00:00.000Z',
}), now), true, 'equal price qualifies');

const flagged = flight({ id: 'mrt-quick-ICN-PQC-20261013-20261018', price: 191_000,
    naverLowest: 234_400, naverCheckedAt: '2026-09-22T22:18:40.794Z' });
assert.equal(isVerifiedMyrealtripOffer(flagged, now), false, 'reported stale comparison must not qualify');
assert.equal(isVerifiedMyrealtripOffer({ ...flagged,
    naverCheckedAt: '2026-09-23T08:01:00.000Z',
}, now), false, 'the same collector must not clear a user-reported contradiction');
assert.equal(isVerifiedMyrealtripOffer(flight({ source: 'ybtour' }), now), true);

const boundaryNow = Date.parse('2026-09-24T08:00:00.000Z');
const checkedAt = (hours: number, extraMs = 0) =>
    new Date(boundaryNow - hours * 3_600_000 - extraMs).toISOString();
for (const source of ['myrealtrip', 'tripcom'] as const) {
    assert.equal(getRecommendationComparisonFreshness(checkedAt(12), boundaryNow, source).fullStrength, true);
    assert.equal(getRecommendationComparisonFreshness(checkedAt(12, 1), boundaryNow, source).reducedStrength, true);
    assert.equal(getRecommendationComparisonFreshness(checkedAt(24), boundaryNow, source).usable, true);
    assert.equal(getRecommendationComparisonFreshness(checkedAt(24, 1), boundaryNow, source).usable, false);
    assert.equal(getPriceExclusionFreshness(checkedAt(24, 1), boundaryNow, source).usable, false);
    assert.equal(getRecommendationNaverComparison({ naverLowest: 190_000, crawledAt: checkedAt(24, 1) }, boundaryNow, source), null);
    assert.equal(getComparisonPriceTier(flight({ source, naverLowest: 190_000, naverCheckedAt: checkedAt(12) }), boundaryNow), 0);
    assert.equal(getComparisonPriceTier(flight({ source, naverLowest: 190_000, naverCheckedAt: checkedAt(12, 1) }), boundaryNow), 1);
}
assert.equal(selectMyrealtripNaverComparison(flight({ price: 182_000 }), {
    price: 190_000, checkedAt: checkedAt(24, 1),
}, boundaryNow), null, 'an expired coordinated comparison must be absent');
assert.equal(isVerifiedMyrealtripOffer(flight({
    id: 'mrt-unreported', naverLowest: 190_000, naverCheckedAt: checkedAt(24, 1),
}), boundaryNow), false, 'an MRT fare without a comparison within 24h must be hidden');
assert.equal(getRecommendationComparisonFreshness(checkedAt(48), boundaryNow, 'ybtour').fullStrength, true);
assert.equal(getRecommendationComparisonFreshness(checkedAt(72), boundaryNow, 'ybtour').usable, true);

console.log('MyRealTrip Naver verification tests passed');
