import assert from 'node:assert/strict';
import { applyManualFlightOrder, automaticRecommendationList, moveFlightPlacement, parsePlacements } from '../src/lib/manual-flight-order';
import { flightOrderKey } from '../src/lib/server/flight-order-identity';
import { deduplicateDisplayFlights } from '../src/lib/flight-visibility';
import { filterStaleSourceFlights } from '../src/lib/source-freshness';
import type { Flight } from '../src/types/flight';

function flight(index: number, source: Flight['source'] = 'hanatour'): Flight {
    const item: Flight = {
        id: `${source}-product-${index}`, source, airline: `항공사${index}`,
        departure: { city: '인천', airport: 'ICN', date: '2099-09-10', time: '09:00' },
        arrival: { city: `도시${index}`, airport: 'NRT', date: '2099-09-15', time: '15:00' },
        price: 100000 + index * 10000, currency: 'KRW', link: 'https://example.com',
        availableSeats: 9,
    };
    return { ...item, manualOrderKey: flightOrderKey(item) };
}
const list = Array.from({ length: 80 }, (_, index) => flight(index));
const key = (index: number) => list[index].manualOrderKey!;
let placements = moveFlightPlacement(list, [], key(65), 0);
assert.equal(placements.length, 1, 'only explicitly moved flight stored');
let result = applyManualFlightOrder(list, placements);
assert.equal(result[0], list[65]);
assert.deepEqual(result.slice(1), list.filter((_, index) => index !== 65), 'automatic relative order preserved');
placements = moveFlightPlacement(list, placements, key(60), 2);
result = applyManualFlightOrder(list, placements);
assert.equal(result[2], list[60]);
assert.equal(placements.length, 2);
assert.deepEqual(result.filter(item => !placements.some(p => p.key === item.manualOrderKey)), list.filter(item => !placements.some(p => p.key === item.manualOrderKey)));
const pages = Array.from({ length: 6 }, (_, index) => result.slice(index * 15, (index + 1) * 15)).flat();
assert.deepEqual(pages, result);
assert.equal(new Set(pages.map(item => item.id)).size, list.length);
assert.deepEqual(applyManualFlightOrder(list, []), list, 'restore automatic');
assert.equal(applyManualFlightOrder(list, placements, { sort: 'price' }), list);
assert.equal(applyManualFlightOrder(list, placements, { sort: 'date' }), list);
assert.equal(applyManualFlightOrder(list, placements, { sort: 'airline' }), list);
assert.equal(applyManualFlightOrder(list, placements, { pinnedId: list[0].id })[0], list[0], 'DROP stays first');
const filtered = list.filter(item => item !== list[65]);
assert.ok(!applyManualFlightOrder(filtered, placements).includes(list[65]), 'excluded never resurrected');
assert.equal(placements.length, 2, 'missing flight does not delete saved placement');
assert.equal(applyManualFlightOrder(list, placements)[0], list[65], 'preserved cache / later recovery reuses position');
const refreshed = list.map(item => item === list[65] ? { ...item, id: 'price-dependent-id-changed', price: 88888, availableSeats: 2 } : item);
assert.equal(flightOrderKey(refreshed[65]), key(65));
result = applyManualFlightOrder(refreshed, placements);
assert.equal(result[0].price, 88888);
assert.equal(result[0].availableSeats, 2);
assert.equal(result[0], refreshed[65], 'never copy stored snapshot');
for (const source of ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip'] as const) {
    const original = flight(1, source);
    const next = { ...original, price: original.price - 10000, availableSeats: 1 };
    if (['ybtour', 'hanatour'].includes(source)) next.id = 'new-price-hash';
    if (source === 'myrealtrip') next.id = original.id.replace(/-\d+$/, '-999');
    assert.equal(flightOrderKey(original), flightOrderKey(next), source);
    assert.notEqual(flightOrderKey(original), flightOrderKey({ ...next, departure: { ...next.departure, date: '2099-10-01' } }), 'reused product with new date');
}
const duplicates = [list[65], { ...list[65], id: 'ambiguous' }, list[1]];
assert.deepEqual(applyManualFlightOrder(duplicates, placements), duplicates, 'ambiguous identity not moved');
const cheaperOtherSource = { ...list[65], id: 'online-other', source: 'onlinetour' as const, price: 1, manualOrderKey: flightOrderKey({ ...list[65], id: 'online-other', source: 'onlinetour' }) };
const deduped = deduplicateDisplayFlights([list[65], cheaperOtherSource, list[1]]);
assert.ok(!applyManualFlightOrder(deduped, placements).includes(list[65]), 'dedup loser not restored');
const stale = filterStaleSourceFlights(list, { hanatour: '2000-01-01T00:00:00Z' });
assert.equal(applyManualFlightOrder(stale, placements).length, 0, 'stale source remains excluded');
assert.throws(() => parsePlacements([{ key: key(1), position: 1, price: 10 }]));
assert.throws(() => parsePlacements([{ key: key(1), position: 1 }, { key: key(2), position: 1 }]));
assert.throws(() => parsePlacements([{ key: key(1), position: -1 }]));
assert.throws(() => parsePlacements(Array.from({ length: 31 }, (_, i) => ({ key: key(i), position: i + 1 }))));
// Actual recommendation/diversity stays unchanged when restored.
const automatic = automaticRecommendationList(list, {}, {}, list[0].id, Date.parse('2099-09-01'));
assert.deepEqual(applyManualFlightOrder(automatic, []), automatic);
console.log('PASS manual order: sparse moves, restore, lifecycle identities, current prices/seats, eligibility, filters, DROP, other sorts, pagination, validation');
