import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import { matchPriceDrop, priceDropLabel, priceDropAmountLabel, type HistoricalFlightPrice } from '../src/lib/price-drop-insight';
const now = Date.parse('2026-09-14T01:00:00Z');
const flight = { id: 'a', source: 'modetour', price: 210000, airline: 'air',
    departure: { airport: 'ICN', date: '2026-10-06', time: '00:10' },
    arrival: { airport: 'SGN', date: '2026-10-09', time: '15:25' } } as Flight;
const row: HistoricalFlightPrice = { flight_key: 'key', snapshot_date: '2026-09-13', price_checked_at: '2026-09-13T01:00:00Z',
    source: flight.source, departure_airport: 'ICN', arrival_airport: 'SGN', departure_date: '2026-10-06', return_date: '2026-10-09',
    outbound_time: '00:10', return_time: '15:25', airline: 'air', listed_price: 240000 };
const result = matchPriceDrop(flight, 'key', [row], now)!;
assert.equal(result.amount, 30000);
assert.equal(priceDropLabel(result), '어제보다');
assert.equal(priceDropAmountLabel(result.amount), '3만원');
assert.equal(priceDropAmountLabel(10501), '10,501원');
for (const override of [
    { flight_key: 'other' }, { source: 'ttang' }, { return_date: '2026-10-08' },
    { departure_airport: 'PUS' }, { airline: 'other' }, { outbound_time: '01:10' },
    { return_time: null }, { listed_price: 210000 }, { listed_price: 200000 },
    { snapshot_date: '2026-09-10', price_checked_at: '2026-09-10T01:00:00Z' },
    { snapshot_date: '2026-09-14', price_checked_at: '2026-09-14T01:00:00Z' },
    { price_checked_at: null }, { price_checked_at: '2026-09-12T01:00:00Z' },
]) assert.equal(matchPriceDrop(flight, 'key', [{ ...row, ...override }], now), null, JSON.stringify(override));
const old = { ...row, snapshot_date: '2026-09-11', price_checked_at: '2026-09-10T16:00:00Z', listed_price: 260000 };
assert.equal(matchPriceDrop(flight, 'key', [old], now)?.daysAgo, 3);
assert.equal(matchPriceDrop(flight, 'key', [old, row], now)?.daysAgo, 1);
assert.equal(matchPriceDrop(flight, 'key', [], now), null);
console.log('PASS exact offer/schedule, KST 3-day boundary, real observation date, no decline, nearest comparison, precise amounts');
