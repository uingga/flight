import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { NextRequest } from 'next/server';
import type { Flight, FlightLegConnection } from '../src/types/flight';
import { hasConfirmedConnection, isConfirmedConnection } from '../src/lib/flight-connections';
import { deduplicateDisplayFlights, filterListingEligibleFlights } from '../src/lib/flight-visibility';
import { groupByCity, loadActiveFlights } from '../src/lib/flight-static';
import { evaluateDealAlert } from '../src/lib/deal-alerts';

const direct: FlightLegConnection = { status: 'direct', stopCount: 0 };
const connecting: FlightLegConnection = { status: 'connecting', stopCount: 1 };
const unknown: FlightLegConnection = { status: 'unknown', stopCount: null };
const fixture = (id: string, outbound = unknown, inbound = unknown): Flight => ({
    id, source: 'tripcom', airline: id, price: 150000, currency: 'KRW', link: 'https://example.test',
    priceCheckedAt: new Date().toISOString(),
    departure: { city: '서울', airport: 'ICN', date: '2099-10-10', time: '07:15' },
    arrival: { city: '장가계', airport: 'DYG', date: '2099-10-13', time: '10:15' },
    tripcomDetail: { paymentCondition: { kind: 'unverified' }, paymentNotice: null,
        paymentNoticePlacement: 'detail_only', legs: { outbound, inbound } },
});

test('either explicit connecting leg excludes the round trip, including conflicting positive stop counts', () => {
    for (const leg of [connecting, { ...connecting, stopCount: null },
        { ...direct, stopCount: 1 }, { ...unknown, stopCount: 2 }]) {
        assert.equal(isConfirmedConnection(leg), true);
        assert.equal(hasConfirmedConnection(fixture('outbound', leg, direct)), true);
        assert.equal(hasConfirmedConnection(fixture('inbound', direct, leg)), true);
    }
});

test('unknown, legacy and unproven hints are not classified as connections', () => {
    for (const leg of [undefined, null, direct, unknown, { ...unknown, stopCount: -1 },
        { ...unknown, stopCount: 1.5 }, { ...unknown, stopCount: '1' },
        { ...unknown, stopCount: Infinity }, { ...unknown, durationMinutes: 1690 }]) {
        assert.equal(isConfirmedConnection(leg as FlightLegConnection), false);
    }
    const rows = [fixture('direct', direct, direct), fixture('unknown'), fixture('mixed', direct, unknown),
        { ...fixture('legacy'), tripcomDetail: undefined },
        { ...fixture('partial'), tripcomDetail: { ...fixture('partial').tripcomDetail!, legs: undefined } },
        { ...fixture('airline-hint'), airline: '항공사A + 항공사B' },
        { ...fixture('old-modetour'), source: 'modetour' as const, tripcomDetail: undefined,
            modetourDetail: { isDirect: false, isReturnDirect: false } },
        { ...fixture('wrong-source', connecting), source: 'ttang' as const }];
    assert.ok(rows.every(row => !hasConfirmedConnection(row)));
    assert.equal(filterListingEligibleFlights(rows).length, rows.length);
});

test('exclude before cheapest deduplication without deleting or mutating collected evidence', () => {
    const connected = fixture('cheapest-connected', connecting);
    const available = { ...fixture('unknown-available'), airline: connected.airline, price: 170000 };
    const soldOut = { ...fixture('sold-out'), seats: '0석', availableSeats: 9 };
    const rows = [connected, available, soldOut];
    const before = JSON.stringify(rows);
    assert.deepEqual(deduplicateDisplayFlights(rows).map(row => row.id), [available.id]);
    assert.equal(JSON.stringify(rows), before);
    assert.equal(connected.tripcomDetail?.legs?.outbound.status, 'connecting');
});

test('raw city groups and deal-alert candidates cannot reintroduce confirmed connections', () => {
    const blocked = [fixture('outbound', connecting), fixture('inbound', direct, connecting)];
    const kept = fixture('unknown');
    assert.deepEqual(groupByCity([...blocked, kept]).flatMap(city => city.flights.map(row => row.id)), [kept.id]);
    const review = evaluateDealAlert({ id: 'test', departureCity: '서울', region: 'all', maxPrice: 999999 },
        [...blocked, kept], {}, { tripcom: new Date().toISOString() });
    assert.equal(review.matchingFlights, 1);
});

test('public API, SSR and current account snapshots apply the same policy; no network or data writes', async () => {
    const rows = [fixture('outbound', connecting), fixture('inbound', direct, connecting),
        fixture('both', connecting, connecting), fixture('stop-count', { ...direct, stopCount: 1 }),
        fixture('direct', direct, direct), fixture('unknown'),
        { ...fixture('legacy'), tripcomDetail: undefined }, { ...fixture('sold-out'), seats: '0석' }];
    const original = JSON.stringify(rows);
    const cache = JSON.stringify({ flights: rows, sourceUpdatedAt: { tripcom: new Date().toISOString() } });
    const originalRead = fs.readFileSync;
    const originalFetch = globalThis.fetch;
    const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    fs.readFileSync = ((file: any, ...args: any[]) => String(file).endsWith('all-flights-cache.json')
        ? cache : (originalRead as any)(file, ...args)) as typeof fs.readFileSync;
    globalThis.fetch = async () => { throw new Error('Network forbidden in connection regression'); };
    try {
        const Module = require('node:module');
        const originalLoad = Module._load;
        let GET: typeof import('../src/app/api/flights/route').GET;
        let getSnapshot: typeof import('../src/lib/server/account-flights').getAccountFlightSnapshot;
        try {
            Module._load = function (id: string, ...args: any[]) {
                return id === 'server-only' ? {} : originalLoad.call(this, id, ...args);
            };
            GET = require('../src/app/api/flights/route').GET;
            getSnapshot = require('../src/lib/server/account-flights').getAccountFlightSnapshot;
        } finally { Module._load = originalLoad; }
        const response = await GET(new NextRequest('http://localhost/api/flights'));
        assert.equal(response.status, 200);
        const body = await response.json();
        const expected = ['direct', 'legacy', 'unknown'];
        assert.deepEqual(body.flights.map((row: Flight) => row.id).sort(), expected);
        assert.equal(body.filterSummary.reasons.confirmedConnection, 4);
        assert.equal(body.filterSummary.reasons.soldOut, 1);
        assert.equal(body.filterSummary.reasons.duplicate, 0);
        assert.equal(body.filterSummary.excluded, 5);
        assert.deepEqual(loadActiveFlights().map(row => row.id).sort(), expected);
        for (const row of rows) assert.equal(Boolean(getSnapshot(row.id)), expected.includes(row.id), row.id);
        assert.equal(JSON.stringify(rows), original);
    } finally {
        fs.readFileSync = originalRead;
        globalThis.fetch = originalFetch;
        if (env.url !== undefined) process.env.SUPABASE_URL = env.url;
        if (env.key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = env.key;
    }
});
