import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { validRow } from './test-onlinetour-browser-adapter';
import type { CdpClient } from '../src/lib/onlinetour-browser-adapter';

const LIST = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
const API = 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list';
class Element {
    hidden = false; disabled = false; clicked = 0;
    constructor(readonly tagName: string, readonly attrs: Record<string, string>, public action = () => {}) {}
    getAttribute(k: string) { return this.attrs[k] ?? null; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    click() { this.clicked++; this.action(); }
}
class Fake implements CdpClient {
    calls: { method: string; params: any; sessionId?: string }[] = [];
    listeners = new Set<(e: any) => void>();
    url = LIST; region = 'AS'; city = 'PQC'; body = '목록'; loading = false; ready = 'complete'; page = '2'; closed = false;
    onClick: (region: string) => void = () => {};
    elements = ['AS','CH','JA','EU','HN','US','GS'].map(code => new Element('A', { onclick: `goDcair('${code}');` }, () => this.onClick(code)));
    context: vm.Context;
    bodies = new Map<string, string>();
    pending = new Map<string, () => void>();
    constructor() {
        const self = this;
        this.elements.push(new Element('INPUT', { name: 'city', onclick: "javascript:goSelectedCity('PQC','20260907');" }));
        this.elements.push(new Element('BUTTON', { onclick: 'javascript:nextMonth(2026,10)' }));
        this.context = vm.createContext({ URL,
            location: { get href() { return self.url; } },
            document: {
                get readyState() { return self.ready; }, get body() { return { innerText: self.body }; },
                querySelector(s: string) { if (s === '#pageNo') return { value: self.page }; if (s === '#pageSize') return { value: '20' }; return null; },
                querySelectorAll(s: string) { if (s === '[onclick]') return self.elements; if (s.includes('loading')) return self.loading ? [new Element('DIV', {})] : []; return []; },
            }, getComputedStyle: (e: Element) => ({ display: e.hidden ? 'none' : 'block', visibility: 'visible' }),
        });
        vm.runInContext('window = globalThis', this.context);
    }
    emit(method: string, params: any, sessionId = 'session') { Array.from(this.listeners).forEach(fn => fn({ method, params, sessionId })); }
    async send(method: string, params: any = {}, sessionId?: string): Promise<any> {
        this.calls.push({ method, params, sessionId });
        if (method === 'Target.getTargets') return { targetInfos: [{ type: 'page', targetId: 'target', url: this.url }, { type: 'page', targetId: 'private', url: 'https://myaccount.google.com/' }] };
        if (method === 'Target.attachToTarget') { assert.equal(params.targetId, 'target'); return { sessionId: 'session' }; }
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: this.url } } };
        if (method === 'Runtime.evaluate') {
            vm.runInContext(`getDcairMainList = function() { var TabGubun = '${this.region}'; var airSect = 'ICN'; var SelectedCityCd = '${this.city}'; var nowYear = '2026'; var nowMonth = '09'; var nowDay = ''; var order = 'LP'; var view = ''; throw Error('must never execute source'); }`, this.context);
            return { result: { value: vm.runInContext(params.expression, this.context) } };
        }
        if (method === 'Fetch.continueRequest') { assert.deepEqual(Object.keys(params), ['requestId']); const next = this.pending.get(params.requestId); this.pending.delete(params.requestId); next?.(); }
        if (method === 'Fetch.failRequest') this.pending.delete(params.requestId);
        if (method === 'Fetch.disable') assert.equal(this.pending.size, 0);
        if (method === 'Network.getResponseBody') return { body: this.bodies.get(params.requestId), base64Encoded: false };
        return {};
    }
    onEvent(fn: (e: any) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
    async close() { this.closed = true; }
}
const tests: [string, () => Promise<void>][] = [];
const test = (name: string, run: () => Promise<void>) => tests.push([name, run]);
let mod: typeof import('../src/lib/onlinetour-region-discovery');
test('read-only real VM inspection, exact controls, nullable empty scope, private-tab isolation', async () => {
    assert.ok(fs.existsSync('src/lib/onlinetour-region-discovery.ts'), 'regional discovery implementation must exist');
    mod = await import('../src/lib/onlinetour-region-discovery');
    const c = new Fake();
    c.elements.push(new Element('A', { onclick: "goDcair('ZZ');evil()" }));
    const hidden = new Element('A', { onclick: "goDcair('QQ');" }); hidden.hidden = true; c.elements.push(hidden);
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    const s = await a.inspect();
    assert.deepEqual(s.availableRegions, ['AS','CH','JA','EU','HN','US','GS']);
    assert.equal(s.region, 'AS'); assert.deepEqual(s.currentScope, { departure: 'ICN', city: 'PQC', month: '202609' });
    assert.deepEqual(s.cities, [{ code: 'PQC', firstDepartureDate: '20260907' }]);
    assert.ok(s.monthCandidates.includes('202610'));
    c.city = ''; c.elements = c.elements.filter(e => e.tagName === 'A');
    const empty = await a.inspect(); assert.equal(empty.currentScope, null); assert.deepEqual(empty.cities, []);
    assert.ok(!c.calls.some(x => /Fetch\.|Page.navigate|Page.reload|Page.stopLoading/.test(x.method)));
    assert.ok(c.calls.filter(x => x.method === 'Runtime.evaluate').every(x => x.sessionId === 'session'));
    assert.equal(a.diagnostics.actions, 0); await a.close(); assert.ok(c.closed);
    assert.ok(!c.calls.some(x => /closeTarget|Browser.close|createTarget/.test(x.method)));
});
function api(region: string, change: Record<string, string> = {}) { return API + '?' + new URLSearchParams({ transportStartCity: 'ICN', transportEndCity: 'PQC', eventStartMonth: '202609', eventStartDate: '', areaCode: region, order: 'LP', pageNo: '1', pageSize: '20', pageYn: 'Y', depPyunStr: '', statusStr: '', callback: 'cb', ...change }); }
let sequence = 0;
function request(c: Fake, url: string, type: string, body: string, after = () => {}, status = 200) {
    const id = 'r' + ++sequence;
    c.pending.set(id, () => {
        c.emit('Network.requestWillBeSent', { requestId: id, frameId: 'main', type, request: { url, method: 'GET' } });
        c.bodies.set(id, body);
        c.emit('Network.responseReceived', { requestId: id, frameId: 'main', type, response: { url, status } });
        c.emit('Network.loadingFinished', { requestId: id, encodedDataLength: body.length });
        after();
    });
    c.emit('Fetch.requestPaused', { requestId: id, networkId: id, frameId: 'main', resourceType: type, request: { url, method: 'GET' } });
}
const payload = 'cb(' + JSON.stringify({ status: 200, data: { list: [{ event_code: 'offline-1', adult_price: 90000, cookie: 'secret-cookie', link: 'https://example.com/?token=secret' }], paging: { curPage: 1, totalLastPage: 2, totalCount: 21 } } }) + ');';
const malformedPayload = payload;
const goodPayload = 'cb(' + JSON.stringify({ status: 200, data: { list: [{ ...validRow('offline-1'), cookie: 'secret-cookie', link: 'https://example.com/?token=secret' }], paging: { curPage: 1, totalLastPage: 2, totalCount: 21 } } }) + ');';
function navigate(c: Fake, region: string, empty = false) {
    request(c, LIST + '?TabGubun=' + region + '&SelectedCityCd=', 'Document', '<!doctype html><html><body>목록</body></html>', () => {
        c.url = LIST + '?TabGubun=' + region + '&SelectedCityCd='; c.region = region;
        if (empty) { c.city = ''; c.elements = c.elements.filter(e => e.tagName === 'A'); }
        else request(c, api(region), 'Script', goodPayload);
    });
}
test('one observed region click yields validated document and sanitized first-page evidence', async () => {
    const c = new Fake(); c.onClick = code => navigate(c, code);
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    const result = await a.visitRegion('CH');
    assert.equal(result.snapshot.region, 'CH'); assert.equal(result.firstPage?.totalCount, 21); assert.equal(result.firstPage?.pageNo, 1);
    assert.equal(result.firstPage?.rawProducts[0].event_code, 'offline-1');
    assert.ok(!JSON.stringify(result).includes('secret'));
    assert.deepEqual(a.diagnostics, { actions: 1, documentRequests: 1, permittedDocumentRequests: 1, productRequests: 1, permittedProductRequests: 1, blockedRequests: 0 });
    assert.equal(c.elements[1].clicked, 1);
    const patterns = c.calls.find(x => x.method === 'Fetch.enable')!.params.patterns;
    assert.ok(patterns.some((x: any) => x.resourceType === 'Document' && x.urlPattern === '*'));
    await assert.rejects(a.visitRegion('CH')); assert.equal(a.diagnostics.actions, 1); await a.close();
});
test('genuinely empty region succeeds without invented city or product request', async () => {
    const c = new Fake(); c.onClick = code => navigate(c, code, true);
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    const result = await a.visitRegion('EU'); assert.equal(result.firstPage, null); assert.equal(result.snapshot.currentScope, null); assert.deepEqual(result.snapshot.cities, []);
    assert.equal(a.diagnostics.permittedProductRequests, 0); await a.close();
});
test('malformed product rows fail rather than becoming successful evidence', async () => {
    const c = new Fake(); c.onClick = code => {
        request(c, LIST + '?TabGubun=' + code + '&SelectedCityCd=', 'Document', '<html></html>', () => { c.region = code; request(c, api(code), 'Script', payload); });
    };
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    await assert.rejects(a.visitRegion('CH'), /invalid_product_rows/); await a.close();
});
for (const [label, url] of [
    ['external', 'https://example.com/'], ['credentials', LIST.replace('www.', 'u:p@www.') + '?TabGubun=CH&SelectedCityCd='],
    ['wrong region', LIST + '?TabGubun=JA&SelectedCityCd='], ['duplicate region', LIST + '?TabGubun=CH&TabGubun=CH&SelectedCityCd='],
]) test('pretransmission document guard: ' + label, async () => {
    const c = new Fake(); c.onClick = () => request(c, url, 'Document', '<html></html>');
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    await assert.rejects(a.visitRegion('CH')); assert.equal(a.diagnostics.permittedDocumentRequests, 0); assert.equal(a.diagnostics.blockedRequests, 1);
    await assert.rejects(a.visitRegion('JA')); assert.equal(a.diagnostics.actions, 1); await a.close();
});
for (const [key, value] of Object.entries({ areaCode: 'JA', pageNo: '2', pageSize: '21', pageYn: 'N', order: 'HP', eventStartDate: '20260907', transportStartCity: 'PUS', transportEndCity: 'bad', eventStartMonth: '202613', callback: 'cb();evil()', unknown: 'secret' })) test('pretransmission API guard: ' + key, async () => {
    const c = new Fake(); c.onClick = code => request(c, LIST + '?TabGubun=' + code + '&SelectedCityCd=', 'Document', '<html></html>', () => { c.region = code; request(c, api(code, { [key]: value }), 'Script', goodPayload); });
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    await assert.rejects(a.visitRegion('CH')); assert.equal(a.diagnostics.permittedProductRequests, 0); assert.equal(a.diagnostics.blockedRequests, 1); await a.close();
});
for (const kind of ['Document','Script']) test('simultaneous second ' + kind + ' blocked atomically', async () => {
    const c = new Fake(); c.onClick = code => {
        navigate(c, code);
        if (kind === 'Document') request(c, LIST + '?TabGubun=' + code + '&SelectedCityCd=', kind, '<html></html>');
        else queueMicrotask(() => request(c, api(code), kind, goodPayload));
    };
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    await assert.rejects(a.visitRegion('CH')); assert.ok(a.diagnostics.permittedDocumentRequests <= 1); assert.ok(a.diagnostics.permittedProductRequests <= 1); assert.ok(a.diagnostics.blockedRequests >= 1); await a.close();
});
for (const status of [401,403,429,500]) test('HTTP failure latches: ' + status, async () => {
    const c = new Fake(); c.onClick = code => request(c, LIST + '?TabGubun=' + code + '&SelectedCityCd=', 'Document', '<html></html>', () => {}, status);
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    await assert.rejects(a.visitRegion('CH')); await assert.rejects(a.visitRegion('JA')); assert.equal(a.diagnostics.actions, 1); await a.close();
});
test('idle timeout rejects empty loading document, and preserves safe reason', async () => {
    const c = new Fake(); c.onClick = code => { navigate(c, code, true); c.loading = true; };
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    const now = Date.now; let tick = now(); Date.now = () => tick += 20000;
    try { await assert.rejects(a.visitRegion('CH'), /idle_deadline/); } finally { Date.now = now; await a.close(); }
});
test('unrelated session and response IDs never read, inspect restriction never stops page', async () => {
    const c = new Fake(); const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    c.emit('Network.responseReceived', { requestId: 'private', response: { url: API, status: 429 } }, 'private');
    c.emit('Network.loadingFinished', { requestId: 'stale', encodedDataLength: 12 });
    assert.equal((await a.inspect()).restricted, false); c.body = 'CAPTCHA'; assert.equal((await a.inspect()).restricted, true);
    await assert.rejects(a.visitRegion('CH')); await a.close();
    assert.ok(!c.calls.some(x => /getResponseBody|stopLoading|Fetch/.test(x.method)));
});
for (const failed of ['Fetch.disable','Target.detachFromTarget']) test('cleanup failure is observable: ' + failed, async () => {
    const c = new Fake(); c.onClick = code => navigate(c, code, true);
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 }); await a.visitRegion('EU');
    const send = c.send.bind(c); c.send = async (m, p, s) => { if (m === failed) throw Error('sensitive transport message'); return send(m,p,s); };
    await assert.rejects(a.close(), /cleanup_failed/); assert.ok(c.closed);
});
test('shared six-document and six-product budgets cannot be reset or exceeded', async () => {
    const c = new Fake(); c.onClick = code => navigate(c, code); const options = { maxNavigations: 6, maxProductRequests: 6 };
    const a = await mod.createOnlineTourRegionDiscovery(c, options); const now = Date.now; let tick = now(); Date.now = () => tick += 6000;
    try {
        for (const code of ['CH','JA','EU','HN','US','GS']) await a.visitRegion(code);
        options.maxNavigations = 99; a.diagnostics.actions = 0;
        await assert.rejects(a.visitRegion('AS'), /budget_exhausted/);
        assert.equal(a.diagnostics.permittedDocumentRequests, 6); assert.equal(a.diagnostics.permittedProductRequests, 6); assert.equal(a.diagnostics.actions, 6);
    } finally { Date.now = now; await a.close(); }
});
test('failed Fetch abort is not retried or released by disable, cleanup rejects', async () => {
    const c = new Fake(); c.onClick = () => request(c, 'https://example.com/', 'Document', '<html></html>');
    const send = c.send.bind(c); c.send = async (m,p,s) => { if (m === 'Fetch.failRequest') { c.calls.push({ method: m, params: p, sessionId: s }); throw Error('private'); } return send(m,p,s); };
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    await assert.rejects(a.visitRegion('CH')); await assert.rejects(a.close(), /cleanup_failed/); assert.ok(c.closed);
    assert.equal(c.calls.filter(x => x.method === 'Fetch.failRequest').length, 1); assert.ok(!c.calls.some(x => x.method === 'Fetch.disable'));
});
test('socket close failure rejects cleanup without leaking transport error', async () => {
    const c = new Fake(); const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    c.close = async () => { c.closed = true; throw Error('private'); }; await assert.rejects(a.close(), /^RegionDiscoveryError: cleanup_failed$/);
});
test('late DOM mismatch preserves validated first-page evidence, not successful result', async () => {
    const c = new Fake(); c.onClick = code => { navigate(c, code); c.city = 'NRT'; };
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    await assert.rejects(a.visitRegion('CH'), /final_scope_mismatch/); assert.equal(a.partialEvidence.length, 1);
    assert.deepEqual(a.partialEvidence[0].rawProducts[0], validRow('offline-1')); await a.close();
});
test('redirect observed before Fetch guard latches and permits nothing', async () => {
    const c = new Fake(); c.onClick = code => { c.emit('Network.requestWillBeSent', { requestId: 'early', type: 'Document', redirectResponse: { status: 302 }, request: { url: LIST } }); navigate(c, code); };
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 });
    await assert.rejects(a.visitRegion('CH'), /unexpected_redirect/); assert.equal(a.diagnostics.permittedDocumentRequests, 0); await a.close();
});
test('duplicate API query is blocked, CAPTCHA body cannot become empty region', async () => {
    for (const kind of ['duplicate','captcha']) {
        const c = new Fake(); c.onClick = code => request(c, LIST + '?TabGubun=' + code + '&SelectedCityCd=', 'Document', kind === 'captcha' ? '<html>CAPTCHA</html>' : '<html></html>', () => { c.region = code; if (kind === 'duplicate') request(c, api(code) + '&transportEndCity=PQC', 'Script', goodPayload); });
        const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 6, maxProductRequests: 6 }); await assert.rejects(a.visitRegion('CH')); await a.close();
    }
});
test('a newly committed loading document is awaited instead of stopped as malformed', async () => {
    class LoadingDoc extends Fake {
        async send(method: string, p: any = {}, s?: string) {
            if (method === 'Runtime.evaluate' && this.ready !== 'complete')
                return super.send(method, { ...p, expression: `(delete window.getDcairMainList, (${p.expression}))` }, s);
            return super.send(method, p, s);
        }
    }
    const c = new LoadingDoc();
    c.onClick = region => request(c, LIST + '?TabGubun=' + region + '&SelectedCityCd=', 'Document', '<html><head>', () => {
        c.url = LIST + '?TabGubun=' + region + '&SelectedCityCd='; c.region = region; c.ready = 'loading';
        setTimeout(() => { c.ready = 'complete'; request(c, api('CH'), 'Script', goodPayload); }, 60);
    });
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 1, maxProductRequests: 1 });
    try {
        const result = await a.visitRegion('CH');
        assert.equal(result.snapshot.region, 'CH'); assert.equal(result.firstPage?.rawProducts.length, 1);
        assert.equal(a.diagnostics.permittedDocumentRequests, 1); assert.equal(a.diagnostics.permittedProductRequests, 1);
        assert.equal(a.failure, null); assert.ok(!c.calls.some(x => x.method === 'Page.stopLoading'));
    } finally { await a.close(); }
});
test('completed malformed document remains a terminal failure', async () => {
    class InvalidDoc extends Fake {
        async send(method: string, p: any = {}, s?: string) {
            if (method === 'Runtime.evaluate' && this.region === 'CH')
                return super.send(method, { ...p, expression: `(delete window.getDcairMainList, (${p.expression}))` }, s);
            return super.send(method, p, s);
        }
    }
    const c = new InvalidDoc(); c.onClick = r => navigate(c, r, true);
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 1, maxProductRequests: 1 });
    await assert.rejects(a.visitRegion('CH'), /invalid_region_dom/);
    assert.equal(a.diagnostics.actions, 1); assert.equal(a.diagnostics.permittedProductRequests, 0); await a.close();
});
test('explicit recovery reload uses the same document and API budgets without an initial list function', async () => {
    class Recovery extends Fake {
        reloads = 0;
        async send(method: string, p: any = {}, s?: string) {
            if (method === 'Page.reload') { this.calls.push({ method, params: p, sessionId: s }); this.reloads++; assert.deepEqual(p, { ignoreCache: false }); navigate(this, 'CH'); return {}; }
            if (method === 'Runtime.evaluate' && this.reloads === 0)
                return super.send(method, { ...p, expression: `(delete window.getDcairMainList, (${p.expression}))` }, s);
            return super.send(method, p, s);
        }
    }
    const c = new Recovery(); c.region = 'CH'; c.url = LIST + '?TabGubun=CH&SelectedCityCd=';
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 1, maxProductRequests: 1 });
    assert.equal(typeof (a as any).reloadExistingRegion, 'function');
    try {
        const result = await (a as any).reloadExistingRegion('CH');
        assert.equal(result.snapshot.region, 'CH'); assert.equal(result.firstPage.rawProducts.length, 1);
        assert.equal(c.reloads, 1); assert.equal(a.diagnostics.permittedDocumentRequests, 1); assert.equal(a.diagnostics.permittedProductRequests, 1);
        await assert.rejects((a as any).reloadExistingRegion('CH')); assert.equal(c.reloads, 1);
    } finally { await a.close(); }
});
test('recovery never reloads a different region, a restricted page or an exhausted budget', async () => {
    for (const scenario of ['wrong_region', 'restricted', 'budget']) {
        const c = new Fake(); c.region = 'CH'; c.url = LIST + '?TabGubun=CH&SelectedCityCd=';
        if (scenario === 'restricted') c.body = 'CAPTCHA';
        const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: scenario === 'budget' ? 0 : 1, maxProductRequests: 1 });
        await assert.rejects((a as any).reloadExistingRegion(scenario === 'wrong_region' ? 'JA' : 'CH'));
        assert.ok(!c.calls.some(x => x.method === 'Page.reload')); assert.equal(a.diagnostics.permittedDocumentRequests, 0); await a.close();
    }
});
test('rejected request diagnostics distinguish frame and shape without retaining secrets', async () => {
    const c = new Fake();
    c.onClick = () => c.emit('Fetch.requestPaused', { requestId: 'reject', networkId: 'network', frameId: 'child', resourceType: 'Document', request: { method: 'POST', postData: 'SECRET', url: 'https://example.com/?token=SECRET', headers: { Cookie: 'SECRET' } } });
    const a = await mod.createOnlineTourRegionDiscovery(c, { maxNavigations: 1, maxProductRequests: 1 });
    try {
        await assert.rejects(a.visitRegion('CH'), /invalid_paused_request/);
        assert.deepEqual((a as any).lastRejectedRequest, { reason: 'invalid_paused_request', mainFrame: false, networkIdPresent: true, redirected: false, responseStage: false, method: 'POST', bodyPresent: true, urlKind: 'other', resourceKind: 'document' });
        assert.ok(!JSON.stringify((a as any).lastRejectedRequest).includes('SECRET'));
        assert.equal(a.diagnostics.permittedDocumentRequests, 0); assert.equal(a.diagnostics.blockedRequests, 1);
    } finally { await a.close(); }
});
async function main() { for (const [name, run] of tests) { await run(); console.log('PASS', name); } console.log(`${tests.length} offline region-discovery cases passed; site requests=0`); }
main().catch(e => { console.error(e); process.exitCode = 1; });
