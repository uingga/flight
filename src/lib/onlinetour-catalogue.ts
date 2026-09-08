import type { Flight } from '../types/flight';
import type { BrowserSnapshot, PartialPageEvidence } from './onlinetour-browser-adapter';
import type { RegionDiscoveryResult, RegionSnapshot, RegionFirstPage, RegionDiagnostics } from './onlinetour-region-discovery';
import { traverseOnlineTourLists, type ListPage, type ListScope, type TraversalResult, type TraversalOptions } from './onlinetour-list-traversal';
import { validatePilotResponse } from './onlinetour-browser-collector';
import { validateDepartureWindow, type DepartureWindow } from './onlinetour-departure-window';
import { followingMonth } from './onlinetour-month-navigation';
import { crawlOrder } from './crawl-order.mjs';

const REGIONS = ['AS', 'CH', 'JA', 'EU', 'HN', 'US', 'GS'];
const monthOK = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{3}(0[1-9]|1[0-2])$/.test(v);
export interface CataloguePlan {
    schemaVersion: 1; regions: string[]; throughMonth: string;
    maxProductRequests: number; maxRegionalNavigations: number; maxPagesPerScope: number; maxMonthsPerCity: number;
    reloadStart?: true; maxCitiesPerRegion?: number; maxRetries?: 0 | 1;
    departureWindow?: DepartureWindow; excludeCities?: string[];
    orderSeed?: string;
}
export function parseCataloguePlan(value: unknown): CataloguePlan {
    const p = value as CataloguePlan;
    const required = ['maxMonthsPerCity','maxPagesPerScope','maxProductRequests','maxRegionalNavigations','regions','schemaVersion','throughMonth'];
    const optional = ['reloadStart','maxCitiesPerRegion','maxRetries','departureWindow','excludeCities','orderSeed'];
    if (!p || typeof p !== 'object' || Array.isArray(p)
        || required.some(k => !Object.hasOwn(p, k)) || Object.keys(p).some(k => !required.includes(k) && !optional.includes(k))
        || p.schemaVersion !== 1 || !Array.isArray(p.regions) || !p.regions.length || p.regions.length > 7
        || Array.from(p.regions).some(r => !REGIONS.includes(r)) || new Set(p.regions).size !== p.regions.length
        || !monthOK(p.throughMonth)
        || !Number.isSafeInteger(p.maxProductRequests) || p.maxProductRequests < 1 || p.maxProductRequests > 100
        || !Number.isSafeInteger(p.maxRegionalNavigations) || p.maxRegionalNavigations < 0 || p.maxRegionalNavigations > 6
        || !Number.isSafeInteger(p.maxPagesPerScope) || p.maxPagesPerScope < 1 || p.maxPagesPerScope > 20
        || !Number.isSafeInteger(p.maxMonthsPerCity) || p.maxMonthsPerCity < 1 || p.maxMonthsPerCity > 12
        || (Object.hasOwn(p, 'reloadStart') && (p.reloadStart !== true || p.maxRegionalNavigations < 1))
        || (Object.hasOwn(p, 'maxRetries') && ![0, 1].includes(p.maxRetries!))
        || (Object.hasOwn(p, 'maxCitiesPerRegion') && (!Number.isSafeInteger(p.maxCitiesPerRegion)
            || p.maxCitiesPerRegion! < 1 || p.maxCitiesPerRegion! > 20)))
        throw new Error('invalid_catalogue_plan');
    if (p.excludeCities !== undefined && (!Array.isArray(p.excludeCities) || p.excludeCities.length > 20
        || p.excludeCities.some(c => typeof c !== 'string' || !/^[A-Z]{3}$/.test(c))
        || new Set(p.excludeCities).size !== p.excludeCities.length)) throw new Error('invalid_catalogue_plan');
    if (p.departureWindow !== undefined) {
        const window = validateDepartureWindow(p.departureWindow);
        if (p.throughMonth !== window.through.slice(0,7).replace('-','')) throw new Error('departure_window_month_mismatch');
    }
    if (p.orderSeed !== undefined && (typeof p.orderSeed !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(p.orderSeed))) throw new Error('invalid_order_seed');
    return { ...p, regions: [...p.regions], ...(p.departureWindow ? { departureWindow: {...p.departureWindow} } : {}),
        ...(p.excludeCities ? {excludeCities:[...p.excludeCities]} : {}) };
}
interface RegionAdapter {
    enterFirstList?(): Promise<RegionDiscoveryResult>;
    inspect(): Promise<RegionSnapshot>;
    visitRegion(region: string): Promise<RegionDiscoveryResult>;
    reloadExistingRegion?(region: string): Promise<RegionDiscoveryResult>;
    visitEmptyMonth?(region:string,month:string): Promise<RegionDiscoveryResult>;
    resetExistingRegion?(region:string): Promise<RegionDiscoveryResult>;
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
    openInitialRegion?(): Promise<RegionAdapter>;
    close?(): Promise<void>;
    openRegion(navigations: number, products: number): Promise<RegionAdapter>;
    openLists(products: number, seed?: { scope: ListScope; page: ListPage }): Promise<ListsAdapter>;
    wait(ms: number): Promise<void>;
}
const key = (s: ListScope) => [s.departure, s.city, s.month].join('|');
/** No extra requests: count every visible city-month; page totals refine this as responses arrive. */
export function inventoryListRequests(cities: RegionSnapshot['cities'], throughMonth: string): number {
    let count = 0;
    for (const city of cities) {
        let month = city.firstDepartureDate.slice(0,6);
        if (!monthOK(month) || !monthOK(throughMonth)) throw new Error('invalid_city_inventory');
        for (; month <= throughMonth; month = followingMonth(month)) {
            if (++count > 1000) throw new Error('planned_inventory_too_large');
        }
    }
    return count;
}
export interface CatalogueResume {
    parentRunId: string; productRequests: number; regionalNavigations: number;
    snapshot: RegionSnapshot; initialEvidence: NonNullable<TraversalOptions['initialEvidence']>;
    orderSeed?: string;
}
/** One finite run. No scheduler, API fetch, profile creation or operational merge. */
export async function collectOnlineTourCatalogue(input: CataloguePlan, backend: CatalogueBackend,
    checkpoint: (result: TraversalResult) => Promise<void> = async () => {},
    progress: (event: Record<string, unknown>) => void = () => {}, resume?: CatalogueResume) {
    const plan = parseCataloguePlan(input);
    const result = {
        status: 'review_ready' as 'review_ready' | 'review_ready_with_changes' | 'failed',
        productionReady: false as const, fullCatalogueComplete: false as const,
        coverage: plan.maxCitiesPerRegion ? 'sampled_visible_cities_and_months' : 'entry_inventory_visible_forward_months_within_plan',
        firstPageVerified: false,
        plannedCoverageCompleted: false, plan, failure: null as string | null, cleanupConfirmed: true,
        parentRunId: resume?.parentRunId || null,
        productRequests: resume?.productRequests || 0, regionalNavigations: resume?.regionalNavigations || 0, listDocumentRequests: 0, readAttempts: 0,
        regions: [] as { region: string; cities: RegionSnapshot['cities']; completed: boolean; emptyInventoryVerified?: true; checkedEmptyMonths:string[] }[],
        traversals: [] as TraversalResult[], flights: [] as Flight[], rawProducts: [] as Record<string, unknown>[],
        incompletePageCount: 0, duplicateCount: 0,
        requestBudget: { safetyCeiling: plan.maxProductRequests, cityMonthPages: 0, observedExtraPages: 0,
            unknownRegions: plan.regions.length, completeEstimate: false },
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
        if (resume && resume.orderSeed !== plan.orderSeed) throw new Error('resume_order_changed');
        if (resume && (!Number.isSafeInteger(resume.productRequests) || resume.productRequests < 1
            || resume.productRequests >= plan.maxProductRequests || !Number.isSafeInteger(resume.regionalNavigations)
            || resume.regionalNavigations < 0 || resume.regionalNavigations > plan.maxRegionalNavigations
            || resume.snapshot.region !== plan.regions[0] || resume.snapshot.restricted)) throw new Error('invalid_resume_budget');
        for (const region of plan.regions) {
            if (remaining() <= 0) throw new Error('product_budget_exhausted');
            let discovery: RegionAdapter | undefined, observed: RegionDiscoveryResult | undefined;
            let resetStart = false;
            const ownedEntry = !started && !resume && !!backend.openInitialRegion;
            try {
                if (!started && resume) observed = { snapshot: resume.snapshot, firstPage: null };
                else if (ownedEntry) {
                    discovery = await backend.openInitialRegion!();
                    if (!discovery.enterFirstList) throw new Error('initial_entry_unavailable');
                    observed = await discovery.enterFirstList();
                }
                else {
                const firstGate = !started && plan.reloadStart;
                discovery = await backend.openRegion(firstGate ? 1 : plan.maxRegionalNavigations - result.regionalNavigations,
                    firstGate ? 1 : Math.min(6, remaining()));
                if (firstGate) {
                    if (!discovery.reloadExistingRegion) throw new Error('first_page_reload_unavailable');
                    observed = await discovery.reloadExistingRegion(region);
                } else {
                    const current = await discovery.inspect();
                    if (current.restricted) throw new Error('access_restriction');
                    if (!started && current.region !== region) throw new Error('initial_region_changed');
                    if (!started && current.region === region && plan.departureWindow && current.inventoryMonth
                        && current.inventoryMonth !== plan.departureWindow.from.slice(0,7).replace('-','')) {
                        if (!discovery.resetExistingRegion) throw new Error('initial_month_unverified');
                        resetStart = true;
                        observed = await discovery.resetExistingRegion(region);
                        if (observed.snapshot.inventoryMonth !== plan.departureWindow.from.slice(0,7).replace('-','')) throw new Error('initial_month_unverified');
                    }
                    else if (current.region === region) observed = { snapshot: current, firstPage: null };
                    else { await backend.wait(5000); observed = await discovery.visitRegion(region); }
                }
                }
            } finally {
                if (discovery) {
                    try { await discovery.close(); } catch { result.cleanupConfirmed = false; }
                    if (resetStart || ownedEntry) result.listDocumentRequests += discovery.diagnostics.permittedDocumentRequests;
                    else result.regionalNavigations += discovery.diagnostics.permittedDocumentRequests;
                    result.productRequests += discovery.diagnostics.permittedProductRequests;
                    result.lastRejectedRequest = discovery.lastRejectedRequest || result.lastRejectedRequest;
                    if (discovery.failure || !observed || !result.cleanupConfirmed) {
                        for (const p of discovery.partialEvidence || []) { preserve(p.rawProducts); result.incompletePageCount++; }
                        if (discovery.failure || !result.cleanupConfirmed)
                            throw new Error(safeReason(discovery.failure || 'regional_cleanup_failed'));
                    }
                }
            }
            if (!observed || observed.snapshot.region !== region || observed.snapshot.restricted) throw new Error('region_result_changed');
            if (!started && resume) {
                result.firstPageVerified = true;
                progress({ stage: 'verified_checkpoint_reused', rows: resume.initialEvidence.rawProducts.length, productRequests: result.productRequests });
            } else if (!started && (plan.reloadStart || ownedEntry)) {
                const first = observed.firstPage;
                if (!first?.rawProducts.length) throw new Error('empty_or_invalid_first_page');
                const checked = validatePilotResponse('gate(' + JSON.stringify({ status: 200, data: { list: first.rawProducts } }) + ');', 'gate');
                if (checked.status !== 'pilot_ready_for_review' || first.pageNo !== 1
                    || typeof first.nextPageAvailable !== 'boolean') throw new Error('empty_or_invalid_first_page');
                // The old adapter has fully closed (including late restrictions) before the gate passes.
                result.firstPageVerified = true;
                progress({ stage: 'first_page_verified', scope: first.scope, rows: checked.flights.length,
                    productRequests: result.productRequests });
            }
            started = true;
            const checkedEmptyMonths:string[] = [];
            while (!observed.snapshot.cities.length) {
                const current = observed.snapshot;
                if (current.currentScope || observed.firstPage || !current.emptyInventoryVerified || !monthOK(current.inventoryMonth))
                    throw new Error('empty_inventory_month_unverified');
                checkedEmptyMonths.push(current.inventoryMonth);
                if (current.inventoryMonth >= plan.throughMonth) break;
                if (checkedEmptyMonths.length >= plan.maxMonthsPerCity) throw new Error('month_budget_exhausted');
                if (remaining() <= 0) throw new Error('product_budget_exhausted');
                const nextMonth = followingMonth(current.inventoryMonth);
                let monthly:RegionAdapter|undefined, next:RegionDiscoveryResult|undefined;
                try {
                    await backend.wait(5000);
                    monthly = await backend.openRegion(1,1);
                    if (!monthly.visitEmptyMonth) throw new Error('month_navigation_unverified');
                    next = await monthly.visitEmptyMonth(region,nextMonth);
                } finally {
                    if (monthly) {
                        try { await monthly.close(); } catch { result.cleanupConfirmed=false; }
                        // A month document is list navigation, not another regional entry. Product caps remain shared.
                        result.listDocumentRequests += monthly.diagnostics.permittedDocumentRequests;
                        result.productRequests += monthly.diagnostics.permittedProductRequests;
                        result.lastRejectedRequest = monthly.lastRejectedRequest || result.lastRejectedRequest;
                        if (monthly.failure || !result.cleanupConfirmed) throw new Error(safeReason(monthly.failure || 'regional_cleanup_failed'));
                    }
                }
                if (!next || next.snapshot.restricted || next.snapshot.region !== region || next.snapshot.inventoryMonth !== nextMonth)
                    throw new Error('empty_inventory_month_unverified');
                observed = next;
                progress({stage:'empty_region_month_checked',region,month:nextMonth,cities:next.snapshot.cities.length,productRequests:result.productRequests});
            }
            const inventory = crawlOrder(observed.snapshot.cities.map(c => ({ ...c })), plan.orderSeed,
                (c: RegionSnapshot['cities'][number]) => region + '|' + c.code);
            const regionResult = { region, cities: inventory, completed: false, checkedEmptyMonths,
                ...(observed.snapshot.emptyInventoryVerified ? {emptyInventoryVerified:true as const} : {}) }; result.regions.push(regionResult);
            if (!inventory.length) {
                if (observed.snapshot.currentScope || observed.firstPage || !observed.snapshot.emptyInventoryVerified) throw new Error('empty_inventory_mismatch');
                regionResult.completed = true; continue;
            }
            // Consume the region's first response before leaving its city; no redundant reload.
            const seed = observed.firstPage;
            if (seed) inventory.sort((a,b) => Number(b.code === seed.scope.city) - Number(a.code === seed.scope.city));
            else if (resume && region === resume.snapshot.region) inventory.sort((a,b) => Number(b.code === resume.initialEvidence.scope.city) - Number(a.code === resume.initialEvidence.scope.city));
            const candidates = inventory.filter(city => !plan.excludeCities?.includes(city.code));
            for (const city of inventory.filter(city => plan.excludeCities?.includes(city.code)))
                result.deferred.push({ region, city: city.code, reason: 'excluded_by_plan_no_requery' });
            const selected = plan.maxCitiesPerRegion ? candidates.slice(0, plan.maxCitiesPerRegion) : candidates;
            result.requestBudget.cityMonthPages += inventoryListRequests(selected, plan.throughMonth);
            result.requestBudget.unknownRegions = plan.regions.length - result.regions.length;
            progress({stage: 'request_budget_calculated', ...result.requestBudget, productRequests: result.productRequests});
            for (const city of candidates.slice(selected.length)) result.deferred.push({ region, city: city.code, reason: 'outside_city_sample' });
            progress({ stage: 'region_sample_selected', region, cities: selected.map(c => c.code), throughMonth: plan.throughMonth });
            if (!selected.length) { regionResult.completed = true; continue; }
            let lists: ListsAdapter | undefined;
            try {
                if (remaining() <= 0) throw new Error('product_budget_exhausted');
                lists = await backend.openLists(remaining(), seed && typeof seed.nextPageAvailable === 'boolean'
                    ? { scope: seed.scope, page: { ...seed, nextPageAvailable: seed.nextPageAvailable } } : undefined);
                for (const city of selected) {
                    const firstMonth = city.firstDepartureDate.slice(0,6);
                    if (!/^[A-Z]{3}$/.test(city.code) || !monthOK(firstMonth)) throw new Error('invalid_city_inventory');
                    if (firstMonth > plan.throughMonth) { result.deferred.push({ region, city: city.code, reason: 'after_plan_month' }); continue; }
                    const initialScope = observed.snapshot.currentScope;
                    let scope: ListScope = { departure: initialScope?.city === city.code ? initialScope.departure : 'ICN', city: city.code, month: firstMonth };
                    let monthCount = 0;
                    while (true) {
                        const snapshot = await lists.inspect();
                        if (snapshot.restricted) throw new Error('access_restriction');
                        if (snapshot.region !== region) throw new Error('list_region_changed');
                        if (!snapshot.availableScopes.some(s => key(s) === key(scope))) throw new Error('scope_not_visible');
                        if (visited.has(region + '|' + key(scope))) throw new Error('scope_already_visited');
                        visited.add(region + '|' + key(scope));
                        if (++monthCount > plan.maxMonthsPerCity) throw new Error('month_budget_exhausted');
                        const attemptBudget = plan.maxProductRequests * ((plan.maxRetries ?? 1) + 1) + 1 - result.readAttempts;
                        if (attemptBudget <= 0) throw new Error('attempt_budget_exhausted');
                        if (result.readAttempts || result.productRequests) await backend.wait(5000);
                        const traversal = await traverseOnlineTourLists([scope], (s,p,a) => lists!.readPage(s,p,a), {
                            maxRequests: attemptBudget, maxPagesPerScope: plan.maxPagesPerScope, maxRetries: plan.maxRetries, wait: backend.wait,
                            initialEvidence: resume && key(scope) === key(resume.initialEvidence.scope) && result.traversals.length === 0 ? resume.initialEvidence : undefined,
                        });
                        result.readAttempts += traversal.requestCount;
                        result.requestBudget.observedExtraPages += traversal.scopes.reduce((n, s) =>
                            n + Math.max(0, (s.latestLastPage ?? s.plannedLastPage ?? 1) - 1), 0);
                        result.traversals.push(traversal); preserve(traversal.rawProducts);
                        // Persist completed/partial pages before requesting another city or month.
                        await checkpoint(traversal);
                        progress({ stage: 'scope_saved', scope, status: traversal.status, rows: traversal.uniqueCount,
                            pages: traversal.scopes[0]?.pagesRead, productRequests: result.productRequests + lists.diagnostics.permittedProductRequests });
                        if (traversal.status === 'failed') throw new Error('list_traversal_failed');
                        if (traversal.status === 'review_ready_with_changes') result.status = traversal.status;
                        const after = await lists.inspect();
                        if (after.restricted) throw new Error('access_restriction');
                        if (after.region !== region || key(after.currentScope) !== key(scope)) throw new Error('scope_changed_after_read');
                        const next = after.availableScopes.filter(s => s.departure === scope.departure && s.city === scope.city
                            && s.month > scope.month && s.month <= plan.throughMonth).sort((a,b) => a.month.localeCompare(b.month))[0];
                        if (!next) {
                            if (scope.month < plan.throughMonth) throw new Error('month_coverage_unverified');
                            break;
                        }
                        if (next.month !== followingMonth(scope.month)) throw new Error('month_coverage_gap');
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
        result.requestBudget.unknownRegions = 0;
        result.requestBudget.completeEstimate = true;
        if (result.duplicateCount && result.status === 'review_ready') result.status = 'review_ready_with_changes';
    } catch (error) { result.status = 'failed'; result.failure = safeReason((error as Error).message); }
    if (result.productRequests > plan.maxProductRequests || result.regionalNavigations > plan.maxRegionalNavigations) {
        result.status = 'failed'; result.failure = 'budget_accounting_mismatch'; result.plannedCoverageCompleted = false;
    }
    return result;
}
