import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../src/app/share/[id]/page.tsx', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('async function getFlightById('), source.indexOf('\nfunction formatPrice('))
    .replace('id: string, schedule: string | null = null', 'id, schedule = null')
    .replace('filterSeatAvailableFlights<Flight>', 'filterSeatAvailableFlights');

test('share metadata requests the current feed for price drops and newly added flights', async () => {
    let flights = [{ id: 'existing', price: 199000 }];
    let calls = 0;
    const lookup = runInNewContext(`(${functionSource})`, {
        process: { env: {} }, SITE_URL: 'https://example.test', console,
        filterSeatAvailableFlights: rows => rows,
        findSharedFlight: (rows, id) => rows.find(row => row.id === id),
        fetch: async (url, options) => {
            assert.equal(url, 'https://example.test/api/flights');
            assert.equal(options.cache, 'no-store');
            assert.equal(options.next, undefined);
            calls++;
            return { ok: true, json: async () => ({ flights }) };
        },
    });
    assert.equal((await lookup('existing')).price, 199000);
    assert.equal(await lookup('new'), null);
    flights = [{ id: 'existing', price: 99000 }, { id: 'new', price: 99000 }];
    assert.equal((await lookup('existing')).price, 99000);
    assert.equal((await lookup('new')).price, 99000);
    assert.equal(calls, 4);
});
