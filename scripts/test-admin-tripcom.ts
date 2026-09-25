import assert from 'node:assert/strict';
import { buildTripcomAdminSnapshot, tripcomRunSlotEvents } from '../src/lib/admin-tripcom';
import { buildSourceSlotBars, groupTripcomBarsByAgencyWindow } from '../src/lib/admin-source-slots';
import type { Flight } from '../src/types/flight';

const tripcomFlight = (id: string, priceCheckedAt: string): Flight => ({
    id, source: 'tripcom', airline: '제주항공',
    departure: { city: '인천', airport: 'ICN', date: '2026-10-12', time: '09:00' },
    arrival: { city: '오사카', airport: 'KIX', date: '2026-10-15', time: '18:00' },
    price: 199000, currency: 'KRW', link: 'https://example.com/booking',
    priceCheckedAt, availableSeats: 3,
});

const snapshot = buildTripcomAdminSnapshot({
    flights: [tripcomFlight('old', '2026-09-22T00:00:00Z'), {
        ...tripcomFlight('other-source', '2026-09-23T00:00:00Z'), source: 'ybtour',
    }, tripcomFlight('new', '2026-09-22T08:00:00Z')],
    sourceUpdatedAt: { tripcom: '2026-09-22T04:00:00Z' },
    tripcomPrimary: { runId: '2026-09-22T16:31:00+09:00', host: 'C', status: 'partial', verifiedCities: 2, unconfirmedCities: 1 },
});
assert.deepEqual(snapshot.offers.map(offer => offer.id), ['new', 'old']);
assert.equal(snapshot.offers[0].seats, '3석');
assert.equal(snapshot.lastPriceCheckedAt, '2026-09-22T08:00:00Z');
assert.equal(snapshot.lastRun?.status, 'partial');
assert.equal(snapshot.lastRun?.unconfirmedCities, 1);
assert.equal(snapshot.runs.length, 1);
assert.equal(tripcomRunSlotEvents(snapshot)[0].value, 2);
assert.equal('link' in snapshot.offers[0], false);

const empty = buildTripcomAdminSnapshot({ flights: [], sourceUpdatedAt: { tripcom: '2026-09-22T04:00:00Z' } });
assert.equal(empty.offers.length, 0);
assert.equal(empty.lastPriceCheckedAt, '2026-09-22T04:00:00Z');
assert.equal(empty.lastRun, null);
assert.deepEqual(empty.runs, []);

const combinedHost = buildTripcomAdminSnapshot({
    flights: [],
    tripcomPrimary: {
        runId: '2026-09-25T14:57:00+09:00', host: 'BC', status: 'partial', verifiedCities: 17, unconfirmedCities: 3,
        history: [{ runId: '2026-09-24T16:31:00+09:00', host: 'C', status: 'collected', verifiedCities: 19, unconfirmedCities: 0 }],
    },
});
assert.equal(combinedHost.lastRun?.host, 'BC');
assert.deepEqual(combinedHost.runs.map(run => run.verifiedCities), [19, 17]);
assert.deepEqual(buildSourceSlotBars({ source: 'tripcom', events: tripcomRunSlotEvents(combinedHost), now: Date.parse('2026-09-25T09:00:00Z') })
    .map(bar => bar.value), [19, 17]);

const paired = buildTripcomAdminSnapshot({
    flights: [],
    tripcomPrimary: {
        runId: '2026-09-25T14:57:00+09:00', host: 'BC', status: 'partial', verifiedCities: 17, unconfirmedCities: 3,
        history: [{ runId: '2026-09-25T13:40:00+09:00', host: 'B', status: 'collected', verifiedCities: 19, unconfirmedCities: 0 }],
    },
});
const groups = groupTripcomBarsByAgencyWindow({
    events: tripcomRunSlotEvents(paired), now: Date.parse('2026-09-25T18:00:00+09:00'),
});
assert.equal(groups.length, 20);
assert.deepEqual(groups.find(group => group.slotAt === '2026-09-25T04:23:00.000Z')?.runs.map(run => run.value), [19, 17]);
assert.equal(groups.at(-1)?.runs.length, 0); // no recorded run, not a fabricated zero-result crawl
assert.equal(groups.flatMap(group => group.runs).length, 2);

const boundary = buildTripcomAdminSnapshot({
    flights: [],
    tripcomPrimary: {
        runId: '2026-09-25T16:31:00+09:00', host: 'C', status: 'collected', verifiedCities: 18, unconfirmedCities: 0,
        history: paired.runs,
    },
});
const boundaryGroups = groupTripcomBarsByAgencyWindow({
    events: tripcomRunSlotEvents(boundary), now: Date.parse('2026-09-25T18:00:00+09:00'),
});
assert.equal(boundaryGroups.at(-1)?.runs.length, 1); // exact boundary belongs to the next time window
assert.equal(boundaryGroups.flatMap(group => group.runs).length, 3);

const now = Date.parse('2026-09-23T12:00:00Z');
assert.deepEqual(buildSourceSlotBars({ source: 'tripcom', events: [], now }), []);
const bars = buildSourceSlotBars({ source: 'tripcom', now, events: [{
    timestamp: '2026-09-23T07:31:00Z', value: 2, preserved: false, skipped: false,
    manual: false, localFallback: false,
}] });
assert.equal(bars.length, 1);
assert.equal(bars[0].status, 'auto');
assert.equal(bars[0].value, 2);

console.log('Trip.com admin snapshot and independent history: OK');
