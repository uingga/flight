import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { MODE_REMOTE_PROTOCOL } from '../src/lib/modetour-operational';
import { assertModeReplyIdentity, modeWorkerFailure, validateModeWorkerRequest } from '../src/lib/modetour-remote-contract';
import { ttangWorkerForSlot } from './ttang-worker-routing.mjs';
import { DAILY_CRAWL_CRONS } from '../src/lib/crawl-schedule-health.mjs';

const id = '32758d31-8f9f-47f5-a5a3-9464d3248d36';
const hosts = { B: 'DESKTOP-OFFICE', C: 'DESKTOP-1PPFUR3' };
function fixture(time = '19:31') {
    const start = Date.parse(`2026-09-25T${time}:00+09:00`);
    const expectedAt = new Date(start).toISOString();
    return { protocol: MODE_REMOTE_PROTOCOL, id, expectedAt, worker: ttangWorkerForSlot(expectedAt),
        createdAt: new Date(start + 60_000).toISOString(),
        cache: { flights: [], fullCrawlUpdatedAt: new Date(start - 60_000).toISOString(), sourceCircuits: {} } };
}
const options = (r: ReturnType<typeof fixture>) => ({ now: Date.parse(r.createdAt), hostname: hosts[r.worker as 'B' | 'C'] });

test('all five daytime dispatch slots are accepted only by their assigned worker, including C 19:31', () => {
    const times = DAILY_CRAWL_CRONS.map(cron => {
        const [minute, hour] = cron.split(' ').map(Number);
        return `${String((hour + 9) % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    });
    assert.deepEqual([...times].sort(), ['06:17', '10:12', '13:23', '16:31', '19:31']);
    for (const time of times) {
        const r = fixture(time);
        assert.equal(validateModeWorkerRequest(r, options(r)), r.worker);
        assert.throws(() => validateModeWorkerRequest(r, { ...options(r), hostname: r.worker === 'B' ? hosts.C : hosts.B }), /wrong_worker/);
    }
});

test('invalid identity, wrong worker, stale/future requests, non-slots and exhausted source are refused', () => {
    const edits = [
        (r: any) => { r.id = 'not-a-request'; },
        (r: any) => { r.protocol = 'different'; },
        (r: any) => { r.worker = 'A'; },
        (r: any) => { delete r.worker; },
        (r: any) => { r.createdAt = '2026-09-25T09:00:00Z'; },
        (r: any) => { r.createdAt = '2026-09-25T12:00:00Z'; },
        (r: any) => { r.expectedAt = '2026-09-25T10:32:00.000Z'; },
        (r: any) => { r.cache.fullCrawlUpdatedAt = '2026-09-24T00:00:00Z'; },
        (r: any) => { r.cache.modetourPrimary = { lastAttemptAt: r.expectedAt }; },
        (r: any) => { r.cache.sourceCircuits.modetour = { nextProbeAt: '2026-09-26T00:00:00Z' }; },
    ];
    for (const edit of edits) { const r = fixture(), o = options(r); edit(r); assert.throws(() => validateModeWorkerRequest(r, o)); }
});

test('preflight failures retain request identity and the actual safe reason, never a false verified result', () => {
    const r = fixture();
    for (const reason of ['source_slot_mismatch', 'wrong_worker', 'source_not_eligible', 'stale_source_state']) {
        const reply = modeWorkerFailure(r, Error(reason), 'preflight');
        assertModeReplyIdentity(reply, r.id);
        assert.equal(reply.status, 'failed'); assert.equal(reply.reason, reason); assert.equal(reply.restricted, false);
        assert.equal(reply.phase, 'preflight'); assert.equal('bundle' in reply, false);
    }
    assert.equal(modeWorkerFailure(r, Object.assign(Error('file contains private path'), { code: 'EEXIST' }), 'preflight').reason,
        'worker_busy_or_slot_claimed');
    assert.equal(modeWorkerFailure(r, Error('private path or response body'), 'collection').reason, 'worker_failed');
    assert.equal(modeWorkerFailure(r, Error('access_restriction'), 'collection').restricted, true);
    assert.equal(modeWorkerFailure({ ...r, protocol: 'other' }, Error('invalid_worker_request'), 'preflight').id, undefined);
    assert.throws(() => assertModeReplyIdentity({ ...modeWorkerFailure(r, Error('wrong_worker'), 'preflight'), id: 'other' }, r.id), /remote_identity_mismatch/);
    assert.throws(() => assertModeReplyIdentity(null, r.id), /remote_identity_mismatch/);
});

test('real worker entry reports one correlated preflight failure without opening a browser',
    { skip: Object.values(hosts).includes(os.hostname().toUpperCase()) }, () => {
        const r = { ...fixture(), createdAt: new Date().toISOString() };
        const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)),
            fileURLToPath(new URL('./modetour-remote-worker.ts', import.meta.url)), '--scheduled'],
        { input: JSON.stringify(r), encoding: 'utf8', windowsHide: true, timeout: 20000 });
        assert.equal(result.error, undefined); assert.equal(result.status, 1, result.stderr);
        const reply = JSON.parse(result.stdout);
        assertModeReplyIdentity(reply, r.id); assert.equal(reply.reason, 'wrong_worker');
        assert.equal(reply.phase, 'preflight'); assert.equal(reply.status, 'failed');
    });
