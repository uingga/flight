import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDropCardReason as reason, exactWon } from '../src/lib/drop-card-reason';

const base = { origin: '부산', destination: '광저우', price: 199000,
    today: '2026-09-09', departureDate: '2026-09-20' };
const repeat = { previousDate: '2026-09-05', previousEffectivePrice: 280000,
    currentEffectivePrice: 199000, dropAmount: 81000 };

test('reselection uses the historical selection date, not yesterday', () => {
    assert.equal(reason({ ...base, repeat }), '9월 5일 선정가보다 8.1만원 내렸어요');
});
test('missing or invalid dates do not invent a comparison date', () => {
    for (const previousDate of [undefined, '2026-02-30', '2026-09-10', '2026-09-09']) {
        assert.equal(reason({ ...base, repeat: { ...repeat, previousDate } }), '지난 선정가보다 8.1만원 내렸어요');
    }
});
test('stale prices and inconsistent differences do not claim a drop', () => {
    assert.equal(reason({ ...base, price: 210000, repeat }), '부산에서 광저우, 왕복 21만원이에요');
    assert.equal(reason({ ...base, repeat: { ...repeat, dropAmount: 90000 } }), '부산에서 광저우, 왕복 19.9만원이에요');
});
test('valid monthly comparison takes priority over departure and seats', () => {
    assert.equal(reason({ ...base, averageDiscountRate: 30, departureDate: '2026-09-12', seats: 4 }), '같은 목적지 월평균가보다 30% 저렴해요');
});
test('departure copy is calendar based, including today and month boundaries', () => {
    assert.equal(reason({ ...base, departureDate: '2026-09-12' }), '3일 뒤 출발하는 부산발 표예요');
    assert.equal(reason({ ...base, departureDate: base.today }), '오늘 출발하는 부산발 표예요');
    assert.equal(reason({ ...base, today: '2026-09-30', departureDate: '2026-10-02' }), '2일 뒤 출발하는 부산발 표예요');
});
test('only positive whole seat counts produce an inventory claim', () => {
    assert.equal(reason({ ...base, seats: 4 }), '지금 확인되는 좌석은 4석이에요');
    for (const seats of [undefined, 0, -1, 2.5, NaN]) assert.equal(reason({ ...base, seats }), '부산에서 광저우, 왕복 19.9만원이에요');
});
test('money is never rounded into an inaccurate saving', () => {
    assert.equal(exactWon(81300), '81,300원');
    assert.equal(exactWon(81000), '8.1만원');
    assert.equal(exactWon(9500), '9,500원');
});
test('no unsupported weekend or annual-low claim is produced', () => {
    for (const averageDiscountRate of [0, 4, 100, Infinity, NaN]) {
        const text = reason({ ...base, averageDiscountRate });
        assert.equal(text, '부산에서 광저우, 왕복 19.9만원이에요');
        assert.doesNotMatch(text, /주말|연차|최저가/);
    }
});
