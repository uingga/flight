import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as validation from './ttang-staging-validation.mjs';
import {
    countFreshTtangDetails,
    isTtangStagingReady,
} from './ttang-staging-validation.mjs';

test('failed, missing or interrupted detail evidence cannot be ready for review', () => {
    for (const partialDetails of [
        { status: 'interrupted', counts: { failed: 0 } },
        { status: 'aborted', counts: { failed: 1 } },
        { status: 'completed', counts: { failed: 1 } },
        { status: 'invalid' }, { status: 'not_started' },
    ]) {
        assert.equal(isTtangStagingReady({ sourceAccepted: true, timeVerified: 1, seatVerified: 1, partialDetails }), false);
    }
});

test('partial checkpoint is reported separately and cannot turn an interrupted run into success', () => {
    assert.equal(typeof validation.readTtangPartialSummary, 'function');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-summary-test-'));
    try {
        const file = path.join(dir, 'ttang-detail-checkpoint.json');
        assert.equal(validation.readTtangPartialSummary(dir, 'run-1', {}).status, 'not_started');
        const checkpoint = {
            version: 1, runId: 'run-1', operationalEligible: false, status: 'running',
            counts: { selected: 3, succeeded: 1, empty: 0, failed: 1, unqueried: 1, excludedLegacy: 0, deferred: 0 },
            checkpoint: { lastCompletedKey: 'b', inFlightKey: 'c' },
            successes: [{ key: 'a' }], outcomes: [{ key: 'a', status: 'success' }, { key: 'b', status: 'transient_error' }],
        };
        fs.writeFileSync(file, JSON.stringify(checkpoint));
        const summary = validation.readTtangPartialSummary(dir, 'run-1', { timedOut: true });
        assert.equal(summary.status, 'interrupted');
        assert.equal(summary.abortReason.kind, 'timeout');
        assert.equal(summary.counts.succeeded, 1);
        assert.equal(summary.operationalEligible, false);
        assert.equal(summary.file, file);
        assert.equal(validation.readTtangPartialSummary(dir, 'wrong-run', {}).status, 'invalid');
        fs.writeFileSync(file, JSON.stringify({ ...checkpoint, counts: { ...checkpoint.counts, succeeded: 9 } }));
        assert.equal(validation.readTtangPartialSummary(dir, 'run-1', {}).status, 'invalid');
        fs.writeFileSync(file, '{truncated');
        assert.equal(validation.readTtangPartialSummary(dir, 'run-1', {}).status, 'invalid');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const runStartedAt = '2026-09-05T01:00:00.000Z';
const runId = 'run-1';
const now = Date.parse('2026-09-05T02:00:00.000Z');
const completeFlight = {
    source: 'ttang',
    ttangProduct: { masterId: 'master-1', fareId: 'fare-1', fareType: 'IN', carrierCode: 'KE' },
    departure: { airport: 'ICN', date: '2026-09-10', time: '09:00', arrivalTime: '10:30' },
    arrival: { airport: 'NRT', date: '2026-09-15', time: '18:00', arrivalTime: '19:30' },
    availableSeats: 4,
    seats: '4석',
    detailCheckedAt: '2026-09-05T01:00:00.001Z',
};

function currentCheckpoint() {
    const key = 'product|master-1|fare-1|20260910';
    return {
        version: 1, runId, startedAt: runStartedAt, adapterVersion: 'test-adapter',
        operationalEligible: false, status: 'completed',
        counts: { selected: 1, succeeded: 1, empty: 0, failed: 0, unqueried: 0, excludedLegacy: 0, deferred: 0 },
        outcomes: [{ key, status: 'success', checkedAt: completeFlight.detailCheckedAt }],
        successes: [{
            key, runId, adapterVersion: 'test-adapter', detailCheckedAt: completeFlight.detailCheckedAt,
            identity: { masterId: 'master-1', fareId: 'fare-1', departureDate: '20260910' },
            route: { depCode: 'ICN', arrCode: 'NRT', arrivalDate: '20260915', carrierCode: 'KE', fareType: 'IN' },
            detail: { depTime: '09:00', arrTime: '10:30', retDepTime: '18:00', retArrTime: '19:30', seats: 4 },
            seatAction: 'set',
        }],
    };
}

function currentEvidence(partialDetails = currentCheckpoint()) {
    return { runId, partialDetails, now };
}

test('inherited detail without a current-run success cannot approve staging, including future dates', () => {
    const checkpoint = currentCheckpoint();
    checkpoint.counts.selected = checkpoint.counts.succeeded = 0;
    checkpoint.successes = checkpoint.outcomes = [];
    for (const detailCheckedAt of [completeFlight.detailCheckedAt, '2099-01-01T00:00:00.000Z']) {
        const counts = countFreshTtangDetails([{ ...completeFlight, detailCheckedAt }], runStartedAt, currentEvidence(checkpoint));
        assert.deepEqual(counts, { timeVerified: 0, seatVerified: 0 });
        assert.equal(isTtangStagingReady({ sourceAccepted: true, ...counts, partialDetails: checkpoint }), false);
    }
    assert.deepEqual(countFreshTtangDetails([completeFlight], runStartedAt), { timeVerified: 0, seatVerified: 0 });
});

test('verified counts require exact run, product, route, timestamp, four times and seat evidence', () => {
    const mutations = [
        c => { c.runId = 'other-run'; },
        c => { c.startedAt = '2026-09-05T00:59:59.999Z'; },
        c => { c.adapterVersion = 'other-adapter'; },
        c => { c.successes[0].runId = 'other-run'; },
        c => { c.successes[0].adapterVersion = 'other-adapter'; },
        c => { c.successes[0].key = 'other-product'; },
        ...['masterId', 'fareId', 'departureDate'].map(field => c => { c.successes[0].identity[field] = 'other'; }),
        ...['depCode', 'arrCode', 'arrivalDate', 'carrierCode', 'fareType'].map(field => c => { c.successes[0].route[field] = 'other'; }),
        ...['depTime', 'arrTime', 'retDepTime', 'retArrTime'].map(field => c => { c.successes[0].detail[field] = '11:11'; }),
        c => { c.successes[0].detail.seats = 3; },
        c => { c.successes[0].seatAction = 'clear'; },
        c => { c.successes[0].detailCheckedAt = '2026-09-05T01:00:00.002Z'; },
        c => { c.outcomes[0].status = 'empty'; },
        c => { c.outcomes[0].checkedAt = '2026-09-05T01:00:00.002Z'; },
        c => { c.outcomes[0].key = 'other-product'; },
    ];
    for (const mutate of mutations) {
        const checkpoint = currentCheckpoint();
        mutate(checkpoint);
        assert.deepEqual(countFreshTtangDetails([completeFlight], runStartedAt, currentEvidence(checkpoint)),
            { timeVerified: 0, seatVerified: 0 }, String(mutate));
    }
    for (const detailCheckedAt of ['2026-09-05T00:59:59.999Z', '2026-09-05T02:00:00.001Z', 'invalid']) {
        const checkpoint = currentCheckpoint();
        checkpoint.successes[0].detailCheckedAt = checkpoint.outcomes[0].checkedAt = detailCheckedAt;
        assert.deepEqual(countFreshTtangDetails([{ ...completeFlight, detailCheckedAt }], runStartedAt, currentEvidence(checkpoint)),
            { timeVerified: 0, seatVerified: 0 }, detailCheckedAt);
    }
});

test('a verified clear-seat success counts times but never inherited seats', () => {
    const checkpoint = currentCheckpoint();
    checkpoint.successes[0].detail.seats = 0;
    checkpoint.successes[0].seatAction = 'clear';
    const flight = { ...completeFlight };
    delete flight.availableSeats;
    delete flight.seats;
    assert.deepEqual(countFreshTtangDetails([flight], runStartedAt, currentEvidence(checkpoint)), { timeVerified: 1, seatVerified: 0 });
    assert.deepEqual(countFreshTtangDetails([completeFlight], runStartedAt, currentEvidence(checkpoint)), { timeVerified: 0, seatVerified: 0 });
});

test('checkpoint readback supplies the exact current-run evidence to verified counts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-bound-summary-'));
    try {
        fs.writeFileSync(path.join(dir, 'ttang-detail-checkpoint.json'), JSON.stringify(currentCheckpoint()));
        const partialDetails = validation.readTtangPartialSummary(dir, runId);
        assert.deepEqual(countFreshTtangDetails([completeFlight], runStartedAt, currentEvidence(partialDetails)),
            { timeVerified: 1, seatVerified: 1 });
        assert.deepEqual(countFreshTtangDetails([completeFlight], runStartedAt, { ...currentEvidence(partialDetails), runId: 'other-run' }),
            { timeVerified: 0, seatVerified: 0 });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Run the real wrapper against a temporary, offline child fixture, never crawl-all.ts.
function runOfflineStaging(mode) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttang-wrapper-test-'));
    try {
        fs.mkdirSync(path.join(root, 'data'));
        fs.mkdirSync(path.join(root, 'node_modules/tsx/dist'), { recursive: true });
        fs.writeFileSync(path.join(root, 'data/all-flights-cache.json'), JSON.stringify({ flights: [], sourceUpdatedAt: {} }));
        fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ mode, flight: completeFlight, checkpoint: currentCheckpoint() }));
        fs.writeFileSync(path.join(root, 'node_modules/tsx/dist/cli.mjs'), `
            import fs from 'node:fs';
            import path from 'node:path';
            const { mode, flight, checkpoint } = JSON.parse(fs.readFileSync('fixture.json', 'utf8'));
            const dir = process.env.TIKITIKIT_DATA_DIR;
            const checkedAt = mode === 'future' || mode === 'inherited' ? '2099-01-01T00:00:00.000Z' : new Date().toISOString();
            checkpoint.runId = process.env.TTANG_STAGING_RUN_ID;
            checkpoint.startedAt = process.env.TTANG_STAGING_STARTED_AT;
            checkpoint.successes[0].runId = checkpoint.runId;
            checkpoint.successes[0].detailCheckedAt = checkpoint.outcomes[0].checkedAt = flight.detailCheckedAt = checkedAt;
            if (mode === 'inherited') {
                checkpoint.successes = checkpoint.outcomes = [];
                checkpoint.counts.selected = checkpoint.counts.succeeded = 0;
            }
            if (mode === 'wrong-start') checkpoint.startedAt = '2000-01-01T00:00:00.000Z';
            if (mode === 'legacy') checkpoint.counts.excludedLegacy = 1;
            fs.writeFileSync(path.join(dir, 'ttang-detail-checkpoint.json'), JSON.stringify(checkpoint));
            fs.writeFileSync(path.join(dir, 'all-flights-cache.json'), JSON.stringify({ flights: [flight], sourceUpdatedAt: { ttang: new Date().toISOString() } }));
        `);
        const output = path.join(root, '.local-crawler/staging/run');
        const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-ttang-browser-staging.mjs', import.meta.url)), `--output=${output}`],
            { cwd: root, encoding: 'utf8', timeout: 10_000 });
        assert.equal(result.error, undefined, result.stderr);
        const summary = JSON.parse(fs.readFileSync(path.join(output, 'summary.json'), 'utf8'));
        return { exitCode: result.status, summary };
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('real staging wrapper binds approvals to this run checkpoint instead of inherited or future detail', () => {
    const valid = runOfflineStaging('valid');
    assert.equal(valid.exitCode, 0);
    assert.equal(valid.summary.status, 'ready_for_review');
    assert.equal(valid.summary.ttang.timeVerified, 1);
    assert.equal(valid.summary.ttang.seatVerified, 1);
    for (const mode of ['inherited', 'future', 'wrong-start']) {
        const rejected = runOfflineStaging(mode);
        assert.equal(rejected.exitCode, 1, mode);
        assert.equal(rejected.summary.status, 'failed_validation', mode);
        assert.equal(rejected.summary.ttang.timeVerified, 0, mode);
        assert.equal(rejected.summary.ttang.seatVerified, 0, mode);
    }
});

