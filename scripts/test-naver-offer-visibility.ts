import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { NextRequest } from 'next/server';
import type { Flight } from '../src/types/flight';
import { filterNaverVerifiedOffers } from '../src/lib/naver-offer-visibility';
import { buildNaverPriceKey } from '../src/lib/naver-route';
import { loadActiveFlights } from '../src/lib/flight-static';
import { findSharedFlight } from '../src/lib/shared-flight-context';

const now = Date.parse('2026-09-27T00:00:00Z');
const hour = 3_600_000;
const fare = (id = 'tripcom-test', airport = 'KIX', extra: Partial<Flight> = {}): Flight => ({
    id, source: 'tripcom', airline: id, price: 190000, currency: 'KRW', link: 'https://example.test',
    priceCheckedAt: new Date().toISOString(),
    departure: { city: '인천', airport: 'ICN', date: '2099-10-01', time: '10:00' },
    arrival: { city: airport, airport, date: '2099-10-04', time: '13:00' },
    routeAirports: { outboundDeparture: 'ICN', outboundArrival: airport, returnDeparture: airport, returnArrival: 'ICN' },
    ...extra,
});
const key = (flight: Flight) => buildNaverPriceKey(flight, flight.departure.date, flight.arrival.date)!;
const entry = (age = 0, extra = {}) => ({ naverLowest: 200000, crawledAt: new Date(now - age).toISOString(), ...extra });

for (const source of ['tripcom', 'myrealtrip'] as const) {
    test(`${source}: missing data and stale embedded comparisons fail closed without deleting evidence`, () => {
        const flight = fare(`${source}-missing`, 'KIX', { source, naverLowest: 999999, naverCheckedAt: new Date(now).toISOString() });
        const original = JSON.stringify(flight);
        for (const prices of [null, undefined, {}, [], 'broken']) {
            assert.deepEqual(filterNaverVerifiedOffers([flight], prices, now), []);
        }
        assert.equal(JSON.stringify(flight), original);
    });
    test(`${source}: exact comparison qualifies and expires at the existing 24-hour boundary`, () => {
        const flight = fare(`${source}-fresh`, 'KIX', { source });
        for (const age of [0, 12 * hour, 24 * hour]) {
            const result = filterNaverVerifiedOffers([flight], { [key(flight)]: entry(age) }, now);
            assert.equal(result.length, 1);
            assert.equal(result[0].naverLowest, 200000);
            assert.equal(flight.naverLowest, undefined);
        }
        assert.deepEqual(filterNaverVerifiedOffers([flight], { [key(flight)]: entry(24 * hour + 1) }, now), []);
    });
    for (const status of ['no_result', 'route_error', 'miss']) {
        test(`${source}: ${status} cannot revive an older success`, () => {
            const flight = fare(`${source}-negative`, 'KIX', { source });
            assert.deepEqual(filterNaverVerifiedOffers([flight], { [key(flight)]: entry(0, { lastAttemptStatus: status }) }, now), []);
        });
    }
    test(`${source}: invalid prices and timestamps do not qualify`, () => {
        const flight = fare(`${source}-invalid`, 'KIX', { source });
        for (const naverLowest of [0, -1, null, 'bad', Infinity]) {
            assert.deepEqual(filterNaverVerifiedOffers([flight], { [key(flight)]: entry(0, { naverLowest }) }, now), []);
        }
        for (const crawledAt of ['', 'not-a-date', undefined]) {
            assert.deepEqual(filterNaverVerifiedOffers([flight], { [key(flight)]: entry(0, { crawledAt }) }, now), []);
        }
    });
}

test('all four airports and both dates must match; nearby and cached prices cannot substitute', () => {
    const flight = fare();
    const prices = { [key(flight)]: entry() };
    for (const name of ['outboundDeparture', 'outboundArrival', 'returnDeparture', 'returnArrival'] as const) {
        const changed = { ...flight, routeAirports: { ...flight.routeAirports!, [name]: 'GMP' }, naverLowest: 999999, naverCheckedAt: new Date(now).toISOString() };
        assert.deepEqual(filterNaverVerifiedOffers([changed], prices, now), [], name);
    }
    for (const leg of ['departure', 'arrival'] as const) {
        assert.deepEqual(filterNaverVerifiedOffers([{ ...flight, [leg]: { ...flight[leg], date: '2099-10-02' } }], prices, now), []);
    }
    const asymmetric = { ...flight, routeAirports: { ...flight.routeAirports!, returnArrival: 'GMP' } };
    assert.equal(filterNaverVerifiedOffers([asymmetric], { [key(asymmetric)]: entry() }, now).length, 1);
});

test('new comparison reveals the retained fare without another Trip.com crawl; price thresholds are unchanged', () => {
    const flight = fare();
    assert.equal(filterNaverVerifiedOffers([flight], {}, now).length, 0);
    for (const [price, naverLowest, count] of [[190000, 200000, 1], [200000, 200000, 1], [209999, 200000, 1], [210000, 200000, 0], [1020000, 1000000, 1]]) {
        assert.equal(filterNaverVerifiedOffers([{ ...flight, price }], { [key(flight)]: entry(0, { naverLowest }) }, now).length, count);
    }
});

test('other agencies remain eligible without a Naver comparison', () => {
    const rows = (['modetour', 'ybtour', 'hanatour', 'onlinetour', 'ttang', 'lottetour'] as const)
        .map(source => fare(source, 'KIX', { source }));
    assert.deepEqual(filterNaverVerifiedOffers(rows, null, now), rows);
});

