import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import {
    clearUnsupportedInterparkDiscount,
    evaluateInterparkBenchmark,
    isInterparkBenchmarkApplicable,
} from '../src/lib/interpark-benchmark';

const flight = (airport: string, city: string, price = 350_000): Flight => ({
    id: `${airport}-${price}`,
    source: 'ybtour',
    airline: '테스트항공',
    departure: { city, airport, date: '2026-09-10', time: '10:00' },
    arrival: { city: '후쿠오카', airport: 'FUK', date: '2026-09-13', time: '13:00' },
    price,
    currency: 'KRW',
    link: 'https://example.invalid',
});

const benchmark = {
    prices: {
        FUK: { '2026-09': { avg: 300_000, lowest: 200_000 } },
    },
};

assert.equal(isInterparkBenchmarkApplicable(flight('ICN', '인천')), true);
assert.equal(isInterparkBenchmarkApplicable(flight('GMP', '김포')), true);
for (const [airport, city] of [['PUS', '부산'], ['TAE', '대구'], ['CJJ', '청주'], ['CJU', '제주']]) {
    assert.equal(isInterparkBenchmarkApplicable(flight(airport, city)), true, `${airport}는 출발지별 기준가 수집 대상임`);
}
assert.equal(isInterparkBenchmarkApplicable({ departure: { city: '서울' } }), true);
assert.equal(isInterparkBenchmarkApplicable({ departure: { city: '부산' } }), true);

const expensiveSeoul = evaluateInterparkBenchmark(flight('ICN', '인천'), benchmark);
assert.equal(expensiveSeoul.applicable, true);
assert.equal(expensiveSeoul.keep, false);

const expensiveBusan = evaluateInterparkBenchmark(flight('PUS', '부산'), benchmark);
assert.equal(expensiveBusan.applicable, true);
assert.equal(expensiveBusan.keep, true);
assert.equal(expensiveBusan.discountRate, 0);

const busanBenchmark = {
    ...benchmark,
    pricesByOrigin: {
        PUS: {
            FUK: { '2026-09': { avg: 300_000, lowest: 200_000 } },
        },
    },
};
const expensiveBusanWithPrice = evaluateInterparkBenchmark(flight('PUS', '부산'), busanBenchmark);
assert.equal(expensiveBusanWithPrice.applicable, true);
assert.equal(expensiveBusanWithPrice.keep, false);

const cheapSeoul = evaluateInterparkBenchmark(flight('ICN', '인천', 150_000), benchmark);
assert.equal(cheapSeoul.keep, true);
assert.equal(cheapSeoul.discountRate, 25);

const staleBusanDiscount = flight('PUS', '부산', 150_000);
staleBusanDiscount.discountRate = 42;
clearUnsupportedInterparkDiscount(staleBusanDiscount, benchmark);
assert.equal(staleBusanDiscount.discountRate, 0);

const validSeoulDiscount = flight('ICN', '인천', 150_000);
validSeoulDiscount.discountRate = 25;
clearUnsupportedInterparkDiscount(validSeoulDiscount, benchmark);
assert.equal(validSeoulDiscount.discountRate, 25);

console.log('인터파크 출발지별 기준 범위 테스트 통과');