test('selected legacy evidence fails closed even when product failures are zero', () => {
    const partialDetails = currentCheckpoint();
    const counts = countFreshTtangDetails([completeFlight], runStartedAt, currentEvidence(partialDetails));
    assert.equal(isTtangStagingReady({ sourceAccepted: true, ...counts, partialDetails }), true);
    // A failed legacy request has no outcome/success patch and is absent from failed.
    for (const excludedLegacy of [1, 2, undefined]) {
        partialDetails.counts.excludedLegacy = excludedLegacy;
        assert.equal(isTtangStagingReady({ sourceAccepted: true, ...counts, partialDetails }), false);
    }
});

test('real staging wrapper rejects excluded legacy results despite a verified product success', () => {
    const { exitCode, summary } = runOfflineStaging('legacy');
    assert.equal(exitCode, 1);
    assert.equal(summary.status, 'failed_validation');
    assert.equal(summary.partialDetails.counts.failed, 0);
    assert.equal(summary.partialDetails.counts.excludedLegacy, 1);
    assert.equal(summary.ttang.timeVerified, 1);
    assert.equal(summary.ttang.seatVerified, 1);
});

test('이전 회차의 시간·좌석은 staging 검증 건수에 포함하지 않는다', () => {
    assert.deepEqual(countFreshTtangDetails([{
        ...completeFlight,
        detailCheckedAt: '2026-09-05T00:59:59.999Z',
    }], runStartedAt, currentEvidence()), {
        timeVerified: 0,
        seatVerified: 0,
    });
});