test('API, initial-home response, static lists and detail lookup use the gate before cheapest deduplication', async () => {
    const stamp = new Date().toISOString();
    const good = fare('tripcom-good');
    const missing = fare('tripcom-missing', 'TPE', { naverLowest: 999999, naverCheckedAt: stamp });
    const expired = fare('tripcom-expired', 'DYG');
    const negative = fare('tripcom-negative', 'OKA');
    const expensive = fare('tripcom-expensive', 'FUK', { price: 220000 });
    const cheap = fare('tripcom-cheap-missing', 'SIN', { airline: 'same-flight', price: 100000 });
    const fallback = { ...cheap, id: 'modetour-fallback', source: 'modetour' as const, price: 150000 };
    const mrt = fare('mrt-good', 'YNT', { source: 'myrealtrip' });
    const rows = [good, missing, expired, negative, expensive, cheap, fallback, mrt];
    const cache = JSON.stringify({ flights: rows, sourceUpdatedAt: { myrealtrip: stamp, modetour: stamp, tripcom: stamp } });
    let comparisons: string | null = JSON.stringify({
        [key(good)]: { naverLowest: 200000, crawledAt: stamp },
        [key(expired)]: { naverLowest: 200000, crawledAt: new Date(Date.now() - 25 * hour).toISOString() },
        [key(negative)]: { naverLowest: 200000, crawledAt: stamp, lastAttemptStatus: 'no_result' },
        [key(expensive)]: { naverLowest: 200000, crawledAt: stamp },
        [key(mrt)]: { naverLowest: 200000, crawledAt: stamp },
    });
    const originalRead = fs.readFileSync, originalExists = fs.existsSync, originalFetch = globalThis.fetch;
    const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        FLIGHT_ORDER_ENABLED: process.env.FLIGHT_ORDER_ENABLED, FLIGHT_ORDER_PREVIEW_DIR: process.env.FLIGHT_ORDER_PREVIEW_DIR };
    for (const name of Object.keys(env)) delete process.env[name];
    fs.existsSync = ((file: any) => String(file).endsWith('naver-prices.json') ? comparisons !== null : originalExists(file)) as typeof fs.existsSync;
    fs.readFileSync = ((file: any, ...args: any[]) => {
        if (String(file).endsWith('all-flights-cache.json')) return cache;
        if (String(file).endsWith('naver-prices.json')) {
            if (comparisons === null) throw new Error('fixture file missing');
            return comparisons;
        }
        return (originalRead as any)(file, ...args);
    }) as typeof fs.readFileSync;
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('Network forbidden'); };
    try {
        const Module = require('node:module'), originalLoad = Module._load;
        let GET: typeof import('../src/app/api/flights/route').GET;
        let responseForHome: typeof import('../src/lib/server/public-flights-response').createPublicFlightsResponse;
        try {
            Module._load = function (id: string, ...args: any[]) { return id === 'server-only' ? {} : originalLoad.call(this, id, ...args); };
            GET = require('../src/app/api/flights/route').GET;
            responseForHome = require('../src/lib/server/public-flights-response').createPublicFlightsResponse;
        } finally { Module._load = originalLoad; }
        const body = await (await GET(new NextRequest('http://localhost/api/flights'))).json();
        const expected = [fallback.id, mrt.id, good.id].sort();
        const ids = (flights: Flight[]) => flights.map(flight => flight.id).sort();
        assert.deepEqual(ids(body.flights), expected);
        assert.deepEqual(ids((await (await responseForHome(new URLSearchParams())).json()).flights), expected);
        assert.deepEqual(ids(loadActiveFlights()), expected);
        assert.equal(findSharedFlight(body.flights, missing.id), undefined);
        assert.equal(findSharedFlight(body.flights, good.id)?.id, good.id);
        assert.equal(body.filterSummary.reasons.naverTripcomGate, 4);
        assert.equal(body.filterSummary.reasons.naverExpensive, 1);
        assert.equal(body.filterSummary.reasons.duplicate, 0);
        assert.equal(body.filterSummary.excluded, 5);
        for (const broken of [null, '{', 'null', '[]']) {
            comparisons = broken;
            assert.deepEqual(ids((await (await responseForHome(new URLSearchParams())).json()).flights), [fallback.id]);
            assert.deepEqual(ids(loadActiveFlights()), [fallback.id]);
        }
        assert.equal(JSON.stringify({ flights: rows, sourceUpdatedAt: { myrealtrip: stamp, modetour: stamp, tripcom: stamp } }), cache);
        assert.equal(requests, 0);
    } finally {
        fs.readFileSync = originalRead; fs.existsSync = originalExists; globalThis.fetch = originalFetch;
        for (const [name, value] of Object.entries(env)) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
    }
});

test('share metadata, OG and city refresh cannot reuse an unverified cached offer', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ flights: [] }), { status: 200 });
    try {
        const { generateMetadata } = await import('../src/app/share/[id]/page');
        for (const id of ['tripcom-missing', 'mrt-missing']) {
            const metadata = await generateMetadata({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ price: '99000', arr: '도쿄', dep: '서울' }) });
            assert.equal(metadata.title, '현재 확인 가능한 항공권을 찾아보세요 | 티키티킷');
            assert.equal(metadata.openGraph, undefined);
        }
    } finally { globalThis.fetch = originalFetch; }
    const og = fs.readFileSync('src/app/opengraph-image.tsx', 'utf8');
    assert.doesNotMatch(og, /all-flights-cache\.json/);
    assert.match(og, /\/api\/flights/);
    const city = fs.readFileSync('src/app/flights/[city]/page.tsx', 'utf8');
    assert.match(city, /export const revalidate = 60/);
    const detail = fs.readFileSync('src/app/preview/mobile-redesign/MobileRedesignPreview.tsx', 'utf8');
    assert.match(detail, /findSharedFlight\(flights, flightId, scheduleToken\)/);
});
