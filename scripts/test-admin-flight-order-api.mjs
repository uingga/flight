import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:31848';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local preview only');
const key = 'flight-order-local-preview';
const read = async () => {
    const response = await fetch(base + '/api/admin-flight-order', { headers: { 'x-admin-key': key } });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.mode, 'preview', 'Refuse writes outside isolated preview store');
    return data;
};
const put = (revision, placements, extraHeaders = {}) => fetch(base + '/api/admin-flight-order', {
    method: 'PUT', headers: { 'x-admin-key': key, 'Content-Type': 'application/json', Origin: base, ...extraHeaders },
    body: JSON.stringify({ revision, placements }),
});
const initial = await read();
assert.ok(initial.flights.length > 40);
let revision = initial.order.revision;
try {
    assert.equal((await fetch(base + '/api/admin-flight-order')).status, 401);
    assert.equal((await put(revision, [], { 'x-admin-key': 'wrong' })).status, 401);
    assert.equal((await put(revision, [], { Origin: 'https://example.com' })).status, 403);
    assert.equal((await put(revision, [{ key: 'fake', position: 1 }])).status, 400);
    assert.equal((await put(revision, [{ key: 'v1:' + 'a'.repeat(64) + ':' + 'b'.repeat(64), position: 1 }])).status, 422);
    const candidate = initial.flights.filter(f => f.id !== initial.todayPickId)[20];
    const placements = [{ key: candidate.manualOrderKey, position: 1 }];
    assert.equal((await put(revision, [{ ...placements[0], price: 1 }])).status, 400);
    const response = await put(revision, placements);
    assert.equal(response.status, 200);
    revision = (await response.json()).order.revision;
    assert.deepEqual((await read()).order.placements, placements, 'new request retains placement');
    const publicData = await (await fetch(base + '/api/flights?sortBy=price')).json();
    assert.deepEqual(publicData.manualFlightOrder.placements, placements);
    assert.deepEqual(Object.keys(publicData.manualFlightOrder.placements[0]).sort(), ['key', 'position']);
    const publicCandidate = publicData.flights.find(f => f.manualOrderKey === candidate.manualOrderKey);
    assert.equal(publicCandidate.price, candidate.price);
    assert.equal(publicCandidate.availableSeats, candidate.availableSeats);
    assert.equal((await put(revision - 1, [])).status, 409);
    const concurrent = await Promise.all([put(revision, placements), put(revision, [])]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    const successful = concurrent.find(response => response.status === 200);
    revision = (await successful.json()).order.revision;
    const restored = await put(revision, []);
    assert.equal(restored.status, 200);
    revision = (await restored.json()).order.revision;
    assert.deepEqual((await read()).order.placements, []);
    console.log('PASS isolated admin API: auth, origin, validation, unknown flight, persistence, latest values, conflict, atomic concurrent save, restore');
} finally {
    const latest = await read();
    const response = await put(latest.order.revision, initial.order.placements);
    assert.equal(response.status, 200, 'restore original preview state after test');
}
