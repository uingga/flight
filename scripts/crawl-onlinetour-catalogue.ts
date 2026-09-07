import fs from 'node:fs';
import path from 'node:path';
import { collectOnlineTourCatalogue, parseCataloguePlan, type CatalogueBackend, type CataloguePlan } from '../src/lib/onlinetour-catalogue';
import { createStagingRun } from '../src/lib/onlinetour-browser-collector';

export async function executeCatalogue(root: string, plan: CataloguePlan, backend: CatalogueBackend, offlineOnly: boolean) {
    const parsed = parseCataloguePlan(plan); // Validate before creating files or connecting.
    const run = createStagingRun(root), checkpoints: string[] = [];
    const startedAt = new Date().toISOString();
    const result = await collectOnlineTourCatalogue(parsed, backend, async traversal => {
        const child = createStagingRun(root);
        const { rawProducts, flights, ...metadata } = traversal;
        child.write('raw-products.json', rawProducts); child.write('flights.json', flights);
        child.write('summary.json', { ...metadata, offlineOnly, parentRunId: run.runId });
        checkpoints.push(child.runId);
    });
    const { rawProducts, flights, traversals, ...metadata } = result;
    const summary = { ...metadata, runId: run.runId, offlineOnly, checkpoints,
        scopeResults: traversals.map(({ rawProducts: _raw, flights: _flights, ...m }) => m),
        uniqueCount: flights.length, startedAt, finishedAt: new Date().toISOString() };
    run.write('raw-products.json', rawProducts); run.write('flights.json', flights); run.write('summary.json', summary);
    return summary;
}

/** Connections never overlap; each transfer closes its old adapter before the next opens. */
export async function createLiveCatalogueBackend(): Promise<CatalogueBackend> {
    const { connectNormalChrome, createOnlineTourBrowserAdapter } = await import('../src/lib/onlinetour-browser-adapter');
    const { createOnlineTourRegionDiscovery } = await import('../src/lib/onlinetour-region-discovery');
    return {
        wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
        async openRegion(navigations, products) {
            return createOnlineTourRegionDiscovery(await connectNormalChrome(), { maxNavigations: navigations, maxProductRequests: products });
        },
        async openLists(products, seed) {
            const a = await createOnlineTourBrowserAdapter(await connectNormalChrome(), { seed });
            try { a.authorizeProductRequests(products); return a; }
            catch (error) { await a.close().catch(() => {}); throw error; }
        },
    };
}

export function checkValidationCooldown(cache: unknown, last: unknown, now = Date.now()): void {
    const c = cache as { sourceCircuits?: { onlinetour?: { localFallback?: { nextProbeAt?: string } } } } | null;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('source_state_required');
    const previous = last as { nextProbeAt?: string } | null;
    for (const value of [c.sourceCircuits?.onlinetour?.localFallback?.nextProbeAt, previous?.nextProbeAt]) {
        if (value === undefined || value === null) continue;
        const time = Date.parse(value);
        if (!Number.isFinite(time) || time > now) throw new Error('local_source_cooldown');
    }
}
export function parseCatalogueArgs(args: string[]) {
    if (args.length === 1 && args[0] === '--help') return { mode: 'help' as const };
    if (args.length === 3 && args[0] === '--check-plan' && args[1] === '--plan')
        return { mode: 'check' as const, file: args[2] };
    if (args.length === 4 && args[0] === '--run' && args[1] === '--consent-confirmed' && args[2] === '--plan')
        return { mode: 'run' as const, file: args[3] };
    throw new Error('explicit_finite_plan_required');
}
async function main() {
    const args = parseCatalogueArgs(process.argv.slice(2));
    if (args.mode === 'help') {
        console.log('Staging only. No scheduled/operational mode.\n--check-plan --plan <local.json> (offline)\n'
            + '--run --consent-confirmed --plan <approved-local.json>\n'
            + 'Existing normal Chrome consent, current local PC cooldown state, explicit regions/month/request budget required.');
        return;
    }
    const stat = fs.lstatSync(args.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10000) throw new Error('invalid_plan_file');
    const plan = parseCataloguePlan(JSON.parse(fs.readFileSync(args.file, 'utf8')));
    if (args.mode === 'check') { console.log(JSON.stringify({ plan, siteRequests: 0, productionReady: false })); return; }
    const root = path.resolve(__dirname, '..');
    // Read existing state, never modify the production cache or close its circuit.
    const cache = JSON.parse(fs.readFileSync(path.join(root, 'data', 'all-flights-cache.json'), 'utf8'));
    const local = path.join(root, '.local-crawler');
    const cooldown = path.join(local, 'onlinetour-validation-cooldown.json');
    const previous = fs.existsSync(cooldown) ? JSON.parse(fs.readFileSync(cooldown, 'utf8')) : null;
    checkValidationCooldown(cache, previous);
    // Host-wide validation lock also covers independent checkout copies on this PC.
    const stateRoot = path.join(process.env.LOCALAPPDATA || local, 'Tikitikit', 'onlinetour-validation');
    fs.mkdirSync(stateRoot, { recursive: true });
    if (fs.lstatSync(stateRoot).isSymbolicLink()) throw new Error('unsafe_state_directory');
    const sharedCooldown = path.join(stateRoot, 'cooldown.json');
    checkValidationCooldown(cache, fs.existsSync(sharedCooldown) ? JSON.parse(fs.readFileSync(sharedCooldown, 'utf8')) : null);
    const lock = path.join(stateRoot, 'run.lock');
    const fd = fs.openSync(lock, 'wx'); // Never remove someone else's stale/running lock automatically.
    try {
        // Close the time-of-check race with a previously finishing validation process.
        checkValidationCooldown(cache, fs.existsSync(sharedCooldown) ? JSON.parse(fs.readFileSync(sharedCooldown, 'utf8')) : null);
        const result = await executeCatalogue(root, plan, await createLiveCatalogueBackend(), false);
        if (result.failure === 'access_restriction' || ['http_access_status','access_body','restricted_dom'].includes(result.failure || '')
            || result.failure === 'empty_catalogue' && result.productRequests + result.regionalNavigations > 0) {
            fs.writeFileSync(sharedCooldown, JSON.stringify({ nextProbeAt: new Date(Date.now() + 86400000).toISOString(), reason: 'access_restriction' }));
        }
        console.log(JSON.stringify({ runId: result.runId, status: result.status, failure: result.failure,
            productRequests: result.productRequests, regionalNavigations: result.regionalNavigations,
            uniqueCount: result.uniqueCount, plannedCoverageCompleted: result.plannedCoverageCompleted, productionReady: false }));
        process.exitCode = result.status === 'failed' ? 1 : 0;
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (require.main === module) void main().catch(error => {
    const reason = /^[a-z_]{1,80}$/.test(error?.message || '') ? error.message : 'catalogue_preflight_failed';
    console.error(JSON.stringify({ status: 'failed', reason, productionReady: false })); process.exitCode = 1;
});
