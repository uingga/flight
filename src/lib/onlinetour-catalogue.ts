import type { Flight } from '../types/flight';
import type { BrowserSnapshot, PartialPageEvidence } from './onlinetour-browser-adapter';
import type { RegionDiscoveryResult, RegionSnapshot, RegionFirstPage, RegionDiagnostics } from './onlinetour-region-discovery';
import { traverseOnlineTourLists, type ListPage, type ListScope, type TraversalResult } from './onlinetour-list-traversal';
import { validatePilotResponse } from './onlinetour-browser-collector';

const REGIONS = ['AS', 'CH', 'JA', 'EU', 'HN', 'US', 'GS'];
const monthOK = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{3}(0[1-9]|1[0-2])$/.test(v);
export interface CataloguePlan {
    schemaVersion: 1; regions: string[]; throughMonth: string;
    maxProductRequests: number; maxRegionalNavigations: number; maxPagesPerScope: number; maxMonthsPerCity: number;
}
export function parseCataloguePlan(value: unknown): CataloguePlan {
    const p = value as CataloguePlan;
    if (!p || typeof p !== 'object' || Array.isArray(p)
        || Object.keys(p).sort().join(',') !== 'maxMonthsPerCity,maxPagesPerScope,maxProductRequests,maxRegionalNavigations,regions,schemaVersion,throughMonth'
        || p.schemaVersion !== 1 || !Array.isArray(p.regions) || !p.regions.length || p.regions.length > 7
        || Array.from(p.regions).some(r => !REGIONS.includes(r)) || new Set(p.regions).size !== p.regions.length
        || !monthOK(p.throughMonth)
        || !Number.isSafeInteger(p.maxProductRequests) || p.maxProductRequests < 1 || p.maxProductRequests > 100
        || !Number.isSafeInteger(p.maxRegionalNavigations) || p.maxRegionalNavigations < 0 || p.maxRegionalNavigations > 6
        || !Number.isSafeInteger(p.maxPagesPerScope) || p.maxPagesPerScope < 1 || p.maxPagesPerScope > 20
        || !Number.isSafeInteger(p.maxMonthsPerCity) || p.maxMonthsPerCity < 1 || p.maxMonthsPerCity > 12)
        throw new Error('invalid_catalogue_plan');
    return { ...p, regions: [...p.regions] };
}
interface RegionAdapter {
    inspect(): Promise<RegionSnapshot>;
    visitRegion(region: string): Promise<RegionDiscoveryResult>;
    close(): Promise<void>;
    readonly diagnostics: RegionDiagnostics;
    readonly failure: string | null;
    readonly partialEvidence?: RegionFirstPage[];
    readonly lastRejectedRequest?: Record<string, string | boolean> | null;
}
interface ListsAdapter {
    inspect(): Promise<BrowserSnapshot>;
    readPage(scope: ListScope, page: number, attempt: number): Promise<ListPage>;
    close(): Promise<void>;
    readonly failureKind: string | null;
    readonly partialEvidence?: PartialPageEvidence[];
    readonly diagnostics: { permittedProductRequests: number; documentRequests: number; actions: number };
}
export interface CatalogueBackend {
    openRegion(navigations: number, products: number): Promise<RegionAdapter>;
    openLists(products: number, seed?: { scope: ListScope; page: ListPage }): Promise<ListsAdapter>;
    wait(ms: number): Promise<void>;
}
const key = (s: ListScope) => [s.departure, s.city, s.month].join('|');
/** One finite run. No scheduler, API fetch, profile creation or operational merge. */
export async function collectOnlineTourCatalogue(input: CataloguePlan, backend: CatalogueBackend,
    checkpoint: (result: TraversalResult) => Promise<void> = async () => {}) {
    const plan = parseCataloguePlan(input);
    const result = {
        status: 'review_ready' as 'review_ready' | 'review_ready_with_changes' | 'failed',
        productionReady: false as const, fullCatalogueComplete: false as const,
        coverage: 'entry_inventory_visible_forward_months_within_plan' as const,
        plannedCoverageCompleted: false, plan, failure: null as string | null, cleanupConfirmed: true,
        productRequests: 0, regionalNavigations: 0, listDocumentRequests: 0, readAttempts: 0,
        regions: [] as { region: string; cities: RegionSnapshot['cities']; completed: boolean }[],
        traversals: [] as TraversalResult[], flights: [] as Flight[], rawProducts: [] as Record<string, unknown>[],
        incompletePageCount: 0, duplicateCount: 0,
        deferred: [] as { region: string; city: string; reason: string }[],
        lastRejectedRequest: null as Record<string, string | boolean> | null,
    };
    const ids = new Set<string>(), visited = new Set<string>();
    function preserve(rows: Record<string, unknown>[], countDuplicates = true) {
        for (const raw of rows) {
            let v;
            try { v = validatePilotResponse('catalogueRow(' + JSON.stringify({ status: 200, data: { list: [raw] } }) + ');', 'catalogueRow'); }
            catch { continue; } // Partial envelopes never discard previously validated rows.
            if (v.status !== 'pilot_ready_for_review') continue;
            const f = v.flights[0];
            if (ids.has(f.id)) { if (countDuplicates) result.duplicateCount++; continue; }
            ids.add(f.id); result.rawProducts.push(v.rawProducts[0] as Record<string, unknown>); result.flights.push(f);
        }
    }
    const remaining = () => plan.maxProductRequests - result.productRequests;
    const safeReason = (v: unknown) => typeof v === 'string' && /^[a-z_]{1,80}$/.test(v) ? v : 'catalogue_step_failed';
    let started = false;
    try {
        for (const region of plan.regions) {
            if (remaining() <= 0) throw new Error('product_budget_exhausted');
            let discovery: RegionAdapter | undefined, observed: RegionDiscoveryResult | undefined;
            try {
                discovery = await backend.openRegion(plan.maxRegionalNavigations - result.regionalNavigations, Math.min(6, remaining()));
                const current = await discovery.inspect();
                if (current.restricted) throw new Error('access_restriction');
                if (!started && current.region !== region) throw new Error('initial_region_changed');
                if (current.region === region) observed = { snapshot: current, firstPage: null };
                else { await backend.wait(5000); observed = await discovery.visitRegion(region); }
            } finally {
                if (discovery) {
                    try { await discovery.close(); } catch { result.cleanupConfirmed = false; }
                    result.regionalNavigations += discovery.diagnostics.permittedDocumentRequests;
                    result.productRequests += discovery.diagnostics.permittedProductRequests;
                    result.lastRejectedRequest = discovery.lastRejectedRequest || result.lastRejectedRequest;
                    if (discovery.failure || !observed || !result.cleanupConfirmed) {
                        for (const p of discovery.partialEvidence || []) { preserve(p.rawProducts); result.incompletePageCount++; }
                        if (discovery.failure || !result.cleanupConfirmed)
                            throw new Error(safeReason(discovery.failure || 'regional_cleanup_failed'));
                    }
                }
            }
            started = true;
            if (!observed || observed.snapshot.region !== region || observed.snapshot.restricted) throw new Error('region_result_changed');
            const inventory = observed.snapshot.cities.map(c => ({ ...c }));
            const regionResult = { region, cities: inventory, completed: false }; result.regions.push(regionResult);
            if (!inventory.length) {
                if (observed.snapshot.currentScope || observed.firstPage) throw new Error('empty_inventory_mismatch');
                regionResult.completed = true; continue;
            }
            // Consume the region's first response before leaving its city; no redundant reload.
            const seed = observed.firstPage;
            if (seed) inventory.sort((a,b) => Number(b.code === seed.scope.city) - Number(a.code === seed.scope.city));
            let lists: ListsAdapter | undefined;
            try {
                if (remaining() <= 0) throw new Error('product_budget_exhausted');
                lists = await backend.openLists(remaining(), seed && typeof seed.nextPageAvailable === 'boolean'
                    ? { scope: seed.scope, page: { ...seed, nextPageAvailable: seed.nextPageAvailable } } : undefined);
                for (const city of inventory) {
                    const firstMonth = city.firstDepartureDate.slice(0,6);
                    if (!/^[A-Z]{3}$/.test(city.code) || !monthOK(firstMonth)) throw new Error('invalid_city_inventory');
                    if (firstMonth > plan.throughMonth) { result.deferred.push({ region, city: city.code, reason: 'after_plan_month' }); continue; }
                    let scope: ListScope = { departure: 'ICN', city: city.code, month: firstMonth };
                    let monthCount = 0;
                    while (true) {
                        const snapshot = await lists.inspect();
                        if (snapshot.restricted) throw new Error('access_restriction');
                        if (snapshot.region !== region) throw new Error('list_region_changed');
                        if (!snapshot.availableScopes.some(s => key(s) === key(scope))) throw new Error('scope_not_visible');
                        if (visited.has(region + '|' + key(scope))) throw new Error('scope_already_visited');
                        visited.add(region + '|' + key(scope));
                        if (++monthCount > plan.maxMonthsPerCity) throw new Error('month_budget_exhausted');
                        const attemptBudget = plan.maxProductRequests * 2 - result.readAttempts;
                        if (attemptBudget <= 0) throw new Error('attempt_budget_exhausted');
                        if (result.readAttempts || result.productRequests) await backend.wait(5000);
                        const traversal = await traverseOnlineTourLists([scope], (s,p,a) => lists!.readPage(s,p,a), {
                            maxRequests: attemptBudget, maxPagesPerScope: plan.maxPagesPerScope, wait: backend.wait,
                        });
                        result.readAttempts += traversal.requestCount;
                        result.traversals.push(traversal); preserve(traversal.rawProducts);
                        // Persist completed/partial pages before requesting another city or month.
                        await checkpoint(traversal);
                        if (traversal.status === 'failed') throw new Error('list_traversal_failed');
                        if (traversal.status === 'review_ready_with_changes') result.status = traversal.status;
                        const after = await lists.inspect();
                        if (after.restricted) throw new Error('access_restriction');
                        if (after.region !== region || key(after.currentScope) !== key(scope)) throw new Error('scope_changed_after_read');
                        const next = after.availableScopes.filter(s => s.departure === scope.departure && s.city === scope.city
                            && s.month > scope.month && s.month <= plan.throughMonth).sort((a,b) => a.month.localeCompare(b.month))[0];
                        if (!next) break; // Only visible forward controls; never synthesize a month/API request.
                        scope = { departure: next.departure, city: next.city, month: next.month };
                    }
                }
            } finally {
                if (seed && !result.traversals.some(t => t.scopes.some(s => key(s.scope) === key(seed.scope) && s.pagesRead > 0))) {
                    preserve(seed.rawProducts, false); result.incompletePageCount++;
                }
                if (lists) {
                    try { await lists.close(); } catch { result.cleanupConfirmed = false; }
                    result.productRequests += lists.diagnostics.permittedProductRequests;
                    result.listDocumentRequests += lists.diagnostics.documentRequests;
                    for (const p of lists.partialEvidence || []) { preserve(p.rawProducts); result.incompletePageCount++; }
                    if (lists.failureKind || result.incompletePageCount || !result.cleanupConfirmed)
                        throw new Error(lists.failureKind === 'access' ? 'access_restriction' : 'list_adapter_failed');
                }
            }
            regionResult.completed = true;
        }
        if (!result.flights.length) throw new Error('empty_catalogue');
        result.plannedCoverageCompleted = true;
        if (result.duplicateCount && result.status === 'review_ready') result.status = 'review_ready_with_changes';
    } catch (error) { result.status = 'failed'; result.failure = safeReason((error as Error).message); }
    if (result.productRequests > plan.maxProductRequests || result.regionalNavigations > plan.maxRegionalNavigations) {
        result.status = 'failed'; result.failure = 'budget_accounting_mismatch'; result.plannedCoverageCompleted = false;
    }
    return result;
}
