import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const script = path.resolve(__dirname, 'crawl-onlinetour-browser-lists.ts');
const tsx = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
async function load() { assert.ok(fs.existsSync(script), 'browser traversal CLI must exist'); return import('./crawl-onlinetour-browser-lists'); }
const scope = { departure: 'ICN', city: 'PQC', month: '202609' };

test('zero-query document failure leaves product budget for automatic page two', async () => {
    const { executeBrowserLists } = await load();
    const { createOnlineTourBrowserAdapter } = await import('../src/lib/onlinetour-browser-adapter');
    const { FakeCdp, respond, validRow, rowBody } = await import('./test-onlinetour-browser-adapter');
    for (const cap of [2, 1]) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-zero-query-'));
        const client = new FakeCdp(); const adapter = await createOnlineTourBrowserAdapter(client);
        let actions = 0;
        client.onAction = () => {
            actions++;
            if (actions === 1) {
                client.emit('Network.requestWillBeSent', { requestId: 'document', frameId: 'main', type: 'Document',
                    request: { method: 'GET', url: client.url } });
                client.emit('Network.loadingFailed', { requestId: 'document' });
            } else {
                const page = actions - 1;
                respond(client, page, { document: page === 1, next: page === 1,
                    text: rowBody(page, [validRow(`page-${page}`)]) });
            }
        };
        try {
            const summary = await executeBrowserLists(adapter, root, [scope],
                { maxRequests: cap, maxPages: 2, evidenceMode: 'offline_adapter_fixture' });
            assert.equal(summary.status, cap === 2 ? 'review_ready' : 'failed');
            assert.equal(summary.permittedProductRequests, cap);
            assert.equal(actions, cap + 1);
            assert.equal(summary.retryCount, 1);
            assert.equal(summary.uniqueCount, cap);
            assert.equal(summary.scopes?.[0].terminalVerified, cap === 2);
            assert.equal(client.more.clicked, cap === 2 ? 1 : 0);
            assert.equal(summary.cleanupConfirmed, true);
            const saved = JSON.parse(fs.readFileSync(path.join(root, '.local-crawler/staging', summary.runId, 'summary.json'), 'utf8'));
            assert.equal(saved.status, summary.status);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});

test('L4 runner wires actual two-query authorization including retry', async () => {
    const { executeBrowserLists } = await load();
    const { createOnlineTourBrowserAdapter } = await import('../src/lib/onlinetour-browser-adapter');
    const { FakeCdp, respond, validRow, rowBody } = await import('./test-onlinetour-browser-adapter');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-budget-'));
    const client = new FakeCdp(); const adapter = await createOnlineTourBrowserAdapter(client);
    let actions = 0;
    client.onAction = () => {
        if (++actions === 1) {
            respond(client, 1, { document: true, status: 500 });
            client.page.value = '2'; // Site retained the initial pagination; retry is legal.
        } else respond(client, 1, { document: true, next: false,
            text: rowBody(1, [validRow('retry-1'), validRow('retry-2')]).replace('"totalLastPage":2', '"totalLastPage":1') });
    };
    try {
        const summary = await executeBrowserLists(adapter, root, [scope], { maxRequests: 2, maxPages: 1, evidenceMode: 'offline_adapter_fixture' });
        assert.equal(summary.status, 'review_ready'); assert.equal(actions, 2);
        assert.equal(summary.requestCount, 2); assert.equal(summary.retryCount, 1);
        assert.equal(summary.productRequests, 2); assert.equal((summary as any).permittedProductRequests, 2);
        assert.equal((summary as any).blockedProductRequests, 0);
        assert.equal(client.emittedRequests.filter(r => r.type === 'Script').length, 2);
        assert.equal(client.calls.filter(c => c.method === 'Fetch.enable').length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L2 failed later document stages earlier pages plus validated current evidence, ID-first without field mixing', async () => {
    const { executeBrowserLists } = await load();
    const { createOnlineTourBrowserAdapter } = await import('../src/lib/onlinetour-browser-adapter');
    const { FakeCdp, respond, validRow, rowBody } = await import('./test-onlinetour-browser-adapter');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-partial-'));
    const client = new FakeCdp(); const adapter = await createOnlineTourBrowserAdapter(client);
    let actions = 0;
    client.onAction = () => {
        if (++actions === 1) respond(client, 1, { document: true, next: false,
            text: rowBody(1, [validRow('earlier'), validRow('duplicate')]).replace('"totalLastPage":2', '"totalLastPage":1') });
        else {
            const source = vm.runInContext('getDcairMainList.toString()', client.context).replace("nowMonth = '09'", "nowMonth = '10'");
            vm.runInContext(`getDcairMainList = (${source})`, client.context);
            respond(client, 1, { document: true, requested: { ...scope, month: '202610' },
                text: rowBody(1, [validRow('current'), { ...validRow('duplicate'), adult_price: '123000' }, { event_code: 'invalid' }]) });
            client.bodies.set('document', '<html>access denied</html>');
        }
    };
    try {
        const result = await executeBrowserLists(adapter, root, [scope, { ...scope, month: '202610' }],
            { maxRequests: 2, maxPages: 2, evidenceMode: 'offline_adapter_fixture' });
        const stage = path.join(root, '.local-crawler/staging', result.runId);
        const raw = JSON.parse(fs.readFileSync(path.join(stage, 'raw-products.json'), 'utf8'));
        const flights = JSON.parse(fs.readFileSync(path.join(stage, 'flights.json'), 'utf8'));
        const summary = JSON.parse(fs.readFileSync(path.join(stage, 'summary.json'), 'utf8'));
        assert.deepEqual(raw.map((r: any) => r.event_code), ['earlier', 'duplicate', 'current']);
        assert.equal(raw[1].adult_price, '469000'); assert.equal(flights[1].price, 469000);
        assert.deepEqual(flights.map((f: any) => f.id), ['online-earlier', 'online-duplicate', 'online-current']);
        assert.equal(summary.status, 'failed'); assert.equal(summary.productionReady, false);
        assert.deepEqual(summary.completedPageCounts, { pageCount: 1, rawCount: 2, uniqueCount: 2 });
        assert.equal(summary.incompletePageCount, 1); assert.equal(summary.incompleteRawCount, 2);
        assert.equal(summary.incompleteUniqueAddedCount, 1); assert.equal(summary.incompleteDuplicateCount, 1);
        assert.equal(summary.incompletePages[0].pageNo, 1); assert.equal(summary.incompletePages[0].scope.month, '202610');
        assert.equal(summary.rawCount, 4); assert.equal(summary.uniqueCount, 3);
        assert.equal(summary.evidenceMode, 'offline_adapter_fixture');
        assert.equal(fs.existsSync(path.join(root, 'data')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('L2-R1 earlier validated partial row wins a changed successful retry', async () => {
    const { executeBrowserLists } = await load();
    const { createOnlineTourBrowserAdapter } = await import('../src/lib/onlinetour-browser-adapter');
    const { FakeCdp, respond, validRow, rowBody } = await import('./test-onlinetour-browser-adapter');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-partial-first-'));
    const client = new FakeCdp(); const adapter = await createOnlineTourBrowserAdapter(client);
    let actions = 0;
    client.onAction = () => {
        actions++;
        respond(client, 1, { document: actions === 2, next: actions === 1,
            text: rowBody(1, [{ ...validRow('same-id'), adult_price: actions === 1 ? '469000' : '123000' }])
                .replace('"totalLastPage":2', '"totalLastPage":1').replace('"totalCount":2', '"totalCount":1') });
    };
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: any, ms?: number, ...args: any[]) => original(fn, ms === 90_000 ? 30 : ms, ...args)) as typeof setTimeout;
    try {
        const summary = await executeBrowserLists(adapter, root, [scope],
            { maxRequests: 2, maxPages: 1, evidenceMode: 'offline_adapter_fixture' });
        const stage = path.join(root, '.local-crawler/staging', summary.runId);
        const raw = JSON.parse(fs.readFileSync(path.join(stage, 'raw-products.json'), 'utf8'));
        const flights = JSON.parse(fs.readFileSync(path.join(stage, 'flights.json'), 'utf8'));
        assert.equal(actions, 2); assert.equal(summary.permittedProductRequests, 2);
        assert.equal(summary.requestCount, 2); assert.equal(summary.retryCount, 1);
        assert.equal(adapter.partialEvidence[0].rawProducts[0].adult_price, '469000');
        assert.deepEqual([raw[0].adult_price, flights[0].price], ['469000', 469000]);
        assert.deepEqual(raw, adapter.partialEvidence[0].rawProducts);
        assert.deepEqual(flights, adapter.partialEvidence[0].flights);
        assert.equal(summary.status, 'failed'); assert.equal(summary.productionReady, false);
        assert.deepEqual(summary.completedPageCounts, { pageCount: 1, rawCount: 1, uniqueCount: 1 });
        assert.equal(summary.incompletePageCount, 1); assert.equal(summary.incompleteRawCount, 1);
        assert.equal(summary.incompleteUniqueAddedCount, 0); assert.equal(summary.incompleteDuplicateCount, 1);
        assert.equal(summary.rawCount, 2); assert.equal(summary.uniqueCount, 1); assert.equal(summary.duplicateCount, 1);
        assert.equal(summary.cleanupConfirmed, true); assert.equal(fs.existsSync(path.join(root, 'data')), false);
    } finally { globalThis.setTimeout = original; fs.rmSync(root, { recursive: true, force: true }); }
});

test('L2-R1 earlier completed row wins a later partial duplicate, not partial-first', async () => {
    const { executeBrowserLists } = await load();
    const { createOnlineTourBrowserAdapter } = await import('../src/lib/onlinetour-browser-adapter');
    const { FakeCdp, respond, validRow, rowBody } = await import('./test-onlinetour-browser-adapter');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-completed-first-'));
    const client = new FakeCdp(); const adapter = await createOnlineTourBrowserAdapter(client);
    let actions = 0;
    const first = validRow('same-id');
    client.onAction = () => {
        if (++actions === 1) respond(client, 1, { document: true, next: false,
            text: rowBody(1, [first]).replace('"totalLastPage":2', '"totalLastPage":1').replace('"totalCount":2', '"totalCount":1') });
        else {
            const source = vm.runInContext('getDcairMainList.toString()', client.context).replace("nowMonth = '09'", "nowMonth = '10'");
            vm.runInContext(`getDcairMainList = (${source})`, client.context);
            respond(client, 1, { document: true, requested: { ...scope, month: '202610' },
                text: rowBody(1, [{ ...first, adult_price: '123000' }]) });
            client.bodies.set('document', '<html>access denied</html>');
        }
    };
    try {
        const summary = await executeBrowserLists(adapter, root, [scope, { ...scope, month: '202610' }],
            { maxRequests: 2, maxPages: 1, evidenceMode: 'offline_adapter_fixture' });
        const stage = path.join(root, '.local-crawler/staging', summary.runId);
        const raw = JSON.parse(fs.readFileSync(path.join(stage, 'raw-products.json'), 'utf8'));
        const flights = JSON.parse(fs.readFileSync(path.join(stage, 'flights.json'), 'utf8'));
        assert.equal(actions, 2); assert.equal(summary.permittedProductRequests, 2);
        assert.equal(adapter.partialEvidence[0].rawProducts[0].adult_price, '123000');
        assert.deepEqual(raw, [first]); assert.equal(flights.length, 1);
        assert.deepEqual([raw[0].adult_price, flights[0].price], ['469000', 469000]);
        assert.equal(summary.status, 'failed'); assert.equal(summary.productionReady, false);
        assert.deepEqual(summary.completedPageCounts, { pageCount: 1, rawCount: 1, uniqueCount: 1 });
        assert.equal(summary.incompletePageCount, 1); assert.equal(summary.incompleteRawCount, 1);
        assert.equal(summary.incompleteUniqueAddedCount, 0); assert.equal(summary.incompleteDuplicateCount, 1);
        assert.equal(summary.rawCount, 2); assert.equal(summary.uniqueCount, 1); assert.equal(summary.duplicateCount, 1);
        assert.equal(summary.cleanupConfirmed, true); assert.equal(fs.existsSync(path.join(root, 'data')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('real CLI help and malformed commands exit without connecting to Chrome', () => {
    assert.ok(fs.existsSync(script));
    const help = spawnSync(process.execPath, [tsx, script, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0); assert.match(help.stdout, /--inspect/); assert.match(help.stdout, /--max-requests/);
    const bad = spawnSync(process.execPath, [tsx, script, '--run'], { encoding: 'utf8' });
    assert.equal(bad.status, 2); assert.match(bad.stderr, /consent/);
});

test('browser CLI defaults to no action and requires explicit consent plus request budget for run', async () => {
    const { parseBrowserArgs } = await load();
    assert.equal(parseBrowserArgs(['--help']).mode, 'help');
    assert.equal(parseBrowserArgs(['--inspect', '--consent-confirmed']).mode, 'inspect');
    assert.deepEqual(parseBrowserArgs(['--run', '--consent-confirmed', '--scopes', 'plan.json', '--max-requests', '3', '--max-pages', '2']),
        { mode: 'run', scopesFile: 'plan.json', maxRequests: 3, maxPages: 2 });
    for (const args of [[], ['--run'], ['--inspect'], ['--run','--consent-confirmed'], ['--inspect','--consent-confirmed','--endpoint','evil'],
        ['--run','--consent-confirmed','--scopes','p.json','--max-requests','0','--max-pages','1'],
        ['--run','--consent-confirmed','--scopes','p.json','--max-requests','01','--max-pages','1'],
        ['--run','--consent-confirmed','--scopes','p.json','--max-requests','101','--max-pages','1']]) assert.throws(() => parseBrowserArgs(args));
});

test('browser scope plan rejects presentation flags, malformed identity and implicit all-world scope', async () => {
    const loaded = await load();
    assert.equal(typeof loaded.parseBrowserPlan, 'function');
    assert.deepEqual(loaded.parseBrowserPlan({ schemaVersion: 1, scopes: [scope] }), [scope]);
    for (const scopes of [[], [{ ...scope, month: '202613' }], [{ ...scope, city: 'pqc' }], [{ ...scope, sort: 'HP' }], [{ ...scope, filter: 'seats' }], [{ ...scope, city: '*' }]])
        assert.throws(() => loaded.parseBrowserPlan({ schemaVersion: 1, scopes }));
});

test('browser execution connects the real traversal interface to exclusive staging and closes the adapter', async () => {
    const loaded = await load();
    assert.equal(typeof loaded.executeBrowserLists, 'function');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-browser-lists-'));
    let reads = 0, closed = 0;
    const adapter = { authorizeProductRequests: (max: number) => { assert.equal(max, 1); }, inspect: async () => ({ restricted: false }), diagnostics: { actions: 0, productRequests: 0, documentRequests: 0 },
        readPage: async (s: any, p: number, a: number) => { assert.deepEqual(s, scope); assert.equal(p, 1); assert.equal(a, 1); reads++;
            return { pageNo: 1, totalCount: 0, lastPage: 1, rawProducts: [], nextPageAvailable: false }; },
        close: async () => { closed++; } };
    try {
        const summary = await loaded.executeBrowserLists(adapter, root, [scope], { maxRequests: 1, maxPages: 1, evidenceMode: 'offline_adapter_fixture' });
        assert.equal(summary.status, 'review_ready'); assert.equal(summary.offlineOnly, true);
        assert.equal(summary.productionReady, false); assert.equal(summary.cleanupConfirmed, true);
        assert.equal(reads, 1); assert.equal(closed, 1);
        const saved = JSON.parse(fs.readFileSync(path.join(root, '.local-crawler/staging', summary.runId, 'summary.json'), 'utf8'));
        assert.equal(saved.runId, summary.runId); assert.equal(saved.scopeCount, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const scenario of ['restriction', 'cleanup_failure', 'read_failure'] as const) {
    test(`browser runner ${scenario} stays failed, closes and writes no operational files`, async () => {
        const { executeBrowserLists } = await load();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-browser-failure-'));
        let reads = 0, closes = 0;
        const adapter = { authorizeProductRequests: (max: number) => { assert.equal(max, 1); }, inspect: async () => ({ restricted: scenario === 'restriction' }),
            diagnostics: { actions: 0, productRequests: 0, documentRequests: 0 },
            readPage: async () => { reads++; if (scenario === 'read_failure') throw new Error('SECRET_DYNAMIC_ERROR');
                return { pageNo: 1, totalCount: 0, lastPage: 1, rawProducts: [], nextPageAvailable: false }; },
            close: async () => { closes++; if (scenario === 'cleanup_failure') throw new Error('SECRET_CLEANUP'); } };
        try {
            const result = await executeBrowserLists(adapter, root, [scope], { maxRequests: 1, maxPages: 1, evidenceMode: 'offline_adapter_fixture' });
            assert.equal(result.status, 'failed'); assert.equal(result.productionReady, false);
            assert.equal(closes, 1); assert.equal(reads, scenario === 'restriction' ? 0 : 1);
            assert.ok(!JSON.stringify(result).includes('SECRET'));
            assert.equal(fs.existsSync(path.join(root, 'data')), false);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
}
