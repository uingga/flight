import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { executeAgencyEvening, validateAgencyEveningRequest, AGENCY_EVENING_PROTOCOL } from './agency-evening-worker.mjs';

const slot = '2026-09-25T11:30:00.000Z';
const now = Date.parse(slot) + 5 * 60_000;
const request = () => ({
    protocol: AGENCY_EVENING_PROTOCOL, id: randomUUID(), slot,
    sources: ['ybtour', 'hanatour'], createdAt: new Date(now).toISOString(),
    files: {
        'all-flights-cache.json': { flights: [], fullCrawlUpdatedAt: '2026-09-25T10:32:00.000Z', sourceCircuits: {} },
        'crawl-log.json': { entries: [] },
    },
});

function testBase(t) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agency-evening-worker-test-'));
    t.after(() => {
        if (!base.startsWith(os.tmpdir() + path.sep)) throw new Error('unsafe_test_cleanup');
        fs.rmSync(base, { recursive: true, force: true });
    });
    return base;
}

test('worker accepts only a fresh request for the assigned PC', () => {
    const value = request();
    assert.equal(validateAgencyEveningRequest(value, { now, hostname: 'DESKTOP-OFFICE' }), value);
    assert.throws(() => validateAgencyEveningRequest(value, { now, hostname: 'DESKTOP-1PPFUR3' }), /host_mismatch/);
    assert.throws(() => validateAgencyEveningRequest(value, { now: now + 6 * 60_000,
        hostname: 'DESKTOP-OFFICE' }), /invalid_evening_request/);
});

test('B collects each assigned source once and preserves its slot claim', async t => {
    const base = testBase(t);
    const value = request();
    const calls = [];
    const collector = (_program, args, options) => {
        const source = args.at(-1);
        calls.push(source);
        const cachePath = path.join(options.env.TIKITIKIT_DATA_DIR, 'all-flights-cache.json');
        const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        delete cache.eveningPrimary; // crawl-all rebuilds its cache and does not know this worker metadata.
        cache.sourceUpdatedAt = { ...cache.sourceUpdatedAt,
            [source]: options.env.AGENCY_EVENING_STARTED_AT };
        fs.writeFileSync(cachePath, JSON.stringify(cache));
        return { status: 0 };
    };
    const reply = await executeAgencyEvening(value, { now: () => now, hostname: 'DESKTOP-OFFICE', base, collectorRoot: base, collector });
    assert.deepEqual(calls, ['ybtour', 'hanatour']);
    assert.deepEqual(reply.sources, value.sources);
    assert.deepEqual(reply.results.map(item => item.status), ['success', 'success']);
    assert.equal(reply.cache.eveningPrimary.hanatour.lastAttemptAt, new Date(now).toISOString());
    assert.equal(reply.cache.eveningPrimary.ybtour.lastAttemptAt, new Date(now).toISOString());
    assert.equal(fs.existsSync(path.join(base, 'onlinetour-validation/run.lock')), false);
    await assert.rejects(executeAgencyEvening(value, { now: () => now, hostname: 'DESKTOP-OFFICE', base, collectorRoot: base, collector }));
    assert.deepEqual(calls, ['ybtour', 'hanatour']);
    assert.equal(fs.existsSync(path.join(base, 'onlinetour-validation/run.lock')), false);
});

test('uncertain source result is not retried and only that source receives a cooldown', async t => {
    const base = testBase(t);
    const value = request();
    const calls = [];
    const collector = (_program, args) => { calls.push(args.at(-1)); return { status: 1 }; };
    await assert.rejects(executeAgencyEvening(value, { now: () => now, hostname: 'DESKTOP-OFFICE', base, collectorRoot: base, collector }),
        /evening_result_unverified/);
    assert.deepEqual(calls, ['ybtour']);
    const unknown = JSON.parse(fs.readFileSync(path.join(base, 'agency-evening-v1/ybtour-unknown.json'), 'utf8'));
    assert.equal(Date.parse(unknown.nextProbeAt), now + 86_400_000);
    assert.equal(fs.existsSync(path.join(base, 'onlinetour-validation/run.lock')), false);
});

test('a later failed child cannot erase or mutate an already verified source reply', async t => {
    const base = testBase(t), value = request();
    value.sources.push('onlinetour');
    const calls = [], stages = [];
    const collector = (_program, args, options) => {
        const source = args.at(-1), dir = options.env.TIKITIKIT_DATA_DIR;
        calls.push(source); stages.push(dir);
        assert.equal(options.cwd, base);
        assert.equal(path.relative(path.join(base, '.local-crawler/staging'), dir), `evening-${value.id}-${source}`);
        const file = path.join(dir, 'all-flights-cache.json');
        const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (source === 'ybtour') {
            cache.flights = [{ id: 'fixture-ybtour', source, price: 100000 }];
            cache.sourceUpdatedAt = { ybtour: options.env.AGENCY_EVENING_STARTED_AT };
            fs.writeFileSync(file, JSON.stringify(cache));
            return { status: 0 };
        }
        cache.flights = []; // Simulate a partially written, invalid result after the first success.
        cache.sourceUpdatedAt = { ybtour: '2099-01-01T00:00:00Z' };
        fs.writeFileSync(file, JSON.stringify(cache));
        return { status: 1 };
    };
    const reply = await executeAgencyEvening(value, { now: () => now, hostname: 'DESKTOP-OFFICE', base, collectorRoot: base, collector });
    assert.deepEqual(calls, ['ybtour', 'hanatour']); // Unknown cleanup cannot authorize another source.
    assert.equal(new Set(stages).size, 2);
    assert.deepEqual(reply.sources, ['ybtour']);
    assert.deepEqual(reply.failure, { source: 'hanatour', attempted: true, reason: 'collector_unconfirmed' });
    assert.equal(reply.cache.flights[0].price, 100000);
    assert.equal(reply.cache.sourceUpdatedAt.ybtour, new Date(now).toISOString());
    assert.equal(fs.existsSync(path.join(base, 'agency-evening-v1', value.id, 'reply.json')), true);
    assert.equal(fs.existsSync(path.join(base, 'onlinetour-validation/run.lock')), false);
    await assert.rejects(executeAgencyEvening(value, { now: () => now, hostname: 'DESKTOP-OFFICE', base, collectorRoot: base, collector }));
    assert.deepEqual(calls, ['ybtour', 'hanatour']);
});

test('a preflight refusal preserves the successful prefix without extending source cooldown', async t => {
    const base = testBase(t), value = request();
    fs.mkdirSync(path.join(base, 'agency-evening-v1'));
    const unknownFile = path.join(base, 'agency-evening-v1/hanatour-unknown.json');
    const existing = JSON.stringify({ reason: 'prior_unknown', nextProbeAt: new Date(now + 60000).toISOString() });
    fs.writeFileSync(unknownFile, existing);
    const collector = (_program, _args, options) => {
        const file = path.join(options.env.TIKITIKIT_DATA_DIR, 'all-flights-cache.json');
        const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
        cache.sourceUpdatedAt = { ybtour: options.env.AGENCY_EVENING_STARTED_AT };
        fs.writeFileSync(file, JSON.stringify(cache));
        return { status: 0 };
    };
    const reply = await executeAgencyEvening(value, { now: () => now, hostname: 'DESKTOP-OFFICE', base, collectorRoot: base, collector });
    assert.equal(reply.failure.attempted, false);
    assert.equal(reply.failure.reason, 'source_preflight_refused');
    assert.equal(fs.readFileSync(unknownFile, 'utf8'), existing);
    assert.deepEqual(reply.sources, ['ybtour']);
});
