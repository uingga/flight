import assert from 'node:assert/strict';
import { holidayFlightKey, selectHolidayFlights } from '../src/lib/holiday-insight';
import type { Flight } from '../src/types/flight';

const sample = { id: 'new-holiday-offer', departure: { date: '2026-10-03', time: '09:00' }, arrival: { date: '2026-10-06', time: '12:00' }, price: 290000, availableSeats: 2 } as Flight;
const secondWindow = { ...sample, departure: { ...sample.departure, date: '2026-10-09' }, arrival: { ...sample.arrival, date: '2026-10-12' } };

assert.deepEqual(selectHolidayFlights([], '2026-09-23').flights, []);
assert.deepEqual(selectHolidayFlights([sample], '2026-09-23').flights, [sample]);
const updated = selectHolidayFlights([sample, secondWindow], '2026-09-23');
assert.deepEqual(updated.flights, [sample, secondWindow]);
assert.equal(updated.labels[holidayFlightKey(sample)], '개천절 연휴');
assert.equal(updated.labels[holidayFlightKey(secondWindow)], '한글날 연휴');
assert.deepEqual(selectHolidayFlights([secondWindow], '2026-09-23').flights, [secondWindow]);
assert.equal(selectHolidayFlights([sample], '2026-10-04').flights.length, 0);
assert.equal(selectHolidayFlights([{ ...sample, availableSeats: 0 }], '2026-09-23').flights.length, 0);
assert.equal(selectHolidayFlights([{ ...sample, arrival: { ...sample.arrival, date: '2026-10-04' } }], '2026-09-23').flights.length, 0);
assert.equal(selectHolidayFlights([{ ...sample, departure: { ...sample.departure, date: '2026-10-04' } }], '2026-09-23').flights.length, 0);
const both = { ...sample, departure: { ...sample.departure, date: '2026-10-02' }, arrival: { ...sample.arrival, date: '2026-10-12' } };
assert.equal(selectHolidayFlights([both], '2026-09-23').flights.length, 1);
assert.equal(selectHolidayFlights([both], '2026-09-23').labels[holidayFlightKey(both)], '개천절·한글날 연휴');
console.log('Holiday insight: dynamic selection assertions passed');
