import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { TtangTimeCandidate } from '../src/lib/ttang-time-enrichment';

const NOW = new Date(Date.now() - 60_000);
const data = { depTime: '09:00', arrTime: '11:00', retDepTime: '18:00', retArrTime: '20:00', seats: 0 };
function candidate(fareId = '101'): TtangTimeCandidate {
    return {
        key: `product|10|${fareId}|20261001`, routeId: 'ICN|NRT|20261001|20261004',
        route: { depCode: 'ICN', arrCode: 'NRT', depDate: '20261001', arrDate: '20261004', airline: '제주항공' },
        product: { masterId: '10', fareId, fareType: 'VV', carrierCode: '7C', depCode: 'ICN', arrCode: 'NRT', departureDate: '20261001', arrivalDate: '20261004' },
        flights: [], priority: 0, lastAttemptAt: 0,
    };
}
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-checkpoint-test-'));
    const dir = path.join(root, '.local-crawler', 'staging', 'test-run');
    fs.mkdirSync(dir, { recursive: true });
    return { root, dir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}


test('temporary Windows delete-sharing lock does not lose a successful detail', { skip: process.platform !== 'win32' }, async () => {
    const { TtangDetailCheckpoint } = await import('../src/lib/ttang-detail-checkpoint');
    const f = fixture();
    let locker: ReturnType<typeof spawn> | undefined;
    try {
        const writer = new TtangDetailCheckpoint(f.root, f.dir, 'run-lock', NOW, 'adapter-test');
        const c = candidate();
        writer.begin([c], 0);
        writer.start(c.key);
        // Real Windows handle permits reads/writes but denies rename/delete until released.
        locker = spawn('powershell.exe', ['-NoProfile', '-Command',
            "$h=[System.IO.File]::Open($env:CHECKPOINT_LOCK_FILE,'Open','Read','ReadWrite'); [Console]::WriteLine('LOCKED'); Start-Sleep -Milliseconds 500; $h.Dispose()"],
            { env: { ...process.env, CHECKPOINT_LOCK_FILE: writer.filePath }, stdio: ['ignore', 'pipe', 'pipe'] });
        const exited = once(locker, 'exit');
        const [ready] = await once(locker.stdout!, 'data');
        assert.match(ready.toString(), /LOCKED/);
        assert.doesNotThrow(() => writer.record(c, { status: 'success', data }, NOW));
        await exited;
        writer.complete();
        const saved = JSON.parse(fs.readFileSync(writer.filePath, 'utf8'));
        assert.equal(saved.status, 'completed');
        assert.equal(saved.counts.succeeded, 1);
        assert.equal(saved.successes[0].key, c.key);
        assert.equal(saved.operationalEligible, false);
    } finally {
        if (locker && locker.exitCode === null) { locker.kill(); await once(locker, 'exit'); }
        f.cleanup();
    }
});

test('exhausted lock preserves evidence and cannot poison the later abort save', async (t) => {
    const { TtangDetailCheckpoint } = await import('../src/lib/ttang-detail-checkpoint');
    const f = fixture();
    try {
        const writer = new TtangDetailCheckpoint(f.root, f.dir, 'run-lock', NOW, 'adapter-test');
        const c = candidate();
        writer.begin([c], 0);
        writer.start(c.key);
        const before = fs.readFileSync(writer.filePath, 'utf8');
        const error = Object.assign(new Error('locked'), { code: 'EPERM' });
        let attempts = 0;
        t.mock.method(fs, 'renameSync', () => { attempts++; throw error; });
        const waits: number[] = [];
        t.mock.method(Atomics, 'wait', (_a: unknown, _i: number, _v: number, ms: number) => { waits.push(ms); return 'timed-out'; });
        assert.throws(() => writer.record(c, { status: 'success', data }, NOW), e => e === error);
        assert.equal(attempts, process.platform === 'win32' ? 7 : 1);
        assert.ok(waits.reduce((a, b) => a + b, 0) <= 3000);
        assert.equal(fs.readFileSync(writer.filePath, 'utf8'), before);
        const pending = fs.readdirSync(f.dir).filter(name => name.endsWith('.tmp'));
        assert.equal(pending.length, 1);
        const evidence = fs.readFileSync(path.join(f.dir, pending[0]), 'utf8');
        assert.equal(JSON.parse(evidence).counts.succeeded, 1);
        t.mock.restoreAll();
        assert.doesNotThrow(() => writer.abort(error));
        assert.equal(fs.readFileSync(path.join(f.dir, pending[0]), 'utf8'), evidence);
        const saved = JSON.parse(fs.readFileSync(writer.filePath, 'utf8'));
        assert.equal(saved.status, 'aborted');
        assert.equal(saved.counts.succeeded, 1);
        assert.equal(saved.operationalEligible, false);
    } finally { t.mock.restoreAll(); f.cleanup(); }
});

test('staging root itself cannot be a junction into operational data', async () => {
    const { TtangDetailCheckpoint } = await import('../src/lib/ttang-detail-checkpoint');
    const f = fixture();
    try {
        fs.rmSync(path.join(f.root, '.local-crawler', 'staging'), { recursive: true });
        const operational = path.join(f.root, 'data');
        fs.mkdirSync(path.join(operational, 'run'), { recursive: true });
        fs.symlinkSync(operational, path.join(f.root, '.local-crawler', 'staging'), 'junction');
        assert.throws(() => new TtangDetailCheckpoint(f.root, path.join(operational, 'run'), 'run-1', NOW, 'adapter-test'));
    } finally { f.cleanup(); }
});

