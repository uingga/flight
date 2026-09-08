import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectModeBrowser, modeBrowserPlan, modePageUrl, modeRowToFlight, validateModeListUrl,
    validateModePlan, MODE_LIST_URL, isModeListPreflight, type ModePlan, type ModeScope } from '../src/lib/modetour-browser';
import { checkModeCooldown, canResumeModePreflight } from './crawl-modetour-browser';
import { validateModeBundle, MODE_REMOTE_PROTOCOL } from '../src/lib/modetour-operational';
import { evaluatePcCollection } from './pc-collection-policy.mjs';

const plan = modeBrowserPlan(new Date('2026-09-07T00:00:00Z'));
test('shuffled operational bundle validates on A, not only on B', async () => {
    const shuffled=modeBrowserPlan(new Date('2026-09-07T00:00:00Z'),'round-a');
    const raw=Object.fromEntries(shuffled.scopes.map(s=>[s.continent+'/'+s.city,s.continent==='JPN'?[row()]:[]]));
    const result=await collectModeBrowser(shuffled,backend(),async()=>{},[],{cached:raw,failed:[],previousRequests:15});
    const now=Date.parse('2026-09-07T05:40:00Z');
    const checked=await validateModeBundle({protocol:MODE_REMOTE_PROTOCOL,capturedAt:new Date(now).toISOString(),plan:shuffled,raw,result},[],{},now);
    assert.equal(checked.flights.length,1);
});
test('operational bundle revalidates raw rows, retains only TPE and rejects missing scopes or tampering', async () => {
    const raw=Object.fromEntries(plan.scopes.filter(s=>s.city!=='TPE').map(s=>[s.continent+'/'+s.city,s.continent==='JPN'?[row()]:[]]));
    const result=await collectModeBrowser(plan,backend(),async()=>{},[],{cached:raw,failed:[{scope:'CHI/TPE',status:500}],previousRequests:15});
    const now=Date.parse('2026-09-07T05:40:00Z');
    const bundle={protocol:MODE_REMOTE_PROTOCOL,capturedAt:new Date(now).toISOString(),plan,raw,result};
    const retained=modeRowToFlight(row('tpe','TPE'),{continent:'CHI',city:'TPE'},plan)!;
    const checked=await validateModeBundle(bundle,[retained],{},now);
    assert.equal(checked.retained[0],retained); assert.equal(checked.flights.length,1); assert.equal(checked.partial,true);
    for (const change of [(b:any)=>delete b.raw['CHI/TAO'],(b:any)=>b.result.flights[0].price=1,
        (b:any)=>b.result.failed[0].scope='CHI/KHH',(b:any)=>b.capturedAt='2026-09-06T00:00:00Z']) {
        const bad=JSON.parse(JSON.stringify(bundle));change(bad); await assert.rejects(validateModeBundle(bad,[],{},now));
    }
    await assert.rejects(validateModeBundle(bundle,[],{'JPN/':30},now),/source_count_collapse/);
});
test('PC primary waits for upstream, runs four slots once and never overrides a cooldown',()=>{
    const onlineOff={enabled:false,slotsPerDay:4};
    for(const hour of ['2026-09-07T00:00:00Z','2026-09-07T03:00:00Z','2026-09-07T06:00:00Z','2026-09-07T09:00:00Z']) {
        const cache:any={fullCrawlUpdatedAt:hour,sourceCircuits:{}};
        const check=()=>evaluatePcCollection({cache,now:hour,config:onlineOff,ttangConfig:{enabled:false,slotsPerDay:2}});
        assert.deepEqual(check().sources,['modetour']);
        cache.modetourPrimary={lastAttemptAt:hour}; assert.deepEqual(check().sources,[]);
        delete cache.modetourPrimary; cache.sourceCircuits.modetour={nextProbeAt:'2026-09-08T00:00:00Z'};
        assert.deepEqual(check().sources,[]);
    }
    assert.equal(evaluatePcCollection({cache:{fullCrawlUpdatedAt:'2026-09-06T00:00:00Z'},now:'2026-09-07T06:00:00Z',config:onlineOff}).shouldRun,false);
});
test('continuation reuses five checkpoints, skips attempted TPE and queries only nine remaining cities', async () => {
    const cached = Object.fromEntries(plan.scopes.slice(0, 5).map(s => [s.continent + '/', s.continent === 'JPN' ? [row()] : []]));
    const visited: string[] = [];
    const b = { wait: async () => {}, read: async (s: ModeScope) => {
        visited.push(s.city);
        return { url: listUrl(s), status: 200,
            contentType: 'application/json', body: JSON.stringify({ result: [] }) };
    } };
    const result = await collectModeBrowser(plan, b, async () => {}, [],
        { cached, failed: [{ scope: 'CHI/TPE', status: 500 }], previousRequests: 6 });
    assert.deepEqual(visited, plan.scopes.slice(6).map(s => s.city));
    assert.equal(result.listRequests, 15); assert.equal(result.newListRequests, 9);
    assert.equal(result.reusedScopes, 5); assert.equal(result.flights.length, 1);
    assert.equal(result.status, 'incomplete'); assert.equal(result.failed.length, 1);
    assert.equal(result.productionReady, false);
});
test('continuation cannot reset budget or proceed after CAPTCHA even inside HTTP 500', async () => {
    const cached = Object.fromEntries(plan.scopes.slice(0, 5).map(s => [s.continent + '/', []]));
    const c = { cached, failed: [{ scope: 'CHI/TPE', status: 500 }], previousRequests: 6 };
    const b = backend();
    await assert.rejects(collectModeBrowser(plan, b, async () => {}, [], { ...c, previousRequests: 0 }), /invalid_continuation/);
    assert.equal(b.calls, 0);
    let requests = 0;
    await assert.rejects(collectModeBrowser(plan, { wait: async () => {}, read: async s => {
        requests++; return { url: listUrl(s), status: 500, contentType: 'text/html', body: 'CAPTCHA Access denied' };
    } }, async () => {}, [], c), /access_restriction/);
    assert.equal(requests, 1);
});
test('parameter-free OPTIONS is preflight only; GET and another endpoint are not exempt', () => {
    assert.equal(isModeListPreflight('OPTIONS', MODE_LIST_URL), true);
    assert.equal(isModeListPreflight('GET', MODE_LIST_URL), false);
    assert.equal(isModeListPreflight('OPTIONS', 'https://example.com/DiscountFlight/GetList'), false);
    assert.throws(() => validateModeListUrl(MODE_LIST_URL, plan, plan.scopes[0]));
});
test('preflight continuation cannot retry any site access or uncertain browser failure', () => {
    assert.equal(canResumeModePreflight({ productionReady: false, reason: 'dedicated_chrome_owner_unverified' }), true);
    for (const reason of ['access_restriction', 'list_timeout', 'empty_catalogue', 'browser_read_failure'])
        assert.equal(canResumeModePreflight({ productionReady: false, reason }), false);
    assert.equal(canResumeModePreflight({ productionReady: false, reason: 'dedicated_chrome_owner_unverified', diagnostics: {} }), false);
});
function listUrl(scope: ModeScope, p: ModePlan = plan) {
    const u = new URL(MODE_LIST_URL);
    Object.entries({ ContinentCode: scope.continent, ArrivalCity: scope.city, DepartureCity: '',
        DepartureDate: p.from, ArrivalDate: p.through, Page: '1', ItemCount: '500' })
        .forEach(([k, v]) => u.searchParams.set(k, v));
    return u.href;
}
// Synthetic contract data: not presented as a captured/live browser response.
function row(id = '123', airport = 'HND'): any {
    return { stockPackageNo: id, air: { value: '대한항공' }, adult: { value: '200000', tax: '10000', tax2: '20000' },
        departure: { value: '김포', code: 'GMP' }, arrival: { value: '도쿄', code: airport },
        sDate: { value: '2026-10-02', sTime: '09:00' }, eDate: { value: '2026-10-05', sTime: '13:00' },
        start: { via: 'N' }, rSeat: { value: '4' } };
}
function backend(transform: (scope: ModeScope, index: number) => any[] = () => []) {
    let calls = 0;
    return { get calls() { return calls; }, wait: async () => {}, read: async (scope: ModeScope) => ({
        url: listUrl(scope), status: 200, contentType: 'application/json',
        body: JSON.stringify({ result: transform(scope, calls++) }),
    }) };
}
test('15 scopes, China never all, Japan included, native tomorrow-through-next-month window', () => {
    validateModePlan(plan);
    assert.equal(plan.from, '2026-09-08'); assert.equal(plan.through, '2026-10-08'); assert.equal(plan.scopes.length, 15);
    assert.equal(plan.scopes.filter(s => s.continent === 'CHI').length, 10);
    assert.ok(plan.scopes.some(s => s.continent === 'JPN'));
    assert.ok(plan.scopes.filter(s => s.continent === 'CHI').every(s => s.city));
    const query = JSON.parse(new URL(modePageUrl(plan, plan.scopes[0])).searchParams.get('query')!);
    assert.equal(query.arrivalDate, '2026-10-08');
});
test('KST and year rollover', () => {
    const p = modeBrowserPlan(new Date('2026-12-31T16:00:00Z'));
    assert.equal(p.from, '2027-01-02'); assert.equal(p.through, '2027-02-02');
    const end = modeBrowserPlan(new Date('2027-01-30T00:00:00Z'));
    assert.equal(end.from, '2027-01-31'); assert.equal(end.through, '2027-02-28');
});
test('missing/duplicated region and budget changes rejected offline', () => {
    assert.throws(() => validateModePlan({ ...plan, scopes: plan.scopes.slice(1) }));
    assert.throws(() => validateModePlan({ ...plan, scopes: [...plan.scopes.slice(1), plan.scopes[1]] }));
    assert.throws(() => validateModePlan({ ...plan, maxListRequests: 40 }));
});
test('request scope, duplicates and wrong host rejected', () => {
    const s = plan.scopes[0], url = listUrl(s);
    assert.equal(validateModeListUrl(url, plan, s), 500);
    const native = new URL(url);
    for (const [k,v] of Array.from(native.searchParams.entries())) {
        native.searchParams.delete(k); native.searchParams.set(k[0].toLowerCase() + k.slice(1), v);
    }
    assert.equal(validateModeListUrl(native.href, plan, s), 500);
    assert.throws(() => validateModeListUrl(native.href + '&Page=1', plan, s));
    for (const bad of [url.replace('ASIA', 'CHI'), url + '&Page=1', url.replace('b2c-api.modetour.com', 'example.com'),
        url.replace('2026-10-08', '2026-10-06'), url.replace('ItemCount=500', 'ItemCount=1000')])
        assert.throws(() => validateModeListUrl(bad, plan, s));
});
test('tax-inclusive fare, distinct return times, no invented return directness', () => {
    const f = modeRowToFlight(row(), { continent: 'JPN', city: '' }, plan)!;
    assert.equal(f.price, 230000); assert.equal(f.arrival.time, '13:00');
    assert.equal(f.modetourDetail?.isDirect, true); assert.equal(f.modetourDetail?.isReturnDirect, undefined);
    assert.equal(f.id, 'modetour-JPN-123');
});
test('malformed money/time/date/id, wrong China city fail rather than disappear', () => {
    for (const mutate of [(r: any) => r.adult.tax = undefined, (r: any) => r.adult.value = '20x',
        (r: any) => r.sDate.sTime = '24:00', (r: any) => r.sDate.value = '2026-02-30',
        (r: any) => r.stockPackageNo = undefined]) {
        const r = row(); mutate(r); assert.throws(() => modeRowToFlight(r, plan.scopes[1], plan));
    }
    assert.throws(() => modeRowToFlight(row(), { continent: 'CHI', city: 'TPE' }, plan));
});
test('departure window, zero seats and one-way are explicit exclusions', () => {
    const r = row(); r.sDate.value = '2026-11-07'; assert.equal(modeRowToFlight(r, plan.scopes[1], plan), null);
    r.sDate.value = '2026-10-02'; r.rSeat.value = '0'; assert.equal(modeRowToFlight(r, plan.scopes[1], plan), null);
    r.rSeat.value = '1'; r.eDate.value = r.sDate.value; assert.equal(modeRowToFlight(r, plan.scopes[1], plan), null);
});
test('reads all 15 scopes once even if first scope empty; keeps October Japan', async () => {
    const b = backend(s => s.continent === 'JPN' ? [row()] : []);
    const result = await collectModeBrowser(plan, b);
    assert.equal(b.calls, 15); assert.equal(result.flights.length, 1); assert.equal(result.productionReady, false);
});
test('empty catalogue, full page and conflicting duplicate never succeed', async () => {
    await assert.rejects(collectModeBrowser(plan, backend()), /empty_catalogue/);
    const full = backend(() => Array.from({ length: 500 }, (_, i) => row(String(i))));
    await assert.rejects(collectModeBrowser(plan, full), /pagination_requires_review/); assert.equal(full.calls, 1);
    const dup = backend(() => [row(), { ...row(), adult: { value: '1', tax: '0', tax2: '0' } }]);
    await assert.rejects(collectModeBrowser(plan, dup), /conflicting_product/); assert.equal(dup.calls, 1);
});
test('access block, invalid content, timeout stop without next scope or retry', async () => {
    for (const kind of ['http', 'body', 'content', 'timeout']) {
        let calls = 0;
        const b = { wait: async () => {}, read: async (s: ModeScope) => {
            calls++; if (kind === 'timeout') throw new Error('list_timeout');
            return { url: listUrl(s), status: kind === 'http' ? 403 : 200,
                contentType: kind === 'content' ? 'text/html' : 'application/json',
                body: kind === 'body' ? 'Access denied CAPTCHA' : JSON.stringify({ result: [] }) };
        } };
        await assert.rejects(collectModeBrowser(plan, b)); assert.equal(calls, 1);
    }
});
test('active or malformed GitHub/PC cooldown blocks and never mutates state', () => {
    const cache = { flights: [], sourceCircuits: { modetour: { nextProbeAt: '2099-01-01' } } };
    const before = JSON.stringify(cache); assert.throws(() => checkModeCooldown(cache, null));
    assert.equal(JSON.stringify(cache), before);
    assert.throws(() => checkModeCooldown({ flights: [], sourceCircuits: {} }, { nextProbeAt: 'bad' }));
    checkModeCooldown({ flights: [], sourceCircuits: {} }, null);
    assert.throws(() => checkModeCooldown({}, null));
});
test('previously present city/region cannot silently become empty; stop before more requests', async () => {
    const f = modeRowToFlight(row(), plan.scopes[0], plan)!;
    const b = backend();
    await assert.rejects(collectModeBrowser(plan, b, async () => {}, [f]), /source_count_collapse/);
    assert.equal(b.calls, 1);
});
test('reported count mismatch requires pagination review even under the page size', async () => {
    const b = { wait: async () => {}, read: async (s: ModeScope) => ({ url: listUrl(s), status: 200,
        contentType: 'application/json', body: JSON.stringify({ result: [row()], totalCount: 2 }) }) };
    await assert.rejects(collectModeBrowser(plan, b), /pagination_requires_review/);
});
