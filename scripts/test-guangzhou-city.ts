import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeCity } from '../src/lib/utils/flight-helpers';
import { buildFlightDisplayKey } from '../src/lib/flight-visibility';

for (const city of ['광주(광저우)', ' 광주(광저우) ', '광주 ( 광저우 )', '광주(CAN)', '광저우(CAN)', '광저우']) {
    assert.equal(normalizeCity(city), '광저우', city);
}
for (const city of ['광주', '광주(KWJ)']) assert.equal(normalizeCity(city), '광주', city);
assert.equal(normalizeCity('서울(ICN)'), '인천');
assert.equal(normalizeCity('상하이(PVG)'), '상하이(푸동)');
const cache = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf8'));
const examples = cache.flights.filter((f: any) => f.source === 'ttang' && f.arrival.airport === 'CAN');
// Keep the regression reproducible after today's cached tickets expire.
const fixture = {id:'ttang-BX3115PUSCAN-G1-2026-09-26',source:'ttang',airline:'에어부산',
    departure:{city:'부산',airport:'PUS',date:'2026-09-26',time:'22:00'},
    arrival:{city:'광주(광저우)',airport:'CAN',date:'2026-10-01',time:'02:05'},
    price:300000,currency:'KRW',link:'https://mm.ttang.com/',availableSeats:2} as const;
for (const flight of [fixture, ...examples]) {
    const before = JSON.stringify(flight);
    assert.equal(normalizeCity(flight.arrival.city), '광저우');
    assert.equal(buildFlightDisplayKey(flight), buildFlightDisplayKey({...flight, arrival:{...flight.arrival,city:'광저우'}}));
    assert.equal(JSON.stringify(flight), before, 'normalization must not mutate price, seats, IDs or links');
}
console.log(`PASS 10 city cases and ${examples.length} cached TTang CAN tickets; no live requests`);