test('checkpoint cannot reset evidence, complete unfinished work or escape staging', async () => {
    const { TtangDetailCheckpoint } = await import('../src/lib/ttang-detail-checkpoint');
    const f = fixture();
    try {
        const writer = new TtangDetailCheckpoint(f.root, f.dir, 'run-1', NOW, 'adapter-test');
        const c = candidate();
        assert.throws(() => writer.start(c.key));
        writer.begin([c], 0);
        assert.throws(() => writer.begin([c], 0));
        assert.throws(() => writer.start('not-selected'));
        assert.throws(() => writer.complete());
        writer.start(c.key);
        writer.record(c, { status: 'empty', data }, NOW);
        writer.complete();
        const saved = JSON.parse(fs.readFileSync(writer.filePath, 'utf8'));
        assert.equal(saved.successes.length, 0);
        assert.equal(saved.counts.empty, 1);
        assert.throws(() => writer.start(c.key));
        assert.throws(() => new TtangDetailCheckpoint(f.root, f.dir, 'run-2', NOW, 'adapter-test'));
        const operational = path.join(f.root, 'data');
        fs.mkdirSync(operational);
        fs.writeFileSync(path.join(operational, 'all-flights-cache.json'), 'protected');
        assert.throws(() => new TtangDetailCheckpoint(f.root, operational, 'run-1', NOW, 'adapter-test'));
        const link = path.join(f.root, '.local-crawler', 'staging', 'escape');
        fs.symlinkSync(operational, link, 'junction');
        assert.throws(() => new TtangDetailCheckpoint(f.root, link, 'run-1', NOW, 'adapter-test'));
        assert.equal(fs.readFileSync(path.join(operational, 'all-flights-cache.json'), 'utf8'), 'protected');
    } finally { f.cleanup(); }
});

test('only complete, current-run, exact selected product results can be recorded', async () => {
    const { TtangDetailCheckpoint } = await import('../src/lib/ttang-detail-checkpoint');
    for (const bad of ['stale', 'future', 'missing-time', 'invalid-time', 'wrong-fare', 'wrong-date', 'wrong-route', 'legacy', 'duplicate']) {
        const f = fixture();
        try {
            const writer = new TtangDetailCheckpoint(f.root, f.dir, 'run-1', NOW, 'adapter-test');
            const original = candidate();
            writer.begin([original], 0);
            writer.start(original.key);
            const c = structuredClone(original);
            const d = { ...data };
            let checkedAt = NOW;
            if (bad === 'stale') checkedAt = new Date(NOW.getTime() - 1);
            if (bad === 'future') checkedAt = new Date(Date.now() + 60_000);
            if (bad === 'missing-time') d.retArrTime = '';
            if (bad === 'invalid-time') d.depTime = '29:99';
            if (bad === 'wrong-fare') c.product!.fareId = '102';
            if (bad === 'wrong-date') c.product!.departureDate = '20261002';
            if (bad === 'wrong-route') c.product!.arrCode = 'KIX';
            if (bad === 'legacy') delete c.product;
            if (bad === 'duplicate') writer.record(original, { status: 'success', data: d }, NOW);
            const before = fs.readFileSync(writer.filePath, 'utf8');
            assert.throws(() => writer.record(c, { status: 'success', data: d }, checkedAt), Error, bad);
            assert.equal(fs.readFileSync(writer.filePath, 'utf8'), before, bad);
        } finally { f.cleanup(); }
    }
});

test('fresh success is durable and immutable after later abort, without copying old flight fields', async () => {
    assert.ok(fs.existsSync(path.resolve('src/lib/ttang-detail-checkpoint.ts')), 'staging checkpoint implementation is required');
    const { TtangDetailCheckpoint } = await import('../src/lib/ttang-detail-checkpoint');
    const f = fixture();
    try {
        const writer = new TtangDetailCheckpoint(f.root, f.dir, 'run-1', NOW, 'adapter-test');
        const first = candidate();
        const second = candidate('102');
        writer.begin([first, second], 3);
        writer.start(first.key);
        const result = { ...data };
        writer.record(first, { status: 'success', data: result }, NOW);
        result.depTime = '01:00';
        first.product!.fareId = 'mutated';
        writer.start(second.key);
        writer.record(second, { status: 'transient_error' }, NOW);
        writer.abort(new Error('network stopped'));
        const saved = JSON.parse(fs.readFileSync(writer.filePath, 'utf8'));
        assert.equal(saved.status, 'aborted');
        assert.equal(saved.operationalEligible, false);
        assert.deepEqual(saved.counts, { selected: 2, succeeded: 1, empty: 0, failed: 1, unqueried: 0, excludedLegacy: 0, deferred: 3 });
        assert.equal(saved.successes.length, 1);
        assert.equal(saved.successes[0].identity.fareId, '101');
        assert.equal(saved.successes[0].detail.depTime, '09:00');
        assert.equal(saved.successes[0].detail.seats, 0);
        assert.equal(saved.successes[0].seatAction, 'clear');
        assert.equal(saved.successes[0].adapterVersion, 'adapter-test');
        assert.equal(saved.successes[0].runId, 'run-1');
        assert.equal(saved.successes[0].detailCheckedAt, NOW.toISOString());
        assert.equal('flights' in saved, false);
        assert.equal('sourceUpdatedAt' in saved, false);
        assert.equal(saved.checkpoint.lastCompletedKey, second.key);
        assert.equal(saved.checkpoint.inFlightKey, null);
    } finally { f.cleanup(); }
});
