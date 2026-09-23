import assert from 'node:assert/strict';
import { NaverWorkBoundary } from './lib/naver-work-boundary';
import { buildNaverPriceKey } from '../src/lib/naver-route';

const now = Date.parse('2026-09-23T08:00:00.000Z');
const flight = (source: string, destination: string) => ({
    source, price: 200_000, priceCheckedAt: '2026-09-23T07:00:00.000Z',
    departure: { airport: 'ICN', city: '인천', date: '2026-10-10' },
    arrival: { airport: destination, city: '도쿄', date: '2026-10-13' },
    routeAirports: { outboundDeparture: 'ICN', outboundArrival: destination,
        returnDeparture: destination, returnArrival: 'ICN' },
});
const mrt = flight('myrealtrip', 'NRT');
const other = flight('ybtour', 'KIX');
const mrtKey = buildNaverPriceKey(mrt, mrt.departure.date, mrt.arrival.date)!;
const otherKey = buildNaverPriceKey(other, other.departure.date, other.arrival.date)!;
const state: any = { generation: 0, snapshotSignature: null,
    keys: { [mrtKey]: 'first-mrt', [otherKey]: 'first-other' },
    rechecks: {}, recheckableKeys: [mrtKey, otherKey],
    candidates: {}, used: { A: 2, C: 0 } };
const prices = Object.fromEntries([mrtKey, otherKey].map(key => [key, {
    naverLowest: 230_000, crawledAt: '2026-09-23T06:00:00.000Z', lastAttemptStatus: 'success',
}]));
const boundary = new NaverWorkBoundary({
    client: { workState: async () => state },
    publisher: { updateCandidates: async () => {} },
    identity: { worker: 'A' },
    selectionOptions: { clock: () => now, topCandidateCount: 50, lowCandidateRatio: 0.3,
        maxDeferDays: 7, refreshConfig: { priorityRefreshDays: 2, standardRefreshDays: 2,
            priorityDepartureDays: 14, priorityDiscountRate: 20,
            priceChangeAmount: 10_000, priceChangeRatio: 0.03 } },
});

async function main() {
    const selected = await boundary.refresh({ generation: 1, flights: [mrt, other] }, prices, 10);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].source, 'myrealtrip');
    assert.equal(selected[0].naverSameDayRecheck, true);
    state.rechecks[mrtKey] = 'second-mrt';
    assert.equal((await boundary.refresh({ generation: 1, flights: [mrt, other] }, prices, 10)).length, 0);
    console.log('Naver same-day boundary tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
