import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const runnerFile = path.resolve(__dirname, 'replay-onlinetour-list-traversal.ts');
const tsxFile = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
test('offline CLI help works without browser or staging writes and refuses live flags', () => {
    assert.ok(fs.existsSync(runnerFile), 'offline traversal replay runner must exist');
    const help = spawnSync(process.execPath, [tsxFile, runnerFile, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /OFFLINE/);
    const rejected = spawnSync(process.execPath, [tsxFile, runnerFile, '--consent-confirmed'], { encoding: 'utf8' });
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /--fixture/);
});
const scope = { departure: 'ICN', city: 'PQC', month: '202609' };
const manifest = () => ({ schemaVersion: 1, evidence: 'synthetic_offline_fixture', scopes: [scope], observations: [
    { scope, pageNo: 1, attempt: 1, result: { pageNo: 1, totalCount: 0, lastPage: 1, rawProducts: [], nextPageAvailable: false } },
] });
async function runner() {
    assert.ok(fs.existsSync(runnerFile), 'offline traversal replay runner must exist');
    return import('./replay-onlinetour-list-traversal');
}

test('replay manifest requires an explicitly offline fixture and rejects ambiguous outcomes', async () => {
    const { parseReplayManifest } = await runner();
    assert.deepEqual(parseReplayManifest(manifest()), manifest());
    for (const evidence of ['live_success', '', null, ['synthetic_offline_fixture']]) {
        assert.throws(() => parseReplayManifest({ ...manifest(), evidence }));
    }
    const badError = manifest() as any;
    delete badError.observations[0].result;
    badError.observations[0].error = { kind: ['transient'] };
    assert.throws(() => parseReplayManifest(badError));
    const both = manifest() as any;
    both.observations[0].error = { kind: 'transient' };
    assert.throws(() => parseReplayManifest(both));
    assert.throws(() => parseReplayManifest({ ...manifest(), schemaVersion: 2 }));
});

test('offline CLI executes a local fixture and reads back its exact staging summary', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'online-replay-cli-'));
    try {
        const input = path.join(temporary, 'fixture.json');
        fs.writeFileSync(input, JSON.stringify(manifest()));
        const run = spawnSync(process.execPath, [tsxFile, runnerFile, '--fixture', input], { encoding: 'utf8', timeout: 15000 });
        assert.equal(run.status, 0, run.stderr);
        const summary = JSON.parse(run.stdout.trim());
        assert.match(summary.runId, /^[0-9a-f-]{36}$/);
        const exact = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../.local-crawler/staging', summary.runId, 'summary.json'), 'utf8'));
        assert.equal(exact.offlineOnly, true);
        assert.equal(exact.siteRequestCount, 0);
        assert.equal(exact.status, 'review_ready');
        assert.equal(exact.runId, summary.runId);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('a successful replay cannot silently ignore extra recorded requests', async () => {
    const { runTraversalReplay } = await runner();
    const input = manifest();
    input.observations.push(structuredClone(input.observations[0]));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-replay-extra-'));
    try {
        const result = await runTraversalReplay(input, root);
        assert.equal(result.status, 'failed');
        assert.equal(result.replayIssue, 'offline_transcript_unused');
        assert.equal(result.unusedObservations, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('offline replay executes the traversal and persists explicitly offline staging only', async () => {
    const loaded = await runner();
    assert.equal(typeof loaded.runTraversalReplay, 'function', 'replay execution must exist');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-replay-'));
    try {
        fs.mkdirSync(path.join(root, 'data'));
        const protectedFile = path.join(root, 'data', 'all-flights-cache.json');
        fs.writeFileSync(protectedFile, 'unchanged');
        const result = await loaded.runTraversalReplay(manifest(), root);
        const dir = path.join(root, '.local-crawler', 'staging', result.runId);
        const saved = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
        assert.equal(saved.status, 'review_ready');
        assert.equal(saved.offlineOnly, true);
        assert.equal(saved.productionReady, false);
        assert.equal(saved.siteRequestCount, 0);
        assert.equal(saved.replayedRequestCount, 1);
        assert.equal(saved.fixtureEvidence, 'synthetic_offline_fixture');
        assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'unchanged');
        assert.deepEqual(fs.readdirSync(dir).sort(), ['flights.json', 'raw-products.json', 'summary.json']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
