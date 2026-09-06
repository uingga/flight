import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { traverseOnlineTourLists, ListReadError, type ListScope, type ListPage, type TraversalResult } from '../src/lib/onlinetour-list-traversal';
import { createStagingRun } from '../src/lib/onlinetour-browser-collector';
import type { PartialPageEvidence } from '../src/lib/onlinetour-browser-adapter';
export interface ListAdapter {
    readonly partialEvidence?: PartialPageEvidence[];
    authorizeProductRequests(max: number): void;
    inspect(): Promise<{ restricted: boolean }>;
    readPage(scope: ListScope, pageNo: number, attempt: number): Promise<ListPage>;
    close(): Promise<void>;
    diagnostics: { actions: number; productRequests: number; documentRequests: number;
        permittedProductRequests?: number; blockedProductRequests?: number };
}
export async function executeBrowserLists(adapter: ListAdapter, repositoryRoot: string, scopes: ListScope[],
    options: { maxRequests: number; maxPages: number; evidenceMode: 'live_browser' | 'offline_adapter_fixture' }) {
    let run: ReturnType<typeof createStagingRun> | undefined;
    let result: TraversalResult | undefined;
    const reads: { scope: ListScope; pageNo: number; attempt: number; page?: ListPage }[] = [];
    let cleanupConfirmed = false;
    let failure: string | null = null;
    const startedAt = new Date().toISOString();
    try {
        const cleanScopes = parseBrowserPlan({ schemaVersion: 1, scopes });
        if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1 || options.maxRequests > 100
            || !Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 20
            || !['live_browser', 'offline_adapter_fixture'].includes(options.evidenceMode)) throw new Error('invalid_budget');
        run = createStagingRun(repositoryRoot);
        const snapshot = await adapter.inspect();
        if (snapshot.restricted) throw new ListReadError('access', 'restricted_before_action');
        adapter.authorizeProductRequests(options.maxRequests);
        result = await traverseOnlineTourLists(cleanScopes, async (scope, pageNo, attempt) => {
            const read: typeof reads[number] = { scope, pageNo, attempt };
            reads.push(read);
            read.page = await adapter.readPage(scope, pageNo, attempt);
            return read.page;
        },
            // Traversal counts attempts, including document failures with no product query.
            // Allow one retry per page; the adapter still enforces the original product cap
            // both before any UI action and atomically before each network transmission.
            { maxRequests: options.maxRequests * 2, maxPagesPerScope: options.maxPages,
                ...(options.evidenceMode === 'offline_adapter_fixture' ? { wait: async () => {} } : {}) });
    } catch (error) {
        failure = error instanceof ListReadError && error.kind === 'access' ? 'access_restriction' : 'browser_preflight_or_runner_failed';
    } finally {
        try { await adapter.close(); cleanupConfirmed = true; }
        catch { failure = failure || 'adapter_cleanup_failed'; }
    }
    if (!run) throw new Error('browser_plan_or_staging_failed');
    const { rawProducts: completedRaw = [], flights: completedFlights = [], ...metadata } = result || {};
    const rawProducts: TraversalResult['rawProducts'] = [], flights: TraversalResult['flights'] = [];
    const partial = adapter.partialEvidence || [];
    const completedPageCounts = { pageCount: result?.scopes.reduce((n, s) => n + s.pagesRead, 0) ?? 0,
        rawCount: result?.rawCount ?? 0, uniqueCount: result?.uniqueCount ?? 0 };
    // Attribution counters stay relative to completed pages, independently of which pair wins.
    const ids = new Set(completedFlights.map(f => f.id));
    const candidates = completedFlights.map((flight, index) => ({ flight, raw: completedRaw[index],
        // Match the whole validated row, not an earlier malformed occurrence of the same ID.
        order: reads.findIndex(read => read.page?.rawProducts.some(raw => isDeepStrictEqual(raw, completedRaw[index]))) }));
    let incompleteRawCount = 0, incompleteUniqueAddedCount = 0, incompleteDuplicateCount = 0;
    const incompletePages = partial.map(page => {
        incompleteRawCount += page.rawProducts.length;
        const order = reads.findIndex(read => read.pageNo === page.pageNo && read.attempt === page.attempt
            && read.scope.departure === page.scope.departure && read.scope.city === page.scope.city && read.scope.month === page.scope.month);
        page.flights.forEach((flight, index) => {
            candidates.push({ flight, raw: page.rawProducts[index], order });
            if (ids.has(flight.id)) { incompleteDuplicateCount++; return; }
            ids.add(flight.id); incompleteUniqueAddedCount++;
        });
        return { scope: page.scope, pageNo: page.pageNo, attempt: page.attempt,
            validatedRowCount: page.rawProducts.length, productIds: page.flights.map(f => f.id) };
    });
    ids.clear();
    candidates.sort((a, b) => a.order - b.order).forEach(({ raw, flight }) => {
        if (ids.has(flight.id)) return;
        ids.add(flight.id);
        // Keep the first validated row/flight pair intact, never combine duplicate fields.
        rawProducts.push(raw); flights.push(flight);
    });
    const status = failure || partial.length ? 'failed' : result?.status || 'failed';
    const numeric = (n: number | undefined) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
    const summary = { ...metadata, runId: run.runId, status, failure, cleanupConfirmed,
        productionReady: false, snapshotComplete: false, offlineOnly: options.evidenceMode === 'offline_adapter_fixture',
        evidenceMode: options.evidenceMode, scopeCount: scopes.length,
        completedPageCounts, incompletePages, incompletePageCount: incompletePages.length,
        incompleteRawCount, incompleteUniqueAddedCount, incompleteDuplicateCount,
        rawCount: completedPageCounts.rawCount + incompleteRawCount, uniqueCount: flights.length,
        duplicateCount: (result?.duplicateCount ?? 0) + incompleteDuplicateCount,
        browserActions: numeric(adapter.diagnostics.actions), productRequests: numeric(adapter.diagnostics.productRequests),
        permittedProductRequests: numeric(adapter.diagnostics.permittedProductRequests),
        blockedProductRequests: numeric(adapter.diagnostics.blockedProductRequests),
        documentRequests: numeric(adapter.diagnostics.documentRequests), startedAt, finishedAt: new Date().toISOString() };
    run.write('raw-products.json', rawProducts);
    run.write('flights.json', flights);
    run.write('summary.json', summary);
    return summary;
}
export function parseBrowserPlan(value: unknown): ListScope[] {
    const v = value as { schemaVersion?: unknown; scopes?: unknown } | null;
    if (!v || v.schemaVersion !== 1 || !Array.isArray(v.scopes) || v.scopes.length < 1 || v.scopes.length > 100)
        throw new Error('invalid_browser_plan');
    return Array.from(v.scopes).map(s => {
        if (!s || typeof s !== 'object' || Array.isArray(s)
            || Object.keys(s).sort().join(',') !== 'city,departure,month'
            || typeof s.departure !== 'string' || !/^[A-Z]{3}$/.test(s.departure)
            || typeof s.city !== 'string' || !/^[A-Z]{3}$/.test(s.city)
            || typeof s.month !== 'string' || !/^[1-9]\d{3}(?:0[1-9]|1[0-2])$/.test(s.month)) throw new Error('invalid_browser_scope');
        return { departure: s.departure, city: s.city, month: s.month };
    });
}
export type BrowserArgs = { mode: 'help' | 'inspect' } | { mode: 'run'; scopesFile: string; maxRequests: number; maxPages: number };
export function parseBrowserArgs(args: string[]): BrowserArgs {
    if (args.length === 1 && args[0] === '--help') return { mode: 'help' };
    if (args.length === 2 && args.includes('--inspect') && args.includes('--consent-confirmed')) return { mode: 'inspect' };
    if (args.length !== 8 || !args.includes('--run') || !args.includes('--consent-confirmed')) throw new Error('invalid_browser_args');
    const values = new Map<string, string>();
    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        if (key === '--run' || key === '--consent-confirmed') continue;
        if (!['--scopes', '--max-requests', '--max-pages'].includes(key) || values.has(key)
            || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('invalid_browser_args');
        values.set(key, args[++i]);
    }
    const scopesFile = values.get('--scopes');
    const requests = values.get('--max-requests') || '';
    const pages = values.get('--max-pages') || '';
    if (!scopesFile || !/^[1-9]\d*$/.test(requests) || !/^[1-9]\d*$/.test(pages)
        || Number(requests) > 100 || Number(pages) > 20) throw new Error('invalid_browser_budget');
    return { mode: 'run', scopesFile, maxRequests: Number(requests), maxPages: Number(pages) };
}

