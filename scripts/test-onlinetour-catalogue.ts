import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOnlineTourCatalogue, parseCataloguePlan, type CatalogueBackend, type CataloguePlan } from '../src/lib/onlinetour-catalogue';
import { ListReadError } from '../src/lib/onlinetour-list-traversal';
import { validRow, FakeCdp } from './test-onlinetour-browser-adapter';
import { createOnlineTourBrowserAdapter } from '../src/lib/onlinetour-browser-adapter';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeCatalogue, parseCatalogueArgs, checkValidationCooldown } from './crawl-onlinetour-catalogue';
import { validateCombinedPlan, validateFreshSourceState } from './validate-onlinetour-combined';
import { createDepartureWindow, validateDepartureWindow, eligibleDepartures } from '../src/lib/onlinetour-departure-window';
import type { Flight } from '../src/types/flight';

const plan: CataloguePlan = { schemaVersion: 1, regions: ['AS','CH'], throughMonth: '202610',
    maxProductRequests: 8, maxRegionalNavigations: 1, maxPagesPerScope: 2, maxMonthsPerCity: 2 };
test('60-day departure window uses KST and crosses months/years/leap day exactly', () => {
    assert.deepEqual(createDepartureWindow(Date.parse('2026-09-06T15:00:00Z')), {from:'2026-09-07',through:'2026-11-06'});
    assert.equal(createDepartureWindow(Date.parse('2026-12-31T15:00:00Z')).through,'2027-03-02');
    assert.equal(createDepartureWindow(Date.parse('2028-01-01T00:00:00Z')).through,'2028-03-01');
    for (const w of [{from:'2026-02-30',through:'2026-03-01'}, {from:'2026-09-07',through:'2026-11-07'},
        {from:'2026-09-07',through:'2026-09-06'}, {from:'2026-09-07',through:'2026-11-06',other:1}])
        assert.throws(() => validateDepartureWindow(w));
});
test('departure eligibility is inclusive, does not constrain return date or mutate raw evidence', () => {
    const dates = ['2026-11-07','2026-11-06','2026-09-07','2026-09-06'];
    const flights = dates.map((date,i) => ({id:String(i),price:500000,departure:{date},arrival:{date:'2026-12-01'}})) as Flight[];
    const saved = JSON.stringify(flights);
    assert.deepEqual(eligibleDepartures(flights,{from:'2026-09-07',through:'2026-11-06'}).map(f => f.departure.date), ['2026-09-07','2026-11-06']);
    assert.equal(JSON.stringify(flights),saved);
});
test('window plan refuses mismatched month, duplicate exclusions and follow-up budget expansion', () => {
    const p = {...plan,regions:['AS','JA'],throughMonth:'202611',maxProductRequests:16,maxMonthsPerCity:3,maxCitiesPerRegion:1,
        maxRetries:0 as const,excludeCities:['PQC'],departureWindow:{from:'2026-09-07',through:'2026-11-06'}};
    assert.doesNotThrow(() => validateCombinedPlan(p));
    assert.doesNotThrow(() => validateCombinedPlan({...p,regions:['JA'],reloadStart:true}));
    assert.throws(() => validateCombinedPlan({...p,regions:['JA']}));
    for (const bad of [{...p,throughMonth:'202612'}, {...p,excludeCities:['PQC','PQC']}, {...p,maxProductRequests:17},
        {...p,reloadStart:true}, {...p,maxRetries:1}]) assert.throws(() => validateCombinedPlan(bad));
});
function fixture(options: { departure?: string; lateAccess?: boolean; regionFailure?: boolean; transient?: boolean; duplicate?: boolean;
    extraCities?: boolean; emptyFirst?: boolean; gateLateAccess?: boolean } = {}) {
    let region = 'AS', scope = { departure: options.departure || 'ICN', city: 'PQC', month: '202609' }, open = false, calls = 0;
    const requests: string[] = [], caps: number[] = [];
    const city = () => region === 'AS' ? 'PQC' : 'TAO';
    const regionSnapshot = () => ({ region, currentScope: { ...scope }, restricted: false,
        cities: [city(), ...(options.extraCities ? ['DAD','BKK','CEB'] : [])].map(code => ({ code, firstDepartureDate: '20260907' })),
        monthCandidates: ['202609','202610'], availableRegions: ['AS','CH'] });
    const page = () => ({ pageNo: 1, totalCount: 1, lastPage: 1, nextPageAvailable: false,
        rawProducts: [validRow(options.duplicate ? 'duplicate' : region + scope.city + scope.month)] });
    const backend: CatalogueBackend = {
        wait: async () => {},
        async openRegion(navigationCap, productCap) {
            assert.equal(open, false, 'adapters must never be attached together'); open = true;
            const diagnostics = { actions: 0, documentRequests: 0, permittedDocumentRequests: 0,
                productRequests: 0, permittedProductRequests: 0, blockedRequests: 0 };
            let failed = false;
            let gateClosed = false;
            return { inspect: async () => regionSnapshot(), diagnostics, close: async () => { open = false; gateClosed = true; },
                get failure() { return options.gateLateAccess && gateClosed ? 'access_body' : failed ? 'invalid_paused_request' : null; },
                async reloadExistingRegion(next) {
                    assert.equal(navigationCap, 1); assert.equal(productCap, 1); assert.equal(next, region);
                    diagnostics.permittedDocumentRequests++; diagnostics.permittedProductRequests++;
                    requests.push('reload:' + next);
                    if (options.regionFailure) { failed = true; throw new Error('invalid_paused_request'); }
                    return { snapshot: regionSnapshot(), firstPage: { ...page(), scope: { ...scope }, pageNo: 1,
                        ...(options.emptyFirst ? { rawProducts: [] } : {}) } };
                },
                async visitRegion(next) {
                    if (!navigationCap || !productCap) throw new Error('regional_budget_exhausted');
                    diagnostics.permittedDocumentRequests++; diagnostics.permittedProductRequests++;
                    requests.push('region:' + next); region = next; scope = { ...scope, city: city(), month: '202609' };
                    if (options.regionFailure) { failed = true; throw new Error('invalid_paused_request'); }
                    return { snapshot: regionSnapshot(), firstPage: { ...page(), scope: { ...scope }, pageNo: 1 } };
                },
            };
        },
        async openLists(cap, seed) {
            assert.equal(open, false); open = true; caps.push(cap);
            const diagnostics = { permittedProductRequests: 0, documentRequests: 0, actions: 0 };
            let closed = false;
            return { diagnostics, get failureKind() { return closed && options.lateAccess ? 'access' : null; },
                close: async () => { closed = true; open = false; },
                inspect: async () => ({ region, restricted: false, currentScope: { ...scope }, nextPageNo: 2, nextPageAvailable: false,
                    availableScopes: [scope, ...regionSnapshot().cities.map(c => ({ ...scope, city: c.code, month: '202609' })),
                        { ...scope, month: '202610' }],
                    preflight: { existingListTabPresent: true, evidence: 'existing_list_tab_only_not_authentication_guarantee' } }),
                async readPage(s, p) {
                    calls++;
                    if (seed && s.city === seed.scope.city && s.month === seed.scope.month) { seed = undefined; return page(); }
                    if (diagnostics.permittedProductRequests >= cap) throw new ListReadError('validation', 'budget');
                    diagnostics.permittedProductRequests++; diagnostics.actions++; diagnostics.documentRequests++;
                    requests.push(s.city + ':' + s.month + ':' + p);
                    if (options.transient && calls === 1) throw new ListReadError('transient', 'temporary');
                    scope = { ...s }; return page();
                },
            };
        },
    };
    return { backend, requests, caps };
}
test('whole run shares request budget, visits visible months and reuses region first page', async () => {
    const f = fixture(); let checkpoints = 0;
    const r = await collectOnlineTourCatalogue(plan, f.backend, async () => { checkpoints++; });
    assert.equal(r.status, 'review_ready'); assert.equal(r.plannedCoverageCompleted, true);
    assert.equal(r.productRequests, 4); assert.equal(r.traversals.length, 4); assert.equal(checkpoints, 4);
    assert.equal(r.flights.length, 4); assert.deepEqual(f.caps, [8,5]);
    assert.deepEqual(f.requests, ['PQC:202609:1','PQC:202610:1','region:CH','TAO:202610:1']);
    assert.equal(r.productionReady, false); assert.equal(r.fullCatalogueComplete, false);
});
test('exhausted global budget stops before additional region or month', async () => {
    for (const cap of [1,2,3]) {
        const f = fixture(); const r = await collectOnlineTourCatalogue({ ...plan, maxProductRequests: cap }, f.backend);
        assert.equal(r.status, 'failed'); assert.ok(r.productRequests <= cap); assert.equal(r.plannedCoverageCompleted, false);
        assert.ok(f.requests.length <= cap);
    }
});
test('late cleanup access prevents later regions and cannot become success', async () => {
    const f = fixture({ lateAccess: true }); const r = await collectOnlineTourCatalogue(plan, f.backend);
    assert.equal(r.status, 'failed'); assert.equal(r.failure, 'access_restriction');
    assert.equal(r.regions.length, 1); assert.equal(r.flights.length, 2); assert.equal(r.cleanupConfirmed, true);
});
test('unknown regional frame remains failed and does not trigger retry', async () => {
    const f = fixture({ regionFailure: true }); const r = await collectOnlineTourCatalogue(plan, f.backend);
    assert.equal(r.status, 'failed'); assert.equal(r.failure, 'invalid_paused_request');
    assert.equal(f.requests.filter(s => s.startsWith('region:')).length, 1);
});
test('transient retry consumes the same global budget', async () => {
    const f = fixture({ transient: true }); const r = await collectOnlineTourCatalogue(plan, f.backend);
    assert.equal(r.status, 'review_ready'); assert.equal(r.productRequests, 5); assert.equal(r.readAttempts, 5);
});
test('explicit zero retries stops on the first transient without another request', async () => {
    const f = fixture({ transient: true }); const r = await collectOnlineTourCatalogue({ ...plan, maxRetries: 0 }, f.backend);
    assert.equal(r.status, 'failed'); assert.equal(r.productRequests, 1); assert.equal(r.readAttempts, 1);
    assert.equal(r.traversals[0].retryCount, 0); assert.equal(f.requests.length, 1);
});
const combined: CataloguePlan = { ...plan, regions: ['AS'], reloadStart: true, maxRetries: 0,
    maxProductRequests: 20, maxCitiesPerRegion: 3 };