test('현재 회차에 확인한 완전한 시간·좌석은 staging 검증 건수에 포함한다', () => {
    assert.deepEqual(countFreshTtangDetails([{
        ...completeFlight,
        detailCheckedAt: '2026-09-05T01:00:00.001Z',
    }], runStartedAt, currentEvidence()), {
        timeVerified: 1,
        seatVerified: 1,
    });
});

test('현재 회차의 좌석이 있어도 네 시간 중 하나라도 없으면 검증 건수에 포함하지 않는다', () => {
    assert.deepEqual(countFreshTtangDetails([
        {
            ...completeFlight,
            departure: { time: '09:00' },
            detailCheckedAt: '2026-09-05T01:00:00.001Z',
        },
        {
            ...completeFlight,
            arrival: { time: '18:00' },
            detailCheckedAt: '2026-09-05T01:00:00.002Z',
        },
    ], runStartedAt, currentEvidence()), {
        timeVerified: 0,
        seatVerified: 0,
    });
});

test('목록만 갱신되고 상세 시간·좌석이 없으면 staging 검증에 실패한다', () => {
    assert.equal(isTtangStagingReady({
        sourceAccepted: true,
        timeVerified: 0,
        seatVerified: 0,
    }), false);
});

test('상세 시간은 있어도 좌석을 확인하지 못하면 staging 검증에 실패한다', () => {
    assert.equal(isTtangStagingReady({
        sourceAccepted: true,
        timeVerified: 1,
        seatVerified: 0,
    }), false);
});

test('목록·상세 시간·좌석을 모두 확인해야 staging 검증에 통과한다', () => {
    assert.equal(isTtangStagingReady({
        sourceAccepted: true,
        timeVerified: 1,
        seatVerified: 1,
    }), true);
});
