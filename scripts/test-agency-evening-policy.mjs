import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEveningHost, assertEveningSlot, eveningAdmission, eveningPlan, eveningSlotFor } from './agency-evening-policy.mjs';

const slot = '2026-09-25T11:30:00.000Z';
const now = Date.parse(slot) + 5 * 60_000;
const cache = () => ({
    flights: [],
    fullCrawlUpdatedAt: '2026-09-25T10:32:00.000Z',
    sourceCircuits: {},
});

test('20:30 KST is an explicit, bounded, independent PC slot', () => {
    assert.equal(eveningSlotFor(now), slot);
    assert.equal(assertEveningSlot(slot, now), Date.parse(slot));
    assert.throws(() => assertEveningSlot('2026-09-25T10:31:00.000Z', now), /not_2030/);
    assert.throws(() => assertEveningSlot(slot, Date.parse(slot) - 1), /outside_evening_window/);
    assert.throws(() => assertEveningSlot(slot, Date.parse(slot) + 15 * 60_000), /outside_evening_window/);
});

test('the 19:31 result must be present without pretending there was a 20:30 GitHub crawl', () => {
    const before = cache();
    before.fullCrawlUpdatedAt = '2026-09-25T10:30:59.000Z';
    assert.equal(eveningAdmission({ slot, source: 'ttang', now, cache: before }).reason, 'daytime_upstream_pending');
    assert.equal(eveningAdmission({ slot, source: 'ttang', now, cache: cache() }).allowed, true);
});

test('B and C each own exactly two evening agencies', () => {
    assert.deepEqual(eveningPlan(slot, now, cache()), [
        { host: 'DESKTOP-OFFICE', sources: ['ybtour', 'hanatour'] },
        { host: 'DESKTOP-1PPFUR3', sources: ['modetour', 'ttang'] },
    ]);
    assert.equal(assertEveningHost('ttang', 'DESKTOP-1PPFUR3'), 'DESKTOP-1PPFUR3');
    assert.throws(() => assertEveningHost('ttang', 'DESKTOP-OFFICE'), /host_mismatch/);
});

test('cooldown, already-attempted, and invalid timestamps fail closed by source', () => {
    const restricted = cache();
    restricted.sourceCircuits.ttang = { nextProbeAt: '2026-09-26T00:00:00.000Z' };
    assert.equal(eveningAdmission({ slot, source: 'ttang', now, cache: restricted }).reason, 'source_cooldown');
    restricted.sourceCircuits.ttang.nextProbeAt = 'bad';
    assert.equal(eveningAdmission({ slot, source: 'ttang', now, cache: restricted }).reason, 'source_cooldown');
    restricted.sourceCircuits.ttang.nextProbeAt = '2026-09-25T11:00:00.000Z';
    restricted.ttangPrimary = { lastAttemptAt: slot };
    assert.equal(eveningAdmission({ slot, source: 'ttang', now, cache: restricted }).reason, 'slot_already_attempted');
    assert.equal(eveningAdmission({ slot, source: 'ybtour', now, cache: restricted }).allowed, true);
});
