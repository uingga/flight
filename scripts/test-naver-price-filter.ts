import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNaverPriceOverLimit } from '../src/lib/naver-price-filter';
import { getEffectivePrice, getComparisonFreshness, getPriceExclusionFreshness } from '../src/lib/price-quality';
import { getPriceExclusionNaverComparison } from '../src/lib/naver-comparison';

const now = Date.parse('2026-09-09T05:00:00Z');
const checkedAt = new Date(now).toISOString();
const cases: Array<[number, number, boolean]> = [
    [119_999, 100_000, false],
    [120_000, 100_000, true],
    [120_001, 100_000, true],
    [100_000, 100_000, false],
    [90_000, 100_000, false],
    [1_099_999, 1_000_000, false],
    [1_100_000, 1_000_000, true],
    [1_100_001, 1_000_000, true],
    [1_050_000, 900_000, true],
    [1_200_000, 1_000_000, true],
    [120_001, 100_001, false],
    [120_002, 100_001, true],
    [200_000, 0, false],
    [200_000, NaN, false],
    [200_000, Infinity, false],
];
for (const [price, comparison, excluded] of cases) {
    assert.equal(isNaverPriceOverLimit(price, comparison), excluded, `${price}/${comparison}`);
}
assert.equal(isNaverPriceOverLimit(getEffectivePrice({ source: 'ttang', price: 100_000 }), 100_000), true);
assert.equal(isNaverPriceOverLimit(getEffectivePrice({ source: 'ybtour', price: 100_000 }), 100_000), false);
assert.equal(isNaverPriceOverLimit(getEffectivePrice({ source: 'ttang', price: 980_000 }), 900_000), true);
assert.equal(isNaverPriceOverLimit(getEffectivePrice({ source: 'ybtour', price: 980_000 }), 900_000), false);

// No usable exact-itinerary comparison means no price exclusion.
for (const entry of [
    undefined,
    { naverLowest: null, crawledAt: checkedAt },
    { naverLowest: 100_000 },
    { naverLowest: 100_000, crawledAt: new Date(now - 72 * 3600_000 - 1).toISOString() },
    { naverLowest: 100_000, crawledAt: 'invalid' },
    ...['no_result', 'route_error', 'miss'].map(lastAttemptStatus => ({
        naverLowest: 100_000, crawledAt: checkedAt, lastAttemptStatus,
    })),
]) {
    assert.equal(getPriceExclusionNaverComparison(entry, now), null);
}
assert.equal(getPriceExclusionNaverComparison({ naverLowest: 100_000, crawledAt: checkedAt }, now)?.price, 100_000);

for (const hours of [24, 27, 30, 48, 72]) {
    const timestamp = new Date(now - hours * 3600_000).toISOString();
    assert.equal(getPriceExclusionFreshness(timestamp, now).usable, true);
    assert.equal(getPriceExclusionNaverComparison({ naverLowest: 100_000, crawledAt: timestamp }, now)?.price, 100_000);
}
assert.equal(getPriceExclusionFreshness(new Date(now - 72 * 3600_000 - 1).toISOString(), now).usable, false);
assert.equal(getPriceExclusionFreshness(undefined, now).usable, false);
assert.equal(getComparisonFreshness(new Date(now - 24 * 3600_000 - 1).toISOString(), now).usable, false);

// Reported tickets remain excluded beyond 24h, including the Ttang issuance fee.
for (const [source, price, comparison, hours] of [
    ['myrealtrip', 903_600, 680_293, 30],
    ['myrealtrip', 907_900, 700_696, 30],
    ['ttang', 285_000, 195_800, 27],
] as const) {
    const timestamp = new Date(now - hours * 3600_000).toISOString();
    const entry = getPriceExclusionNaverComparison({ naverLowest: comparison, crawledAt: timestamp }, now);
    assert.ok(entry);
    assert.equal(isNaverPriceOverLimit(getEffectivePrice({ source, price }), entry.price), true);
}

// MyRealTrip & Trip.com: exclude only when both limits are reached.
const mrtCases: Array<[number, number, boolean]> = [
    [102_999, 100_000, false], // 2.999% and < 10,000 won -> false
    [103_000, 100_000, false], // 3% but < 10,000 won -> false
    [103_001, 100_000, false], // > 3% but < 10,000 won -> false
    [109_999, 100_000, false], // > 3% but < 10,000 won -> false
    [110_000, 100_000, true],  // 10,000 won and >= 3% -> true
    [1_009_999, 1_000_000, false], // 0.9999% and < 10,000 won -> false
    [1_010_000, 1_000_000, false], // 10,000 won but < 3% -> false
    [1_020_000, 1_000_000, false], // 20,000 won but < 3% -> false
    [1_030_000, 1_000_000, true],  // 30,000 won and 3% -> true
    [100_000, 100_000, false],     // same price -> false
    [90_000, 100_000, false],      // cheaper -> false
];
for (const [price, comparison, excluded] of mrtCases) {
    assert.equal(isNaverPriceOverLimit(price, comparison, 'myrealtrip'), excluded, `MRT ${price}/${comparison}`);
    assert.equal(isNaverPriceOverLimit(price, comparison, 'tripcom'), excluded, `Trip.com ${price}/${comparison}`);
}

// All three exclusion entry points must use the same policy and retain freshness checks.
for (const file of ['scripts/filter-by-naver.ts', 'src/lib/server/public-flights-response.ts', 'src/lib/flight-static.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /isNaverPriceOverLimit\(/, file);
    assert.match(source, /getPriceExclusionNaverComparison\(|getPriceExclusionFreshness\(/, file);
    assert.doesNotMatch(source, /difference < 100_?000|diff >= 100000|10만원·20%/, file);
}
console.log('PASS: Naver thresholds (general OR; MRT/Trip.com both 3% and 10k), fees, missing/stale comparisons, and three entry-point contracts');
