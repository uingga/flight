import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Flight } from '../src/types/flight';
import { flightTripDays, formatFlightTripLength, matchesTripLength, parseTripLengthFilters } from '../src/lib/flight-trip-length';

const flight = (patch: Partial<Flight> = {}): Flight => ({
    id: 'synthetic', source: 'ttang', airline: 'test', price: 100000, currency: 'KRW', link: 'https://example.invalid',
    departure: { city: '인천', airport: 'ICN', date: '2026-10-02', time: '18:00' },
    arrival: { city: '방콕', airport: 'BKK', date: '2026-10-04', time: '23:00', arrivalTime: '06:00' }, ...patch,
});
test('overnight home arrival counts Monday, not Sunday return departure', () => {
    assert.equal(flightTripDays(flight()), 4);
    assert.equal(formatFlightTripLength(flight()), '4일');
    assert.equal(matchesTripLength(flight(), ['short']), false);
    assert.equal(matchesTripLength(flight(), ['4']), true);
});
test('same-day return and calendar year boundary', () => {
    assert.equal(flightTripDays(flight({ arrival: { ...flight().arrival, time: '10:00', arrivalTime: '17:00' } })), 3);
    assert.equal(flightTripDays(flight({ departure: { ...flight().departure, date: '2026-12-30' },
        arrival: { ...flight().arrival, date: '2026-12-31' } })), 3);
});
test('date line: US return crosses two calendar dates', () => {
    assert.equal(flightTripDays(flight({ arrival: { city: '로스앤젤레스', airport: 'LAX', date: '2026-10-04', time: '23:00', arrivalTime: '05:00' } })), 5);
});
test('missing/invalid times, dates and zones remain unclassified', () => {
    for (const arrival of [
        { ...flight().arrival, arrivalTime: undefined },
        { ...flight().arrival, arrivalTime: '24:00' },
        { ...flight().arrival, city: 'unknown' },
        { ...flight().arrival, date: '2026-02-30' },
        { ...flight().arrival, date: '2026-10-01' },
    ]) {
        const unknown = flight({ arrival });
        assert.equal(flightTripDays(unknown), null);
        assert.equal(formatFlightTripLength(unknown), null);
        assert.equal(matchesTripLength(unknown, []), true);
        assert.equal(matchesTripLength(unknown, ['4', 'long']), false);
    }
});
test('agency return details take precedence; non-Korea return is unknown', () => {
    assert.equal(flightTripDays(flight({ modetourDetail: { returnDepartureTime: '10:00', returnArrivalTime: '17:00' } })), 3);
    assert.equal(flightTripDays(flight({ modetourDetail: { returnArrivalAirport: 'NRT' } })), null);
});
test('multi select OR, all, short and long boundaries', () => {
    assert.equal(matchesTripLength(flight(), ['short', '4']), true);
    assert.equal(matchesTripLength(flight({ arrival: { ...flight().arrival, time: '10:00', arrivalTime: '17:00' } }), ['short']), true);
    assert.equal(matchesTripLength(flight(), ['short', 'long']), false);
    const long = flight({ arrival: { ...flight().arrival, date: '2026-10-07' } });
    assert.equal(flightTripDays(long), 7);
    assert.equal(matchesTripLength(long, ['long']), true);
    const sameDay = flight({ arrival: { ...flight().arrival, date: '2026-10-02', time: '20:00', arrivalTime: '23:50', city: '도쿄' } });
    assert.equal(formatFlightTripLength(sameDay), '1일');
    assert.equal(matchesTripLength(sameDay, ['short']), true);
});
test('URL parsing rejects invalid and duplicate values, keeps stable ordering', () => {
    assert.deepEqual(parseTripLengthFilters('4,short,4,bad,0'), ['short', '4']);
    assert.deepEqual(parseTripLengthFilters(null), []);
});
