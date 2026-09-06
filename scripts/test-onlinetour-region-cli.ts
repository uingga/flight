import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const script = path.resolve(__dirname, 'discover-onlinetour-regions.ts');
async function load() { assert.ok(fs.existsSync(script), 'regional CLI implementation exists'); return import('./discover-onlinetour-regions'); }
const regions = ['AS', 'CH', 'JA', 'EU', 'HN', 'US', 'GS'];
const plan = { schemaVersion: 1, expectedStartRegion: 'AS', regions: regions.slice(1), maxNavigations: 6, maxProductRequests: 6, delayMs: 5000, retries: 0 };
const snapshot = (region: string) => ({ region, currentScope: null, cities: [], monthCandidates: [], availableRegions: regions, restricted: false });
test('actual CLI help and invalid commands finish without Chrome connection', () => {
    const tsx = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
    const help = spawnSync(process.execPath, [tsx, script, '--help'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(help.status, 0); assert.match(help.stdout, /--plan/);
    for (const args of [[], ['--run'], ['--run', '--consent-confirmed'], ['--run', '--consent-confirmed', '--plan', 'no-such-plan.json']]) {
        const bad = spawnSync(process.execPath, [tsx, script, ...args], { encoding: 'utf8', timeout: 5000 });
        assert.equal(bad.status, 2); assert.match(bad.stderr, /Refused/);
    }
});

test('plan refuses implicit world scope, duplicates, altered pacing and excess budgets', async () => {
    const loaded = await load();
    assert.equal(typeof loaded.parseDiscoveryPlan, 'function');
    assert.deepEqual(loaded.parseDiscoveryPlan(plan), plan);
    for (const bad of [null, {}, { ...plan, regions: [] }, { ...plan, regions: ['AS'] },
        { ...plan, regions: ['CH', 'CH'] }, { ...plan, regions: ['ch'] }, { ...plan, regions: ['XX'] },
        { ...plan, regions: Array(6) }, { ...plan, regions: ['CH'] }, { ...plan, maxProductRequests: 7 },
        { ...plan, delayMs: 0 }, { ...plan, retries: 1 }, { ...plan, maxNavigations: 7 }, { ...plan, extra: true }])
        assert.throws(() => loaded.parseDiscoveryPlan(bad));
});

test('runner fails closed without retry and preserves completed checkpoints', async () => {
    const { executeRegionDiscovery } = await load();
    for (const scenario of ['initial_access', 'initial_changed', 'missing_region', 'visit_error', 'wrong_region', 'result_access', 'wait_error', 'cleanup_error', 'invalid_plan', 'late_failure'] as const) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-region-fail-'));
        const calls: string[] = []; let closed = 0;
        const adapter = { failure: null as string | null, diagnostics: { actions: 0, documentRequests: 0, permittedDocumentRequests: 0, productRequests: 0, permittedProductRequests: 0, blockedRequests: 0 },
            inspect: async () => ({ ...snapshot(scenario === 'initial_changed' ? 'EU' : 'AS'), restricted: scenario === 'initial_access',
                availableRegions: scenario === 'missing_region' ? ['AS'] : regions }),
            close: async () => { closed++; if (scenario === 'late_failure') adapter.failure = 'off_action_request'; if (scenario === 'cleanup_error') throw new Error('SECRET'); },
            visitRegion: async (region: string) => {
                calls.push(region); adapter.diagnostics.permittedDocumentRequests++;
                if (scenario === 'visit_error' && calls.length === 2) throw new Error('SECRET');
                return { snapshot: { ...snapshot(scenario === 'wrong_region' ? 'AS' : region), restricted: scenario === 'result_access' }, firstPage: null };
            } };
        try {
            const result = await executeRegionDiscovery(adapter, root, scenario === 'invalid_plan' ? { ...plan, retries: 1 } : plan,
                { offlineOnly: true, wait: async () => { if (scenario === 'wait_error') throw new Error('SECRET'); } });
            assert.equal(result.status, 'failed', scenario); assert.equal(closed, 1);
            if (scenario === 'late_failure') { assert.equal(result.failure, 'off_action_request'); assert.equal(result.checkpoints.length, 7); assert.equal(result.cleanupConfirmed, true); }
            assert.ok(!JSON.stringify(result).includes('SECRET'));
            if (['initial_access', 'initial_changed', 'missing_region', 'invalid_plan', 'wait_error'].includes(scenario)) assert.equal(calls.length, 0);
            if (scenario === 'visit_error') { assert.deepEqual(calls, ['CH', 'JA']); assert.equal(result.checkpoints.length, 2); }
            if (scenario === 'wrong_region' || scenario === 'result_access') assert.equal(calls.length, 1);
            assert.equal(result.productionReady, false); assert.equal(fs.existsSync(path.join(root, 'data')), false);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});

test('validated first-page evidence survives later region failure without promoting status', async () => {
    const { executeRegionDiscovery } = await load();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-region-partial-'));
    const evidence = { scope: { departure: 'ICN', city: 'PEK', month: '202609' }, pageNo: 1, totalCount: 1, lastPage: 1, rawProducts: [{ event_code: 'offline_evidence' }] };
    const adapter = { diagnostics: { actions: 1, documentRequests: 1, permittedDocumentRequests: 1, productRequests: 1, permittedProductRequests: 1, blockedRequests: 0 },
        partialEvidence: [evidence], lastRejectedRequest: { mainFrame: false, urlKind: 'other' }, failure: 'final_scope_mismatch', inspect: async () => snapshot('AS'), close: async () => {},
        visitRegion: async () => { throw new Error('PRIVATE_ERROR_NOT_LOGGED'); } };
    try {
        const result = await executeRegionDiscovery(adapter, root, plan, { offlineOnly: true, wait: async () => {} });
        const saved = JSON.parse(fs.readFileSync(path.join(root, '.local-crawler/staging', result.runId, 'summary.json'), 'utf8'));
        assert.equal(result.status, 'failed'); assert.deepEqual(saved.capturedFirstPages, [evidence]);
        assert.equal(saved.failure, 'final_scope_mismatch'); assert.ok(!JSON.stringify(saved).includes('PRIVATE_ERROR'));
        assert.deepEqual(saved.lastRejectedRequest, adapter.lastRejectedRequest);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('explicit start recovery shares the six-action budget and is never retried', async () => {
    const { parseDiscoveryPlan, executeRegionDiscovery } = await load();
    const recoveryPlan = { ...plan, expectedStartRegion: 'CH', regions: ['JA','EU','HN','US','GS'], reloadStart: true };
    assert.deepEqual(parseDiscoveryPlan(recoveryPlan), recoveryPlan);
    for (const bad of [{ ...recoveryPlan, reloadStart: 'true' }, { ...recoveryPlan, reloadStart: false }, { ...recoveryPlan, regions: ['AS', ...recoveryPlan.regions] }, { ...recoveryPlan, maxNavigations: 5 }]) assert.throws(() => parseDiscoveryPlan(bad));
    for (const fails of [false, true]) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-region-recovery-')), calls: string[] = [];
        const adapter = { diagnostics: { actions: 0, documentRequests: 0, permittedDocumentRequests: 0, productRequests: 0, permittedProductRequests: 0, blockedRequests: 0 },
            inspect: async () => { throw Error('must_not_inspect_incomplete_start'); }, close: async () => { calls.push('close'); },
            reloadExistingRegion: async (region: string) => { calls.push('reload:' + region); if (fails) throw Error('failed'); return { snapshot: snapshot(region), firstPage: { pageNo: 1 } }; },
            visitRegion: async (region: string) => { calls.push(region); return { snapshot: snapshot(region), firstPage: null }; } };
        try {
            const result = await executeRegionDiscovery(adapter, root, recoveryPlan, { offlineOnly: true, wait: async () => {} });
            assert.equal(result.status, fails ? 'failed' : 'discovery_ready_for_review');
            assert.deepEqual(calls, fails ? ['reload:CH','close'] : ['reload:CH','JA','EU','HN','US','GS','close']);
            assert.equal(result.regionCount, fails ? 0 : 6);
            if (!fails) { const first = JSON.parse(fs.readFileSync(path.join(root,'.local-crawler/staging',result.checkpoints[0].runId,'summary.json'),'utf8')); assert.deepEqual(first.firstPage, { pageNo: 1 }); }
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});
test('region discovery completes one finite pass with waits, checkpoints and no operational files', async () => {
    const { executeRegionDiscovery } = await load();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-region-cli-'));
    const calls: string[] = [], waits: number[] = [];
    const adapter = { diagnostics: { actions: 0, documentRequests: 0, permittedDocumentRequests: 0, productRequests: 0, permittedProductRequests: 0, blockedRequests: 0 },
        inspect: async () => snapshot('AS'), close: async () => { calls.push('close'); },
        visitRegion: async (region: string) => { calls.push(region); adapter.diagnostics.actions++; adapter.diagnostics.permittedDocumentRequests++;
            return { snapshot: snapshot(region), firstPage: null }; } };
    try {
        const result = await executeRegionDiscovery(adapter, root, plan, { offlineOnly: true, wait: async ms => { waits.push(ms); } });
        assert.equal(result.status, 'discovery_ready_for_review');
        assert.deepEqual(calls, [...regions.slice(1), 'close']); assert.deepEqual(waits, Array(6).fill(5000));
        assert.equal(result.regionCount, 7); assert.equal(result.productionReady, false); assert.equal(result.fullCatalogueComplete, false);
        assert.equal(result.cleanupConfirmed, true); assert.equal(result.checkpoints.length, 7);
        const saved = JSON.parse(fs.readFileSync(path.join(root, '.local-crawler/staging', result.runId, 'summary.json'), 'utf8'));
        assert.equal(saved.status, result.status);
        for (const item of result.checkpoints) assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.local-crawler/staging', item.runId, 'summary.json'), 'utf8')).region, item.region);
        assert.equal(fs.existsSync(path.join(root, 'data')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
