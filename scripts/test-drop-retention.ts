import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import { activeTodayPickId } from '../src/lib/active-today-pick';
import { buildDropCardReason } from '../src/lib/drop-card-reason';

const flight = { id: 'test', source: 'ttang', price: 150100, departure: { date: '2026-10-17' } } as Flight;
const pick = { date: '2026-09-17', flightId: 'test', effectivePrice: 170100 };
assert.equal(activeTodayPickId(pick, [flight], '2026-09-18'), 'test');
assert.equal(activeTodayPickId(pick, [], '2026-09-18'), null);
assert.equal(activeTodayPickId(pick, [{ ...flight, price: 160100 }], '2026-09-18'), null);
assert.equal(activeTodayPickId(pick, [flight], '2026-10-18'), null);
assert.equal(activeTodayPickId(pick, [flight], '2026-09-16'), null);
assert.equal(buildDropCardReason({ origin: '청주', destination: '상하이', price: 170100, displayPrice: 150100,
 departureDate: '2026-10-17', today: '2026-09-18' }), '청주에서 상하이, 왕복 150,100원이에요');
assert.match(buildDropCardReason({ origin: '청주', destination: '상하이', price: 170100, displayPrice: 150100,
 departureDate: '2026-10-17', today: '2026-09-18',
 repeat: {previousDate:'2026-09-16',previousEffectivePrice:190100,currentEffectivePrice:170100,dropAmount:20000} }), /2만원 내렸어요/);
console.log('PASS DROP retention, price validity, and display-price copy');
