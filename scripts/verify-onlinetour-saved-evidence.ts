// Offline-only audit. Never opens a browser or follows a booking link.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { validatePilotResponse } from '../src/lib/onlinetour-browser-collector';
import type { Flight } from '../src/types/flight';
import { eligibleDepartures } from '../src/lib/onlinetour-departure-window';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--staging') throw new Error('staging_directory_required');
const root = path.resolve(__dirname, '..', '.local-crawler', 'staging');
const directory = path.resolve(args[1]);
assert.equal(path.dirname(directory), root);
assert.match(path.basename(directory), /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const rows: Record<string, any>[] = read('raw-products.json');
const saved: Flight[] = read('flights.json');
const summary = read('summary.json');
assert.ok(rows.length > 0);
const validated: Flight[] = [];
for(let offset=0; offset<rows.length; offset+=20) {
    const validation = validatePilotResponse('audit(' + JSON.stringify({ status: 200, data: { list: rows.slice(offset,offset+20) } }) + ');', 'audit');
    assert.equal(validation.status, 'pilot_ready_for_review'); validated.push(...validation.flights);
}
assert.equal(new Set(validated.map(f=>f.id)).size, validated.length);
assert.deepEqual(saved, validated);
let eligible: Flight[] | null = null;
if (summary.plan?.departureWindow) {
    eligible = read('eligible-flights.json');
    assert.deepEqual(eligible, eligibleDepartures(saved, summary.plan.departureWindow));
    assert.equal(summary.eligibleCount, eligible!.length);
    assert.equal(summary.outsideDepartureWindowCount, saved.length - eligible!.length);
}
const time = (v: string) => v.includes(':') ? v : v.slice(0, 2) + ':' + v.slice(2);
for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const flight: Flight = saved[i];
    assert.equal(flight.price, Number(row.adult_price));
    assert.equal(flight.availableSeats, Number(row.res_cnt));
    assert.equal(flight.departure.time, time(row.dep_start_time));
    assert.equal(flight.departure.arrivalTime, time(row.dep_end_time));
    assert.equal(flight.arrival.time, time(row.arr_start_time));
    assert.equal(flight.arrival.arrivalTime, time(row.arr_end_time));
    const link = new URL(flight.link);
    assert.equal(link.origin + link.pathname, 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairReservation');
    assert.equal(link.searchParams.get('eventCode'), row.event_code);
    assert.deepEqual(Array.from(link.searchParams.keys()), ['eventCode']);
    assert.equal(link.username + link.password + link.hash, '');
}
console.log(JSON.stringify({ offlineOnly: true, siteRequests: 0, runId: summary.runId,
    preservedRunStatus: summary.status, preservedRunFailure: summary.failure, verifiedRows: rows.length,
    priceAndFourTimesAndSeatsMatch: true, bookingLinkStructureAndIdMatch: true, bookingPagesOpened: 0,
    minPrice: Math.min(...saved.map((f: any) => f.price)), maxPrice: Math.max(...saved.map((f: any) => f.price)),
    departureWindowVerified: eligible !== null, eligibleCount: eligible?.length ?? null,
    firstDeparture: saved.map(f => f.departure.date).sort()[0], lastDeparture: saved.map(f => f.departure.date).sort().at(-1),
    departures: Array.from(new Set(saved.map(f => f.departure.airport))), arrivals: Array.from(new Set(saved.map(f => f.arrival.airport))),
    productionReady: false }));
