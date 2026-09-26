import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Flight, FlightLegConnection } from '../src/types/flight';
import { connectionLabel, connectionDuration, flightConnectionSummary, tripcomLegSummary } from '../src/lib/flight-connections';
import { flightTripDays } from '../src/lib/flight-trip-length';

const direct: FlightLegConnection = { status: 'direct', stopCount: 0 };
const connecting: FlightLegConnection = { status: 'connecting', stopCount: 1, durationMinutes: 1690, arrivalDate: '2026-10-01' };
const unknown: FlightLegConnection = { status: 'unknown', stopCount: null };
const flight = (outbound = direct, inbound = direct): Flight => ({
    id: 'tripcom-fixture', source: 'tripcom', airline: '테스트항공', price: 100000, currency: 'KRW', link: '',
    departure: { city: '서울', airport: 'ICN', date: '2026-09-30', time: '07:15' },
    arrival: { city: '장가계', airport: 'DYG', date: '2026-10-03', time: '10:15' },
    tripcomDetail: { paymentCondition: { kind: 'unverified' }, paymentNotice: null, paymentNoticePlacement: 'detail_only', legs: { outbound, inbound } },
});

test('only confirmed connecting legs have card labels', () => {
    assert.equal(flightConnectionSummary(flight()), null);
    assert.equal(flightConnectionSummary(flight(connecting, direct)), '가는편 경유 1회');
    assert.equal(flightConnectionSummary(flight(direct, connecting)), '오는편 경유 1회');
    assert.equal(flightConnectionSummary(flight(connecting, unknown)), '가는편 경유 1회');
    assert.equal(flightConnectionSummary(flight(unknown, connecting)), '오는편 경유 1회');
    assert.equal(flightConnectionSummary(flight(connecting, connecting)), '가는편·오는편 경유 1회');
    assert.equal(flightConnectionSummary(flight(unknown, unknown)), null);
    assert.equal(flightConnectionSummary(flight(direct, unknown)), null);
    assert.equal(flightConnectionSummary({ ...flight(), tripcomDetail: undefined }), null);
    assert.equal(flightConnectionSummary({ ...flight(), source: 'ttang' }), null);
});
test('confirmed connections keep the label; direct and unknown stay silent', () => {
    assert.equal(connectionLabel({ status: 'direct', stopCount: 1 }), '경유 1회');
    assert.equal(connectionLabel({ status: 'connecting', stopCount: null }), '경유');
    assert.equal(connectionLabel(direct), null);
    assert.equal(connectionLabel(), null);
});
test('total duration supports overnight itineraries without a 24h wrap', () => {
    assert.equal(tripcomLegSummary(flight(connecting), 'outbound'), '경유 1회 · 총 28시간 10분');
    assert.equal(tripcomLegSummary(flight(unknown), 'outbound'), null);
    assert.equal(tripcomLegSummary(flight(direct), 'outbound'), null);
    assert.equal(tripcomLegSummary(flight({ ...direct, durationMinutes: 120 }), 'outbound'), '총 2시간');
    assert.equal(connectionDuration({ ...connecting, durationMinutes: 120 }), '2시간');
    assert.equal(connectionDuration({ ...connecting, durationMinutes: 0 }), null);
    assert.equal(connectionDuration({ ...connecting, durationMinutes: -1 }), null);
});
test('trip duration uses the observed home arrival date across a multi-day connection', () => {
    const row = flight(direct, { ...connecting, arrivalDate: '2026-10-05' });
    assert.equal(flightTripDays(row), 6);
    assert.equal(flightTripDays(flight(direct, unknown)), null);
    assert.equal(flightTripDays(flight(direct, { ...connecting, arrivalDate: '2026-09-29' })), null);
});
