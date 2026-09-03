import assert from 'node:assert/strict';
import {
    buildManualTodayPick,
    collectManualPickHistory,
    kstDateKey,
    todayPickDestinationKey,
} from '../src/lib/manual-today-pick';
import type { Flight } from '../src/types/flight';

function flight(overrides: Partial<Flight> = {}): Flight {
    return {
        id: 'manual-flight',
        source: 'modetour',
        airline: '테스트항공',
        departure: { city: '인천', airport: 'ICN', date: '2026-09-20', time: '08:00' },
        arrival: { city: '푸꾸옥', airport: 'PQC', date: '2026-09-24', time: '18:00' },
        price: 140_000,
        currency: 'KRW',
        link: 'https://example.com',
        ...overrides,
    };
}

const now = new Date('2026-09-03T03:00:00.000Z').getTime();
assert.equal(kstDateKey(now), '2026-09-03');
assert.equal(todayPickDestinationKey(flight()), 'PQC');

const storedPick = {
    date: '2026-09-02',
    flightId: 'yesterday-flight',
    source: 'ttang',
    arrivalCity: '장가계',
    destinationKey: 'DYG',
    effectivePrice: 195_000,
    recentPicks: [
        {
            date: '2026-08-27',
            flightId: 'seven-days-ago',
            source: 'modetour',
            arrivalCity: '구마모토',
            destinationKey: 'KMJ',
            effectivePrice: 194_000,
        },
        {
            date: '2026-08-26',
            flightId: 'eight-days-ago',
            source: 'modetour',
            arrivalCity: '오사카',
            destinationKey: 'KIX',
            effectivePrice: 180_000,
        },
    ],
};

assert.deepEqual(
    collectManualPickHistory(storedPick, '2026-09-03').map(pick => pick.flightId),
    ['yesterday-flight', 'seven-days-ago'],
    '직접 선정도 최근 7일 DROP 기록을 유지해야 한다.',
);

const manualPick = buildManualTodayPick(storedPick, flight({
    naverLowest: 160_000,
    naverCheckedAt: '2026-09-03T01:00:00.000Z',
}), now);
assert.equal(manualPick.flightId, 'manual-flight');
assert.equal(manualPick.selectionMode, 'manual');
assert.equal(manualPick.selectedBy, 'admin');
assert.equal(manualPick.referencePrice, 160_000);
assert.equal(manualPick.previousPick?.flightId, 'yesterday-flight');
assert.equal(manualPick.repeatOverride, null);

const sameDayReplacement = buildManualTodayPick(manualPick, flight({ id: 'replacement-flight' }), now + 60_000);
assert.equal(sameDayReplacement.flightId, 'replacement-flight');
assert.deepEqual(
    sameDayReplacement.recentPicks.map(pick => pick.flightId),
    ['yesterday-flight', 'seven-days-ago'],
    '같은 날 다른 표로 바꿔도 먼저 고른 당일 표를 과거 이력에 넣지 않아야 한다.',
);

const ttangPick = buildManualTodayPick(storedPick, flight({
    id: 'ttang-flight',
    source: 'ttang',
    price: 140_000,
}), now);
assert.equal(ttangPick.effectivePrice, 160_000, '땡처리닷컴 발권수수료를 포함한 실결제가를 저장해야 한다.');

const staleNaverPick = buildManualTodayPick(storedPick, flight({
    naverLowest: 160_000,
    naverCheckedAt: '2026-08-20T01:00:00.000Z',
}), now);
assert.equal(staleNaverPick.referencePrice, null, '오래된 네이버 가격은 직접 선정 기록의 기준가로 저장하지 않아야 한다.');

console.log('✅ TIKIT DROP 직접 선정 날짜·이력·실결제가·비교가 처리');