test('combined gate transfers first page without another request then samples three cities and two months', async () => {
    const f = fixture({ extraCities: true }); const events: Record<string, unknown>[] = [];
    const r = await collectOnlineTourCatalogue(combined, f.backend, async () => {}, e => events.push(e));
    assert.equal(r.status, 'review_ready'); assert.equal(r.firstPageVerified, true);
    assert.equal(r.productRequests, 6); assert.equal(r.regionalNavigations, 1); assert.equal(r.flights.length, 6);
    assert.equal(r.traversals.length, 6); assert.equal(r.plannedCoverageCompleted, true);
    assert.equal(r.coverage, 'sampled_visible_cities_and_months');
    assert.deepEqual(r.deferred, [{ region: 'AS', city: 'CEB', reason: 'outside_city_sample' }]);
    assert.deepEqual(f.requests, ['reload:AS','PQC:202610:1','DAD:202609:1','DAD:202610:1','BKK:202609:1','BKK:202610:1']);
    assert.equal(events[0].stage, 'first_page_verified'); assert.equal(f.caps[0], 19);
});
test('a failed, empty or late-restricted first gate never opens the city traversal adapter', async () => {
    for (const options of [{ regionFailure: true }, { emptyFirst: true }, { gateLateAccess: true }]) {
        const f = fixture(options); const r = await collectOnlineTourCatalogue(combined, f.backend);
        assert.equal(r.status, 'failed'); assert.equal(r.firstPageVerified, false);
        assert.equal(f.requests.length, 1); assert.equal(f.caps.length, 0);
    }
});
test('combined runner refuses stale source state and expanded or retry-enabled plans', () => {
    assert.deepEqual(validateCombinedPlan(combined), combined);
    for (const p of [{ ...combined, maxRetries: 1 }, { ...combined, reloadStart: false },
        { ...combined, maxCitiesPerRegion: 4 }, { ...combined, maxProductRequests: 21 },
        { ...combined, maxPagesPerScope: 7 }, { ...combined, regions: ['AS','CH'] },
        { ...combined, maxRegionalNavigations: 2 }]) assert.throws(() => validateCombinedPlan(p));
    const now = Date.parse('2026-09-07T04:00:00Z');
    const state = { revision: 'a'.repeat(40), fetchedAt: new Date(now).toISOString(),
        fullCrawlUpdatedAt: new Date(now - 3600_000).toISOString(), sourceCircuits: {} };
    assert.doesNotThrow(() => validateFreshSourceState(state, now));
    for (const s of [null, {}, { ...state, fetchedAt: new Date(now - 16 * 60_000).toISOString() },
        { ...state, fetchedAt: new Date(now + 1).toISOString() },
        { ...state, fullCrawlUpdatedAt: new Date(now - 7 * 3600_000).toISOString() },
        { ...state, sourceCircuits: [] }]) assert.throws(() => validateFreshSourceState(s, now));
});
test('duplicates keep the first intact product, never mix fields across scopes', async () => {
    const f = fixture({ duplicate: true }); const r = await collectOnlineTourCatalogue(plan, f.backend);
    assert.equal(r.flights.length, 1); assert.equal(r.rawProducts.length, 1); assert.equal(r.duplicateCount, 3);
});
test('invalid plan and excessive months cannot create an unbounded crawl', async () => {
    for (const p of [{ ...plan, maxProductRequests: 101 }, { ...plan, regions: ['AS','AS'] },
        { ...plan, throughMonth: '202613' }, { ...plan, maxMonthsPerCity: 13 }, { ...plan, surprise: true }])
        assert.throws(() => parseCataloguePlan(p));
    const f = fixture(); const r = await collectOnlineTourCatalogue({ ...plan, maxMonthsPerCity: 1 }, f.backend);
    assert.equal(r.status, 'failed'); assert.equal(r.failure, 'month_budget_exhausted'); assert.equal(r.productRequests, 1);
});
test('checkpoint failure preserves completed rows and stops subsequent requests', async () => {
    const f = fixture(); const r = await collectOnlineTourCatalogue(plan, f.backend, async () => { throw new Error('checkpoint_failed'); });
    assert.equal(r.status, 'failed'); assert.equal(r.flights.length, 1); assert.equal(r.productRequests, 1);
});
test('real list adapter consumes current region seed without reload or product permission', async () => {
    const c = new FakeCdp();
    const s = { departure: 'ICN', city: 'PQC', month: '202609' };
    const a = await createOnlineTourBrowserAdapter(c, { seed: { scope: s, page: { pageNo: 1, totalCount: 1, lastPage: 1,
        rawProducts: [validRow('seed')], nextPageAvailable: true } } });
    const p = await a.readPage(s, 1, 1);
    assert.equal(p.rawProducts[0].event_code, 'seed'); assert.equal(a.diagnostics.permittedProductRequests, 0);
    assert.ok(!c.calls.some(x => ['Page.reload','Fetch.enable'].includes(x.method))); await a.close();
});
test('seed cannot be reused after the screen changes or carries a different next-page state', async () => {
    const c = new FakeCdp(); const s = { departure: 'ICN', city: 'PQC', month: '202609' };
    const a = await createOnlineTourBrowserAdapter(c, { seed: { scope: s, page: { pageNo: 1, totalCount: 1, lastPage: 1,
        rawProducts: [validRow('seed')], nextPageAvailable: false } } });
    await assert.rejects(a.readPage(s, 1, 1), /seed_screen_changed/);
    assert.equal(a.diagnostics.actions, 0); assert.equal(a.failureKind, 'validation'); await a.close();
});
test('catalogue writes isolated checkpoints and never changes operational data', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'online-catalogue-'));
    try {
        fs.mkdirSync(path.join(root, 'data')); const operational = path.join(root, 'data', 'all-flights-cache.json');
        fs.writeFileSync(operational, 'ORIGINAL');
        const f = fixture(); const summary = await executeCatalogue(root, plan, f.backend, true);
        assert.equal(summary.offlineOnly, true); assert.equal(summary.checkpoints.length, 4);
        assert.equal(fs.readFileSync(operational, 'utf8'), 'ORIGINAL');
        const saved = JSON.parse(fs.readFileSync(path.join(root, '.local-crawler', 'staging', summary.runId, 'summary.json'), 'utf8'));
        assert.equal(saved.status, 'review_ready'); assert.equal(saved.productionReady, false);
        assert.ok(saved.scopeResults.every((s: any) => !s.rawProducts && !s.flights));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('CLI requires explicit plan and consent; local cooldowns cannot be bypassed', () => {
    assert.deepEqual(parseCatalogueArgs(['--help']), { mode: 'help' });
    assert.equal(parseCatalogueArgs(['--check-plan','--plan','local.json']).mode, 'check');
    for (const args of [[],['--run'],['--run','--plan','local.json'],['--scheduled'],['--force']])
        assert.throws(() => parseCatalogueArgs(args));
    const now = Date.parse('2026-09-07T02:00:00Z');
    assert.throws(() => checkValidationCooldown(null, null, now));
    assert.throws(() => checkValidationCooldown({}, { nextProbeAt: 'invalid' }, now));
    assert.throws(() => checkValidationCooldown({ sourceCircuits: { onlinetour: { localFallback: { nextProbeAt: '2026-09-08T02:00:00Z' } } } }, null, now));
    assert.throws(() => checkValidationCooldown({}, { nextProbeAt: '2026-09-08T02:00:00Z' }, now));
    assert.doesNotThrow(() => checkValidationCooldown({}, { nextProbeAt: '2026-09-06T02:00:00Z' }, now));
});
test('excluded verified city is never reopened or requeried and new region still collects', async () => {
    const f = fixture();
    const r = await collectOnlineTourCatalogue({...plan,excludeCities:['PQC'],maxRetries:0},f.backend);
    assert.equal(r.status,'review_ready');
    assert.ok(!f.requests.some(s => s.startsWith('PQC:')));
    assert.equal(r.productRequests,2);
    assert.ok(r.deferred.some(d => d.city === 'PQC' && d.reason === 'excluded_by_plan_no_requery'));
});
test('catalogue retains the observed regional departure instead of forcing ICN', async () => {
    const f = fixture({departure:'GMP'});
    const r = await collectOnlineTourCatalogue({...plan,regions:['AS'],maxRetries:0},f.backend);
    assert.equal(r.status,'review_ready');
    assert.ok(r.traversals.every(t => t.scopes.every(s => s.scope.departure === 'GMP')));
});
test('window candidates are saved separately while original monthly evidence is preserved', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'online-window-'));
    try {
        const f = fixture();
        const summary = await executeCatalogue(root,{...plan,departureWindow:{from:'2026-10-01',through:'2026-10-31'}},f.backend,true);
        const dir = path.join(root,'.local-crawler','staging',summary.runId);
        const raw = JSON.parse(fs.readFileSync(path.join(dir,'flights.json'),'utf8'));
        const eligible = JSON.parse(fs.readFileSync(path.join(dir,'eligible-flights.json'),'utf8'));
        assert.equal(summary.uniqueCount,raw.length);
        assert.deepEqual(eligible,eligibleDepartures(raw,{from:'2026-10-01',through:'2026-10-31'}));
        assert.equal(summary.eligibleCount + summary.outsideDepartureWindowCount,summary.uniqueCount);
        assert.equal(summary.productionReady,false);
    } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
