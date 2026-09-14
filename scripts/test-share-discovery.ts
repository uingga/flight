import assert from 'node:assert/strict';
import { selectShareDiscovery } from '../src/lib/share-discovery';
import type { Flight } from '../src/types/flight';

const base: Flight = { id: 'first', source: 'ybtour', airline: '항공사',
    departure: { city: '부산', airport: 'PUS', date: '2026-09-22', time: '10:00' },
    arrival: { city: '오사카', airport: 'KIX', date: '2026-09-25', time: '15:00' },
    price: 199000, currency: 'KRW', link: 'https://example.com' };
const otherDate = { ...base, id: 'other-date', departure: { ...base.departure, date: '2026-09-23' } };
const otherCity = { ...base, id: 'other-city', arrival: { ...base.arrival, city: '타이중', airport: 'RMQ' } };
const inventory = [base, { ...base, id: 'duplicate' }, otherDate,
    { ...otherDate, id: 'same-date-expensive', price: 220000 }, otherCity,
    { ...otherCity, id: 'sold', availableSeats: 0, price: 10000 },
    { ...otherCity, id: 'old', departure: { ...base.departure, date: '2026-09-13' } },
    { ...otherCity, id: 'different-origin', departure: { ...base.departure, city: '청주', airport: 'CJJ' } }];
const result = selectShareDiscovery(inventory, base, (a, b) => a.price - b.price, new Date('2026-09-14T00:00:00Z'));
assert.deepEqual(result.sameDestination.map(f => f.id), ['other-date']);
assert.deepEqual(result.otherDestinations.map(f => f.id), ['other-city']);
assert.equal(inventory[0], base, 'input order is preserved');
assert.deepEqual(selectShareDiscovery([], base, () => 0), { sameDestination: [], otherDestinations: [] });
console.log('share discovery: passed');
