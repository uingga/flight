import fs from 'node:fs';
import path from 'node:path';
import { createStagingRun } from '../src/lib/onlinetour-browser-collector';
export interface DiscoverySnapshot {
    region: string; currentScope: unknown; cities: { code: string; firstDepartureDate: string }[];
    monthCandidates: unknown[]; availableRegions: string[]; restricted: boolean;
}
export interface DiscoveryAdapter {
    readonly partialEvidence?: unknown[];
    readonly lastRejectedRequest?: Record<string, string | boolean> | null;
    readonly failure?: string | null;
    inspect(): Promise<DiscoverySnapshot>;
    reloadExistingRegion?(region: string): Promise<{ snapshot: DiscoverySnapshot; firstPage: unknown }>;
    visitRegion(region: string): Promise<{ snapshot: DiscoverySnapshot; firstPage: unknown }>;
    close(): Promise<void>;
    diagnostics: { actions: number; documentRequests: number; permittedDocumentRequests: number;
        productRequests: number; permittedProductRequests: number; blockedRequests: number };
}
export interface DiscoveryPlan {
    schemaVersion: number; expectedStartRegion: string; regions: string[];
    maxNavigations: number; maxProductRequests: number; delayMs: number; retries: number;
    reloadStart?: boolean;
}
export function parseDiscoveryPlan(value: unknown): DiscoveryPlan {
    const v = value as DiscoveryPlan | null;
    const known = ['AS', 'CH', 'JA', 'EU', 'HN', 'US', 'GS'];
    if (!v || typeof v !== 'object' || Array.isArray(v)
        || Object.keys(v).sort().join(',') !== (v.reloadStart === true ? 'delayMs,expectedStartRegion,maxNavigations,maxProductRequests,regions,reloadStart,retries,schemaVersion' : 'delayMs,expectedStartRegion,maxNavigations,maxProductRequests,regions,retries,schemaVersion')
        || v.schemaVersion !== 1 || !known.includes(v.expectedStartRegion)
        || !Array.isArray(v.regions) || v.regions.length < 1 || v.regions.length > 6
        || Array.from(v.regions).some(r => typeof r !== 'string' || !known.includes(r) || r === v.expectedStartRegion)
        || new Set(v.regions).size !== v.regions.length || v.maxNavigations !== v.regions.length + (v.reloadStart === true ? 1 : 0) || v.maxNavigations > 6
        || !Number.isInteger(v.maxProductRequests) || v.maxProductRequests < 1 || v.maxProductRequests > 6
        || v.delayMs !== 5000 || v.retries !== 0) throw new Error('invalid_discovery_plan');
    return { schemaVersion: 1, expectedStartRegion: v.expectedStartRegion, regions: [...v.regions],
        maxNavigations: v.maxNavigations, maxProductRequests: v.maxProductRequests, delayMs: 5000, retries: 0, ...(v.reloadStart === true ? { reloadStart: true } : {}) };
}
export async function executeRegionDiscovery(adapter: DiscoveryAdapter, root: string, input: DiscoveryPlan,
    options: { offlineOnly: boolean; wait?: (ms: number) => Promise<void> }) {
    const run = createStagingRun(root);
    let plan: DiscoveryPlan | null = null;
    const checkpoints: { region: string; runId: string }[] = [];
    const snapshots: DiscoverySnapshot[] = [];
    let status = 'discovery_ready_for_review', cleanupConfirmed = false;
    const startedAt = new Date().toISOString();
    const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    function save(snapshot: DiscoverySnapshot, firstPage: unknown) {
        const checkpoint = createStagingRun(root);
        checkpoint.write('summary.json', { region: snapshot.region, snapshot, firstPage,
            evidence: options.offlineOnly ? 'offline_fixture' : 'live_region_screen', productionReady: false });
        checkpoints.push({ region: snapshot.region, runId: checkpoint.runId });
        snapshots.push(snapshot);
    }
    try {
        plan = parseDiscoveryPlan(input);
        let initial: DiscoverySnapshot, initialPage: unknown = null;
        if (plan.reloadStart) {
            if (!adapter.reloadExistingRegion) throw new Error('recovery_unsupported');
            await wait(plan.delayMs);
            const recovered = await adapter.reloadExistingRegion(plan.expectedStartRegion);
            initial = recovered.snapshot; initialPage = recovered.firstPage;
        } else initial = await adapter.inspect();
        if (initial.restricted !== false || initial.region !== plan.expectedStartRegion
            || plan.regions.some(r => !initial.availableRegions.includes(r))) throw new Error('initial_scope_changed');
        save(initial, initialPage);
        for (const region of plan.regions) {
            await wait(plan.delayMs);
            const observed = await adapter.visitRegion(region);
            if (observed.snapshot.restricted !== false || observed.snapshot.region !== region) throw new Error('region_result_rejected');
            save(observed.snapshot, observed.firstPage);
        }
    } catch { status = 'failed'; }
    finally {
        try { await adapter.close(); cleanupConfirmed = true; } catch { status = 'failed'; }
    }
    if (adapter.failure) status = 'failed';
    const cities = new Map<string, { region: string; code: string; firstDepartureDate: string }>();
    for (const snapshot of snapshots) for (const city of snapshot.cities)
        if (!cities.has(snapshot.region + '|' + city.code)) cities.set(snapshot.region + '|' + city.code, { region: snapshot.region, ...city });
    const summary = { runId: run.runId, status, cleanupConfirmed, productionReady: false, fullCatalogueComplete: false,
        failure: status === 'failed' ? (adapter.failure && /^[a-z_]{1,64}$/.test(adapter.failure) ? adapter.failure : 'runner_failed') : null,
        capturedFirstPages: adapter.partialEvidence || [],
        lastRejectedRequest: adapter.lastRejectedRequest || null,
        offlineOnly: options.offlineOnly, plan, regionCount: snapshots.length, checkpoints, snapshots,
        observedRegionCityCount: cities.size, cities: Array.from(cities.values()), diagnostics: { ...adapter.diagnostics },
        startedAt, finishedAt: new Date().toISOString() };
    run.write('summary.json', summary);
    return summary;
}
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
        console.log('Existing normal Chrome only; regional inventory, NOT full product collection.\n'
            + '--run --consent-confirmed --plan <approved-local.json>\n'
            + 'At most 6 regional clicks/documents/product requests; 5s pacing; no retries; staging only.');
        return;
    }
    let plan: DiscoveryPlan;
    try {
        if (args.length !== 4 || args[0] !== '--run' || args[1] !== '--consent-confirmed' || args[2] !== '--plan') throw new Error('invalid_args');
        const file = path.resolve(args[3]), stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10000) throw new Error('invalid_plan_file');
        plan = parseDiscoveryPlan(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch { console.error('Refused: explicit consent and valid bounded local plan required. Use --help.'); process.exitCode = 2; return; }
    const { connectNormalChrome } = await import('../src/lib/onlinetour-browser-adapter');
    const { createOnlineTourRegionDiscovery } = await import('../src/lib/onlinetour-region-discovery');
    const client = await connectNormalChrome();
    let adapter: DiscoveryAdapter | undefined;
    try {
        adapter = await createOnlineTourRegionDiscovery(client, { maxNavigations: plan.maxNavigations, maxProductRequests: plan.maxProductRequests });
        const result = await executeRegionDiscovery(adapter, path.resolve(__dirname, '..'), plan, { offlineOnly: false });
        console.log(JSON.stringify({ runId: result.runId, status: result.status, regionCount: result.regionCount,
            observedRegionCityCount: result.observedRegionCityCount, diagnostics: result.diagnostics,
            cleanupConfirmed: result.cleanupConfirmed, productionReady: false, fullCatalogueComplete: false }));
        process.exitCode = result.status === 'failed' ? 1 : 0;
    } catch {
        if (adapter) await adapter.close().catch(() => {});
        else await client.close().catch(() => {});
        throw new Error('regional_operation_failed');
    }
}
if (require.main === module) void main().catch(() => {
    console.error('Regional discovery failed safely; no retry or operational merge.'); process.exitCode = 1;
});
