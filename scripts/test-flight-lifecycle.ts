import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import { buildLifecycleIdentity, seatAvailability, toLifecycleSnapshot } from './lib/flight-lifecycle';

function flight(overrides: Partial<Flight> = {}): Flight {
    return {
        id: 'mrt-ICN-MYJ-20260916-169700',
        source: 'myrealtrip',
        airline: '제주항공',
        departure: {
            city: '서울(인천)',
            airport: 'ICN',
            date: '2026-09-16',
            time: '07:15',
        },
        arrival: {
            city: '마츠야마',
            airport: 'MYJ',
            date: '2026-09-22',
            time: '10:30',
        },
        price: 169_700,
        currency: 'KRW',
        link: 'https://example.com',
        availableSeats: 9,
        ...overrides,
    };
}

const original = flight();
const repriced = flight({ id: 'mrt-ICN-MYJ-20260916-142700', price: 142_700 });
assert.equal(
    buildLifecycleIdentity(original).offerKey,
    buildLifecycleIdentity(repriced).offerKey,
    '마이리얼트립 가격·가격 포함 ID가 바뀌어도 같은 판매 회차여야 합니다.',
);

const differentReturn = flight({
    arrival: { ...original.arrival, date: '2026-09-23' },
});
assert.notEqual(
    buildLifecycleIdentity(original).offerKey,
    buildLifecycleIdentity(differentReturn).offerKey,
    '오는 날짜가 달라지면 다른 판매 회차여야 합니다.',
);

const differentSchedule = flight({
    departure: { ...original.departure, time: '12:40' },
});
assert.notEqual(
    buildLifecycleIdentity(original).offerKey,
    buildLifecycleIdentity(differentSchedule).offerKey,
    '실제 운항 일정이 바뀌면 다른 항공권으로 구분해야 합니다.',
);

const ybOriginal = flight({ source: 'ybtour', id: 'ybtour-price-hash-a', price: 210_000, availableSeats: 4 });
const ybRepriced = flight({ source: 'ybtour', id: 'ybtour-price-hash-b', price: 180_000, availableSeats: 3 });
assert.equal(
    buildLifecycleIdentity(ybOriginal).offerKey,
    buildLifecycleIdentity(ybRepriced).offerKey,
    '노랑풍선의 가격 포함 해시 ID가 바뀌어도 같은 일정은 이어져야 합니다.',
);

assert.deepEqual(seatAvailability(original), { value: 9, kind: 'at_least' });
assert.deepEqual(seatAvailability(ybOriginal), { value: 4, kind: 'exact' });

const compared = flight({ naverLowest: 188_000, naverCheckedAt: '2026-08-24T01:00:00Z' });
const comparedSnapshot = toLifecycleSnapshot(compared, true);
assert.equal(comparedSnapshot.comparisonPrice, 188_000);
assert.equal(comparedSnapshot.comparisonCheckedAt, '2026-08-24T01:00:00.000Z');

console.log('항공권 생애 식별자 테스트 통과');
