import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
const require = createRequire(import.meta.url);
require('tsx/cjs');
// Next supplies the server-only marker at bundle time; this Node contract test stays server-side.
const originalLoad = Module._load;
Module._load = function (name, ...args) {
    if (name === 'server-only') return {};
    return originalLoad.call(this, name, ...args);
};
const { readFlightOrder, saveFlightOrder, FlightOrderConflict, flightOrderStorageMode } = require('../src/lib/server/flight-order-store.ts');
const originalFetch = globalThis.fetch;
const names = ['FLIGHT_ORDER_ENABLED', 'FLIGHT_ORDER_PREVIEW_DIR', 'VERCEL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
let calls = 0;
let row = { revision: 0, placements: [], updated_at: null };
try {
    names.forEach(name => delete process.env[name]);
    globalThis.fetch = async (url, init) => {
        calls++;
        assert.ok(String(url).startsWith('http://127.0.0.1:39999/rest/v1/'), 'Never contact production');
        assert.equal(init.cache, 'no-store');
        assert.equal(init.headers.get('apikey'), 'sb_secret_contract-test');
        assert.equal(init.headers.get('authorization'), null, 'Supabase secret key must not be used as JWT');
        if (String(url).includes('/rpc/')) {
            assert.equal(init.method, 'POST');
            const body = JSON.parse(init.body);
            assert.deepEqual(Object.keys(body).sort(), ['expected_revision', 'new_placements']);
            if (body.expected_revision !== row.revision) return Response.json([]);
            row = { revision: row.revision + 1, placements: body.new_placements, updated_at: '2026-09-07T03:00:00Z' };
        }
        return Response.json([row]);
    };
    assert.equal(flightOrderStorageMode(), 'disabled');
    assert.deepEqual((await readFlightOrder()).placements, []);
    assert.equal(calls, 0);
    process.env.FLIGHT_ORDER_ENABLED = '1';
    process.env.SUPABASE_URL = 'http://127.0.0.1:39999';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_contract-test';
    assert.equal(flightOrderStorageMode(), 'supabase');
    const placement = { key: 'v1:' + 'a'.repeat(64) + ':' + 'b'.repeat(64), position: 1 };
    const saved = await saveFlightOrder([placement], 0);
    assert.equal(saved.revision, 1);
    assert.deepEqual(await readFlightOrder(), saved);
    await assert.rejects(saveFlightOrder([], 0), FlightOrderConflict);
    assert.equal((await saveFlightOrder([], 1)).revision, 2);
    assert.deepEqual((await readFlightOrder()).placements, []);
    globalThis.fetch = async () => Response.json({ error: 'unavailable' }, { status: 503 });
    await assert.rejects(readFlightOrder(), /503/);
    process.env.FLIGHT_ORDER_PREVIEW_DIR = '/preview-only';
    process.env.VERCEL = '1';
    assert.throws(flightOrderStorageMode, /forbidden/);
    console.log('PASS production storage contract: disabled default, Supabase headers/no-store, RPC CAS, restore, failures, Vercel preview guard (mock transport; no DB migration executed)');
} finally {
    globalThis.fetch = originalFetch;
    Module._load = originalLoad;
    names.forEach(name => previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name]);
}
