import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import { findRecentFlight, parseRecentFlights, rememberFlight, recentFlightSnapshot } from '../src/lib/recent-flights';
const now = Date.parse('2026-09-07T08:00:00Z');
const f: Flight = { id: 'a', source: 'hanatour', airline: 'test', price: 100000, currency: 'KRW', link: 'https://example.invalid',
    departure: { city: '인천', airport: 'ICN', date: '2026-09-20', time: '10:00' },
    arrival: { city: '오사카', airport: 'KIX', date: '2026-09-24', time: '11:00' } };
let records = rememberFlight([], f, now);
assert.equal(records[0].flight.link, '');
for (let i = 0; i < 12; i++) records = rememberFlight(records, { ...f, id: String(i) }, now + i);
assert.equal(records.length, 10);
records = rememberFlight(records, { ...f, id: '5' }, now + 20);
assert.equal(records[0].flight.id, '5');
assert.equal(records.filter(r => r.flight.id === '5').length, 1);
assert.deepEqual(parseRecentFlights('invalid', now), []);
assert.deepEqual(parseRecentFlights('[null,{},{"flight":{}}]', now), []);
assert.deepEqual(parseRecentFlights(JSON.stringify(records), now + 31 * 86400000), []);
assert.deepEqual(parseRecentFlights(JSON.stringify(records), now - 1), []);
const record = rememberFlight([], f, now)[0];
assert.equal(findRecentFlight(record, [{ ...f, price: 80000 }])?.price, 80000);
assert.equal(findRecentFlight(record, [{ ...f, source: 'ybtour' }]), undefined);
assert.equal(findRecentFlight(record, [{ ...f, departure: { ...f.departure, airport: 'PUS' } }]), undefined);
assert.equal(findRecentFlight(record, [f, { ...f, price: 90000 }]), undefined);
const mrt = { ...f, source: 'myrealtrip' as const };
assert.equal(findRecentFlight(rememberFlight([], mrt, now)[0], [{ ...mrt, id: 'changed-price-id' }])?.id, 'changed-price-id');
assert.equal(recentFlightSnapshot(f).link, '');
console.log('PASS recent flights: TTL, bounded storage, dedupe, corrupt/future input, safe snapshots, current itinerary matching');
