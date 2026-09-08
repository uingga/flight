import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { NextRequest } from 'next/server';
import { parseSeatCount, resolveFlightSeats, filterSeatAvailableFlights } from '../src/lib/flight-seats';
import { deduplicateDisplayFlights } from '../src/lib/flight-visibility';
import { loadActiveFlights } from '../src/lib/flight-static';
import { evaluateDealAlert } from '../src/lib/deal-alerts';
import { applyEnrichData, enrichKeyOf } from '../src/lib/utils/realtime-enrich';
import type { Flight } from '../src/types/flight';

const example: Flight = {
    id: 'ybtour-xyjhlc', source: 'ybtour', airline: '진에어',
    departure: { city: '부산', airport: 'PUS', date: '2026-09-20', time: '09:00' },
    arrival: { city: '후쿠오카', airport: 'FUK', date: '2026-09-22', time: '10:55' },
    price: 155900, currency: 'KRW', link: 'https://example.test', seats: '0석', minPax: 2,
};

test('explicit zero survives; missing, null and invalid values never become zero', () => {
    for (const value of [0, '0', ' 0석 ', '00']) assert.equal(parseSeatCount(value), 0);
    for (const value of [null, undefined, '', ' ', false, true, NaN, Infinity, -1, 0.5, '문의', '최소 2명', '0석부터', '0~4석']) {
        assert.equal(parseSeatCount(value), undefined, String(value));
    }
    assert.equal(parseSeatCount('6석'), 6);
    assert.equal(filterSeatAvailableFlights([example]).length, 0);
    assert.equal(filterSeatAvailableFlights([{ ...example, seats: undefined }]).length, 1);
});

for (const source of ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip'] as const) {
    test(`${source}: both zero encodings, unknown inventory, conflicts and minPax`, () => {
        const cases = [
            { seats: '0석' }, { availableSeats: 0 }, { availableSeats: '0' },
            { availableSeats: 8, seats: '0석' }, { availableSeats: 0, seats: '8석' },
        ];
        for (const fields of cases) {
            assert.equal(filterSeatAvailableFlights([{ ...example, seats: undefined, source, ...fields }]).length, 0);
        }
        for (const fields of [{}, { availableSeats: null, seats: null }, { availableSeats: undefined, seats: '문의' }]) {
            const [visible] = filterSeatAvailableFlights([{ ...example, seats: undefined, source, ...fields }]);
            assert.ok(visible);
            assert.equal(visible.availableSeats, undefined);
            assert.equal(visible.seats, undefined);
        }
        const [positive] = filterSeatAvailableFlights([{ ...example, source, availableSeats: 6, seats: '2석' }]);
        assert.equal(positive.availableSeats, 2);
        assert.equal(positive.seats, '2석');
        assert.equal(resolveFlightSeats({ availableSeats: 6, seats: '2석' }).conflict, true);
        assert.equal(filterSeatAvailableFlights([{ ...example, source, availableSeats: 1, seats: '1석', minPax: 2 }]).length, 1);
    });
}

test('remove sold-out cheapest before deduplication; do not mutate source evidence', () => {
    const original = JSON.stringify(example);
    const available = { ...example, id: 'available', price: 180000, availableSeats: 3, seats: '3석' };
    assert.deepEqual(deduplicateDisplayFlights([example, available]).map(f => f.id), ['available']);
    assert.equal(JSON.stringify(example), original);
});

test('browser-side ybtour and hanatour expressions preserve raw zero and unknown', () => {
    // Execute the actual inline expressions: page.evaluate cannot capture imported helpers.
    const yb = fs.readFileSync('src/lib/scrapers/ybtour.ts', 'utf8');
    const ybExpression = yb.match(/availableSeats: (.+),\r?\n/)![1];
    const readYb = new Function('seats', `return ${ybExpression};`);
    assert.equal(readYb('0'), 0);
    assert.equal(readYb(''), undefined);
    assert.equal(readYb('문의'), undefined);
    assert.equal(readYb('6'), 6);
    const hana = fs.readFileSync('src/lib/scrapers/hanatour.ts', 'utf8');
    const hanaExpression = hana.match(/const availCnt = ([\s\S]+?);/)![1];
    const readHana = new Function('rawSeats', `return ${hanaExpression};`);
    for (const value of [null, undefined, '', false]) assert.equal(readHana(value), undefined);
    for (const value of [0, '0']) assert.equal(readHana(value), 0);
});

