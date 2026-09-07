// Read-only diagnosis of the existing browser. Never authorizes collection.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// Anchor tsconfig aliases to this validation copy, not an SSH login directory.
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(import.meta.url);
require('tsx/cjs');
const { connectNormalChrome, createOnlineTourBrowserAdapter } = require('../src/lib/onlinetour-browser-adapter.ts');
const { ListReadError } = require('../src/lib/onlinetour-list-traversal.ts');
const knownReasons = new Set([
    'normal_chrome_discovery_failed', 'cdp_connect_deadline', 'cdp_connect_failed',
    'cdp_disconnected', 'cdp_command_deadline', 'cdp_command_failed', 'cdp_send_failed',
    'require_exactly_one_existing_list_tab', 'require_existing_google_home_tab',
    'attachment_failed', 'target_left_list', 'dom_inspection_failed',
    'unsafe_current_scope', 'list_not_idle', 'adapter_closed',
]);
let stage = 'connection', client, adapter;
const started = Date.now();
const emit = (event, data = {}) => console.log(JSON.stringify({ event, stage, elapsedMs: Date.now() - started, ...data }));
const matches = (raw, wanted) => {
    try { const u = new URL(raw); return !u.username && !u.password && u.origin + u.pathname === wanted; }
    catch { return false; }
};

if (process.argv.length !== 3 || process.argv[2] !== '--consent-confirmed') {
    console.error('Explicit consent required. Reads an existing tab only; never collects or merges.');
    process.exitCode = 2;
} else {
    try {
        emit('waiting_for_chrome_permission', { waitSeconds: 180, readOnly: true });
        client = await connectNormalChrome();
        emit('chrome_transport_connected');
        stage = 'existing_tab_metadata';
        const targets = (await client.send('Target.getTargets')).targetInfos || [];
        // Do not expose unrelated tab URLs, titles, identities or endpoint tokens.
        emit('required_tab_counts', {
            onlineTourListTabs: targets.filter(t => t.type === 'page' && matches(t.url,
                'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList')).length,
            googleHomeTabs: targets.filter(t => t.type === 'page' && matches(t.url, 'https://myaccount.google.com/')).length,
        });
        stage = 'tab_preflight_and_attach';
        adapter = await createOnlineTourBrowserAdapter(client);
        emit('adapter_ready');
        stage = 'read_current_controls';
        const snapshot = await adapter.inspect();
        emit('inspection_completed', {
            region: snapshot.region, currentScope: snapshot.currentScope,
            nextPageNo: snapshot.nextPageNo, nextPageAvailable: snapshot.nextPageAvailable,
            restricted: snapshot.restricted, diagnostics: adapter.diagnostics,
        });
        process.exitCode = snapshot.restricted ? 1 : 0;
    } catch (error) {
        emit('inspection_failed', {
            failureKind: error instanceof ListReadError ? error.kind : 'unknown',
            reason: error instanceof ListReadError && knownReasons.has(error.message)
                ? error.message : 'unclassified_safe_failure',
        });
        process.exitCode = 1;
    } finally {
        stage = 'cleanup';
        try {
            if (adapter) await adapter.close();
            else if (client) await client.close();
            emit('connection_closed', {
                adapterFailure: adapter?.failureKind || null,
                diagnostics: adapter?.diagnostics || null, productionReady: false,
            });
            if (adapter?.failureKind) process.exitCode = 1;
        } catch { emit('cleanup_failed', { productionReady: false }); process.exitCode = 1; }
    }
}
