import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNaverPriceOverLimit } from '../src/lib/naver-price-filter';
import { getEffectivePrice } from '../src/lib/price-quality';
import { getUsableNaverComparison } from '../src/lib/naver-comparison';

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
    { naverLowest: 100_000, crawledAt: new Date(now - 24 * 3600_000 - 1).toISOString() },
    ...['no_result', 'route_error', 'miss'].map(lastAttemptStatus => ({
        naverLowest: 100_000, crawledAt: checkedAt, lastAttemptStatus,
    })),
]) {
    assert.equal(getUsableNaverComparison(entry, now), null);
}
assert.equal(getUsableNaverComparison({ naverLowest: 100_000, crawledAt: checkedAt }, now)?.price, 100_000);

// All three exclusion entry points must use the same policy and retain freshness checks.
for (const file of ['scripts/filter-by-naver.ts', 'src/app/api/flights/route.ts', 'src/lib/flight-static.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /isNaverPriceOverLimit\(/, file);
    assert.match(source, /getUsableNaverComparison\(|getComparisonFreshness\(/, file);
    assert.doesNotMatch(source, /difference < 100_?000|diff >= 100000|10만원·20%/, file);
}
console.log('PASS: Naver 20% OR KRW 100,000 thresholds, fees, missing/stale comparisons, and three entry-point contracts');
