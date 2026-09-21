import assert from 'node:assert/strict';
import { selectHolidayFlights } from '../src/lib/holiday-insight';
import type { Flight } from '../src/types/flight';

const sample = { id: 'ttang-ZE0831CJJYNJ-G5-2026-10-03', departure: { date: '2026-10-03' }, arrival: { date: '2026-10-06' }, price: 290000, availableSeats: 2 } as Flight;
assert.equal(selectHolidayFlights([sample], '2026-09-21').flights.length, 1);
assert.equal(selectHolidayFlights([sample], '2026-09-21').labels[sample.id], '개천절 연휴');
assert.equal(selectHolidayFlights([sample], '2026-10-04').flights.length, 0);
assert.equal(selectHolidayFlights([{ ...sample, availableSeats: 0 }], '2026-09-21').flights.length, 0);
assert.equal(selectHolidayFlights([{ ...sample, arrival: { ...sample.arrival, date: '2026-10-04' } }], '2026-09-21').flights.length, 0);
assert.equal(selectHolidayFlights([{ ...sample, departure: { ...sample.departure, date: '2026-10-04' } }], '2026-09-21').flights.length, 0);
assert.equal(selectHolidayFlights([], '2026-09-21').flights.length, 0);
console.log('Holiday insight: 7 assertions passed');
