import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyReply } from './run-agency-evening';
import { AGENCY_EVENING_PROTOCOL } from './agency-evening-worker.mjs';

const slot = '2026-09-18T11:30:00.000Z';
const request = { protocol: AGENCY_EVENING_PROTOCOL, id: '11111111-1111-4111-8111-111111111111',
    slot, sources: ['ybtour', 'hanatour'] };
const valid = () => ({ protocol: AGENCY_EVENING_PROTOCOL, id: request.id, slot,
    sources: ['ybtour'], results: [{ source: 'ybtour', status: 'success' }],
    completedAt: '2026-09-18T12:00:00.000Z',
    cache: { flights: [], sourceUpdatedAt: { ybtour: '2026-09-18T11:45:00.000Z' } },
    logs: { entries: [] } });

test('A accepts an identified verified source result', async () => {
    await verifyReply(valid(), request, { flights: [] });
});

test('A rejects stale, reordered, or unproved results before merging', async () => {
    const stale = valid();
    stale.cache.sourceUpdatedAt.ybtour = '2026-09-18T11:00:00.000Z';
    await assert.rejects(verifyReply(stale, request, { flights: [] }), /timestamp/);

    const reordered = valid();
    reordered.sources = ['hanatour'];
    reordered.results = [{ source: 'hanatour', status: 'success' }];
    await assert.rejects(verifyReply(reordered, request, { flights: [] }), /reply/);

    const failed = valid();
    failed.results = [{ source: 'ybtour', status: 'failed_preserved' }];
    await assert.rejects(verifyReply(failed, request, { flights: [] }), /failure/);
});
