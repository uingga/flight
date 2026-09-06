import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import type { Page } from 'playwright';
import * as enrichment from '../src/lib/ttang-time-enrichment';
import { TtangDetailCheckpoint } from '../src/lib/ttang-detail-checkpoint';
import { SourceResponseError } from '../src/lib/scrapers/source-response';
import type { Flight } from '../src/types/flight';

const NOW = new Date(Date.now() - 60_000);
const DATA = { depTime: '09:00', arrTime: '11:00', retDepTime: '18:00', retArrTime: '20:00', seats: 0 };
function flights(): Flight[] {
    return Array.from({ length: 6 }, (_, i) => ({
        id: `test-${i}`, source: 'ttang', airline: '제주항공', price: 100000, currency: 'KRW', link: 'https://example.invalid',
        departure: { city: '서울', airport: 'ICN', date: '2099-10-01', time: '' },
        arrival: { city: '도쿄', airport: 'NRT', date: '2099-10-04', time: '' },
        ttangProduct: { masterId: '10', fareId: String(100 + i), fareType: 'VV', carrierCode: '7C' },
        availableSeats: 9, seats: '9석',
    }));
}

test('local lock retries never repeat a successful upstream request', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-local-retry-test-'));
    const dir = path.join(root, '.local-crawler', 'staging', 'run');
    fs.mkdirSync(dir, { recursive: true });
    try {
        const writer = new TtangDetailCheckpoint(root, dir, 'run-1', NOW, enrichment.TTANG_TIME_ADAPTER_VERSION);
        const original = fs.renameSync;
        const seen = new Set<string>();
        let retries = 0;
        t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
            if (process.platform === 'win32' && !seen.has(String(from))) {
                seen.add(String(from)); retries++;
                throw Object.assign(new Error('temporary lock'), { code: 'EPERM' });
            }
            return original(from, to);
        });
        t.mock.method(Atomics, 'wait', () => 'timed-out');
        let calls = 0;
        const result = await enrichment.enrichVisibleTtangFlights(flights(), null, {
            now: NOW, checkpoint: writer,
            dependencies: {
                openSession: async () => ({ mode: 'external-chrome', close: async () => {}, page: {
                    goto: async () => null, waitForTimeout: async () => {},
                    locator: () => ({ innerText: async () => '' }), url: () => 'https://example.invalid',
                } as unknown as Page }),
                fetchSchedule: async () => { calls++; return { ...DATA }; }, delay: async () => {},
            },
        });
        assert.equal(calls, 6);
        assert.equal(result.stats.succeeded, 6);
        if (process.platform === 'win32') assert.ok(retries > calls);
        const saved = JSON.parse(fs.readFileSync(writer.filePath, 'utf8'));
        assert.equal(saved.status, 'completed');
        assert.equal(saved.counts.succeeded, 6);
        assert.equal(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')).length, 0);
    } finally { t.mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('normal completion checkpoints new requests only, not inherited cached detail', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-success-test-'));
    const dir = path.join(root, '.local-crawler', 'staging', 'run');
    fs.mkdirSync(dir, { recursive: true });
    try {
        const input = flights();
        input[0].departure.time = '01:00'; input[0].departure.arrivalTime = '02:00';
        input[0].arrival.time = '03:00'; input[0].arrival.arrivalTime = '04:00';
        input[0].detailCheckedAt = NOW.toISOString();
        const writer = new TtangDetailCheckpoint(root, dir, 'run-1', NOW, enrichment.TTANG_TIME_ADAPTER_VERSION);
        let calls = 0;
        const result = await enrichment.enrichVisibleTtangFlights(input, null, {
            now: NOW, checkpoint: writer,
            dependencies: {
                openSession: async () => ({ mode: 'external-chrome', close: async () => {}, page: {
                    goto: async () => null, waitForTimeout: async () => {},
                    locator: () => ({ innerText: async () => '' }), url: () => 'https://example.invalid',
                } as unknown as Page }),
                fetchSchedule: async () => { calls++; return { ...DATA, seats: 2 }; }, delay: async () => {},
            },
        });
        const saved = JSON.parse(fs.readFileSync(writer.filePath, 'utf8'));
        assert.equal(saved.status, 'completed');
        assert.equal(saved.counts.succeeded, 5);
        assert.equal(calls, 5);
        assert.equal(result.stats.succeeded, 5);
        assert.equal(saved.successes.some((p: any) => p.identity.fareId === '100'), false);
        assert.equal(saved.successes.every((p: any) => p.seatAction === 'set'), true);
        assert.equal(input[0].departure.time, '01:00');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('browser startup failure is an aborted checkpoint with no claimed successes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-startup-test-'));
    const dir = path.join(root, '.local-crawler', 'staging', 'run');
    fs.mkdirSync(dir, { recursive: true });
    try {
        const writer = new TtangDetailCheckpoint(root, dir, 'run-1', NOW, enrichment.TTANG_TIME_ADAPTER_VERSION);
        const failure = new Error('test startup failure');
        await assert.rejects(enrichment.enrichVisibleTtangFlights(flights(), null, {
            now: NOW, checkpoint: writer,
            dependencies: { openSession: async () => { throw failure; } },
        }), (error: unknown) => error === failure);
        const saved = JSON.parse(fs.readFileSync(writer.filePath, 'utf8'));
        assert.equal(saved.status, 'aborted');
        assert.equal(saved.counts.succeeded, 0);
        assert.equal(saved.counts.unqueried, 6);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('forced process termination preserves completed success and identifies in-flight product', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-kill-test-'));
    const dir = path.join(root, '.local-crawler', 'staging', 'run');
    fs.mkdirSync(dir, { recursive: true });
    const child = fork(path.resolve('scripts/fixtures/ttang-checkpoint-interruption.ts'), [root, dir], {
        execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const exited = once(child, 'exit');
    let timer: ReturnType<typeof setTimeout>;
    try {
        await Promise.race([
            once(child, 'message').then(([message]) => assert.equal(message, 'checkpoint-durable')),
            exited.then(() => { throw new Error('Fixture exited before checkpoint'); }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture timeout')), 15000); }),
        ]);
        child.kill('SIGTERM');
        await exited;
        const saved = JSON.parse(fs.readFileSync(path.join(dir, 'ttang-detail-checkpoint.json'), 'utf8'));
        assert.equal(saved.status, 'running'); // no fabricated graceful completion
        assert.equal(saved.counts.succeeded, 1);
        assert.equal(saved.counts.unqueried, 1);
        assert.equal(saved.successes[0].identity.fareId, '101');
        assert.equal(saved.checkpoint.inFlightKey, 'product|10|102|20991001');
    } finally {
        clearTimeout(timer!);
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; }
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('disk failure while recording a restriction never replaces the restriction or retries', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-disk-test-'));
    const dir = path.join(root, '.local-crawler', 'staging', 'run');
    fs.mkdirSync(dir, { recursive: true });
    try {
        const writer = new TtangDetailCheckpoint(root, dir, 'run-1', NOW, enrichment.TTANG_TIME_ADAPTER_VERSION);
        const queue = enrichment.prepareTtangTimeQueue(flights(), null, { now: NOW });
        writer.begin(queue.selected, 0);
        const restriction = new SourceResponseError('http-status', 'test restriction', 403);
        let diskAttempts = 0;
        let calls = 0;
        await assert.rejects(enrichment.runTtangProductDetails({} as Page, queue.selected, false, writer, {
            fetchSchedule: async () => {
                if (++calls === 1) return { ...DATA };
                t.mock.method(fs, 'renameSync', () => { diskAttempts++; throw Object.assign(new Error('disk failure'), { code: 'EIO' }); });
                throw restriction;
            }, delay: async () => {},
        }), (error: unknown) => error === restriction);
        assert.equal(calls, 2);
        assert.equal(diskAttempts, 1); // Non-lock I/O errors are never retried.
        const saved = JSON.parse(fs.readFileSync(writer.filePath, 'utf8'));
        assert.equal(saved.counts.succeeded, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('full enrichment abort retains original restriction and closes session after saving success', async () => {
    for (const restriction of [
        new SourceResponseError('http-status', 'denied', 401),
        new SourceResponseError('http-status', 'denied', 403),
        new SourceResponseError('http-status', 'rate limited', 429),
        new SourceResponseError('soft-block', 'CAPTCHA'),
    ]) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-partial-test-'));
        const dir = path.join(root, '.local-crawler', 'staging', 'run');
        fs.mkdirSync(dir, { recursive: true });
        try {
            const writer = new TtangDetailCheckpoint(root, dir, 'run-1', NOW, enrichment.TTANG_TIME_ADAPTER_VERSION);
            let calls = 0;
            let closed = 0;
            const input = flights();
            const previousState: enrichment.TtangTimeEnrichmentState = { version: 2, entries: {} };
            await assert.rejects(enrichment.enrichVisibleTtangFlights(input, previousState, {
                now: NOW, checkpoint: writer,
                dependencies: {
                    openSession: async () => ({
                        mode: 'external-chrome', close: async () => { closed++; },
                        page: {
                            goto: async () => null, waitForTimeout: async () => {},
                            locator: () => ({ innerText: async () => '' }), url: () => 'https://example.invalid',
                        } as unknown as Page,
                    }),
                    fetchSchedule: async () => { if (++calls === 1) return { ...DATA }; throw restriction; },
                    delay: async () => {},
                },
            }), (error: unknown) => error === restriction);
            const saved = JSON.parse(fs.readFileSync(writer.filePath, 'utf8'));
            assert.equal(saved.status, 'aborted');
            assert.equal(saved.counts.succeeded, 1);
            assert.equal(saved.counts.failed, 1);
            assert.equal(saved.counts.unqueried, 4);
            assert.equal(calls, 2);
            assert.equal(closed, 1);
            assert.deepEqual(previousState, { version: 2, entries: {} });
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});

test('product loop saves actual successes before deterministic abort and keeps untouched products out', async () => {
    assert.equal(typeof enrichment.runTtangProductDetails, 'function', 'checkpoint-enabled product runner required');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-partial-test-'));
    const dir = path.join(root, '.local-crawler', 'staging', 'run');
    fs.mkdirSync(dir, { recursive: true });
    try {
        const input = flights();
        const queue = enrichment.prepareTtangTimeQueue(input, null, { now: NOW });
        const writer = new TtangDetailCheckpoint(root, dir, 'run-1', NOW, enrichment.TTANG_TIME_ADAPTER_VERSION);
        writer.begin(queue.selected, queue.stats.deferred);
        let calls = 0;
        const delays: number[][] = [];
        await assert.rejects(async () => {
            try {
                await enrichment.runTtangProductDetails({} as Page, queue.selected, false, writer, {
                    fetchSchedule: async () => {
                        calls++;
                        if (calls === 1) return { ...DATA };
                        if (calls === 2) return null;
                        throw new SourceResponseError('api-error', 'test E001', undefined, undefined, 'E001');
                    },
                    delay: async (a, b) => { delays.push([a, b]); },
                    clock: () => new Date(),
                });
            } catch (error) { writer.abort(error); throw error; }
        }, (error: unknown) => error instanceof SourceResponseError && error.kind === 'api-error' && error.causeCode === 'E001');
        const saved = JSON.parse(fs.readFileSync(writer.filePath, 'utf8'));
        assert.equal(calls, 5);
        assert.deepEqual(saved.counts, { selected: 6, succeeded: 1, empty: 1, failed: 3, unqueried: 1, excludedLegacy: 0, deferred: 0 });
        assert.equal(saved.abortReason.kind, 'api-error');
        assert.deepEqual(delays, [[4, 8], [4, 8], [4, 6.4], [8, 12.8]]);
        assert.equal(input[0].departure.time, DATA.depTime);
        assert.equal(input[0].availableSeats, undefined);
        assert.equal(input[0].seats, undefined);
        assert.equal(input[1].departure.time, '');
        assert.equal(input[5].detailCheckedAt, undefined);
        assert.equal(saved.successes[0].identity.fareId, '100');
        assert.equal(saved.successes[0].detailCheckedAt, input[0].detailCheckedAt);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
