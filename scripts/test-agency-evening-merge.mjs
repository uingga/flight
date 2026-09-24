import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCacheSource } from '../src/lib/merge-cache-source.mjs';

test('an evening source merge preserves other agencies and the attempted-slot marker', () => {
    const target = { flights: [
        { id: 'old-yb', source: 'ybtour' }, { id: 'ttang', source: 'ttang' }],
    sourceUpdatedAt: { ybtour: '2026-09-25T10:00:00.000Z', ttang: '2026-09-25T10:00:00.000Z' },
    eveningPrimary: { hanatour: { lastAttemptAt: '2026-09-24T11:30:00.000Z' } } };
    const overlay = { flights: [{ id: 'new-yb', source: 'ybtour' }],
        sourceUpdatedAt: { ybtour: '2026-09-25T11:40:00.000Z' },
        eveningPrimary: { ybtour: { status: 'success', lastAttemptAt: '2026-09-25T11:30:00.000Z' } } };
    const merged = mergeCacheSource(target, overlay, 'ybtour');
    assert.deepEqual(merged.flights.map(flight => flight.id), ['ttang', 'new-yb']);
    assert.equal(merged.eveningPrimary.ybtour.status, 'success');
    assert.equal(merged.eveningPrimary.hanatour.lastAttemptAt, '2026-09-24T11:30:00.000Z');
    assert.equal(merged.sourceUpdatedAt.ttang, '2026-09-25T10:00:00.000Z');
});