async function main(): Promise<void> {
    let args: BrowserArgs;
    try { args = parseBrowserArgs(process.argv.slice(2)); }
    catch { console.error('Refused: explicit consent, scope file and request budget required. Use --help.'); process.exitCode = 2; return; }
    if (args.mode === 'help') {
        console.log('Normal signed-in Chrome, OnlineTour existing tab only. Staging only.\n'
            + '--inspect --consent-confirmed : read current controls, NO page navigation/reload/product requests\n'
            + '--run --consent-confirmed --scopes <plan.json> --max-requests <1..100> --max-pages <1..20>\n'
            + 'Run requires separately approved finite scope and budget. No launch, endpoint override, direct API fetch, or operational merge.');
        return;
    }
    let scopes: ListScope[] = [];
    if (args.mode === 'run') {
        const file = path.resolve(args.scopesFile); const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100000) throw new Error('invalid_plan_file');
        scopes = parseBrowserPlan(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    const { connectNormalChrome, createOnlineTourBrowserAdapter } = await import('../src/lib/onlinetour-browser-adapter');
    const client = await connectNormalChrome();
    let adapter: Awaited<ReturnType<typeof createOnlineTourBrowserAdapter>>;
    try { adapter = await createOnlineTourBrowserAdapter(client); }
    catch (error) { await client.close().catch(() => {}); throw error; }
    if (args.mode === 'inspect') {
        let snapshot;
        try { snapshot = await adapter.inspect(); }
        finally { await adapter.close(); }
        console.log(JSON.stringify({ mode: 'inspect', readOnly: true, productionReady: false, snapshot,
            diagnostics: adapter.diagnostics }));
        process.exitCode = snapshot.restricted ? 1 : 0;
        return;
    }
    if (args.mode !== 'run') throw new Error('invalid_mode');
    const summary = await executeBrowserLists(adapter, path.resolve(__dirname, '..'), scopes,
        { maxRequests: args.maxRequests, maxPages: args.maxPages, evidenceMode: 'live_browser' });
    console.log(JSON.stringify({ runId: summary.runId, status: summary.status, rawCount: summary.rawCount,
        uniqueCount: summary.uniqueCount, browserActions: summary.browserActions, observedProductRequests: summary.productRequests,
        permittedProductRequests: summary.permittedProductRequests, blockedProductRequests: summary.blockedProductRequests,
        cleanupConfirmed: summary.cleanupConfirmed, productionReady: false }));
    process.exitCode = summary.status === 'failed' ? 1 : 0;
}
if (require.main === module) void main().catch(() => {
    console.error('Browser list operation failed safely; no automatic restart or operational merge.');
    process.exitCode = 1;
});