test('public API and SSR exclude legacy zero and conflicts, retain unknown; fixture only, no network', async () => {
    const sources = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip'] as const;
    const flights = sources.flatMap((source, index) => [
        { ...example, id: `${source}-zero`, source, airline: `${index}-zero` },
        { ...example, id: `${source}-conflict`, source, airline: `${index}-conflict`, availableSeats: 9 },
        { ...example, id: `${source}-unknown`, source, airline: `${index}-unknown`, seats: undefined },
    ]).map(f => ({ ...f, departure: { ...f.departure, date: '2099-09-20' }, arrival: { ...f.arrival, date: '2099-09-22' } }));
    const cache = JSON.stringify({ flights, sourceUpdatedAt: Object.fromEntries(sources.map(s => [s, new Date().toISOString()])) });
    const originalRead = fs.readFileSync;
    const originalFetch = globalThis.fetch;
    const env = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    fs.readFileSync = ((file: any, ...args: any[]) => String(file).endsWith('all-flights-cache.json')
        ? cache : (originalRead as any)(file, ...args)) as typeof fs.readFileSync;
    globalThis.fetch = async () => { throw new Error('Network forbidden in seat regression'); };
    try {
        // The latest API imports server-only order storage. Stub only its boundary marker.
        const Module = require('node:module');
        const originalLoad = Module._load;
        let GET: typeof import('../src/app/api/flights/route').GET;
        try {
            Module._load = function (id: string, ...args: any[]) {
                return id === 'server-only' ? {} : originalLoad.call(this, id, ...args);
            };
            GET = require('../src/app/api/flights/route').GET;
        } finally { Module._load = originalLoad; }
        const response = await GET(new NextRequest('http://localhost/api/flights'));
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.flights.length, 6);
        assert.ok(body.flights.every((f: Flight) => f.id.endsWith('-unknown')));
        assert.equal(body.filterSummary.reasons.soldOut, 12);
        assert.equal(body.filterSummary.reasons.duplicate, 0);
        assert.equal(loadActiveFlights().length, 6);
    } finally {
        fs.readFileSync = originalRead;
        globalThis.fetch = originalFetch;
        if (env.url !== undefined) process.env.SUPABASE_URL = env.url;
        if (env.key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = env.key;
    }
});

test('sold-out flights cannot enter deal-alert candidates', () => {
    const now = new Date('2026-09-08T00:00:00Z');
    const result = evaluateDealAlert({ id: 'test', departureCity: '부산', region: 'all', maxPrice: 999999 },
        [example], {}, { ybtour: now.toISOString() }, now);
    assert.equal(result.matchingFlights, 0);
    const positive = evaluateDealAlert({ id: 'test', departureCity: '부산', region: 'all', maxPrice: 999999 },
        [{ ...example, seats: '2석' }], {}, { ybtour: now.toISOString() }, now);
    assert.equal(positive.matchingFlights, 1);
});

test('time enrichment never overwrites explicit zero with positive legacy inventory', () => {
    const key = { depCode: 'PUS', arrCode: 'FUK', depDate: '20260920', arrDate: '20260922', airline: '진에어' };
    const data = { depTime: '09:00', arrTime: '10:00', retDepTime: '10:55', retArrTime: '11:55', seats: 8 };
    for (const fields of [{ seats: '0석' }, { availableSeats: 0, seats: undefined }]) {
        const flight = structuredClone({ ...example, ...fields });
        applyEnrichData([flight], [key], new Map([[enrichKeyOf(key), data]]));
        assert.equal(resolveFlightSeats(flight).count, 0);
    }
    const unknown = structuredClone({ ...example, seats: undefined });
    applyEnrichData([unknown], [key], new Map([[enrichKeyOf(key), { ...data, seats: 0 }]]));
    assert.equal(resolveFlightSeats(unknown).count, undefined, 'legacy detail zero is an unknown sentinel');
});
