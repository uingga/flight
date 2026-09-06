import type { CdpClient } from './onlinetour-browser-adapter';
export { connectNormalChrome } from './onlinetour-browser-adapter';
import { validatePilotResponse } from './onlinetour-browser-collector';
import type { ListScope } from './onlinetour-list-traversal';

export interface RegionSnapshot {
    region: string; cities: { code: string; firstDepartureDate: string }[];
    monthCandidates: string[]; availableRegions: string[]; currentScope: ListScope | null; restricted: boolean;
}
export interface RegionDiscoveryOptions { maxNavigations: number; maxProductRequests: number; }
export interface RegionDiagnostics {
    actions: number; documentRequests: number; permittedDocumentRequests: number;
    productRequests: number; permittedProductRequests: number; blockedRequests: number;
}
export interface RegionFirstPage { scope: ListScope; pageNo: 1; totalCount: number; lastPage: number; rawProducts: Record<string, unknown>[]; }
export interface RegionDiscoveryResult { snapshot: RegionSnapshot; firstPage: RegionFirstPage | null; }
export interface RegionFailure { reason: string; phase: 'discovery' | 'cleanup'; region: string | null; }
export class RegionDiscoveryError extends Error {
    readonly name = 'RegionDiscoveryError';
    constructor(readonly reason: string, readonly partial: RegionDiscoveryResult | null = null) { super(reason); }
}
const LIST = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
const API = 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list';
const ACCESS = /captcha|access denied|request blocked|temporarily blocked|unusual traffic|비정상(?:적인)?\s*접근|자동화(?:된)?\s*요청|접근이?\s*제한|서비스\s*이용이?\s*제한/i;
const matches = (raw: string, expected: string) => { try { const u = new URL(raw); return !u.username && !u.password && u.origin + u.pathname === expected; } catch { return false; } };
const monthOK = (s: string) => /^[1-9]\d{3}(0[1-9]|1[0-2])$/.test(s);
const DOM_READ = String.raw`(() => {
    const u = new URL(location.href);
    if (u.username || u.password || u.origin + u.pathname !== 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList') return { outside: true };
    const visible = e => !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    const enabled = e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true';
    const source = typeof window.getDcairMainList === 'function' ? Function.prototype.toString.call(window.getDcairMainList) : '';
    const vars = {};
    for (const name of ['TabGubun','airSect','SelectedCityCd','nowYear','nowMonth','nowDay','order','view']) {
        const hits = Array.from(source.matchAll(new RegExp('\\bvar\\s+' + name + '\\s*=\\s*([\x22\x27])([^\x22\x27\\\\]*)\\1\\s*;', 'g')));
        vars[name] = hits.length === 1 ? hits[0][2] : null;
    }
    const filters = {};
    for (const name of ['ck_dep','ck_status']) {
        const inputs = Array.from(document.querySelectorAll('input[name=' + name + ']'));
        const selected = inputs.filter(e => e.checked);
        const total = selected.some(e => e.value === 'total');
        filters[name] = { safe: !selected.length || total, values: total ? inputs.filter(e => e.value !== 'total').map(e => e.value) : [] };
    }
    return { vars, filters, pageNo: document.querySelector('#pageNo')?.value, pageSize: document.querySelector('#pageSize')?.value,
        ready: document.readyState === 'complete', loading: Array.from(document.querySelectorAll('[class*="loading"], [id*="loading"]')).some(visible) || /조회중입니다/.test(document.body?.innerText || ''),
        restricted: /captcha|access denied|request blocked|temporarily blocked|unusual traffic|비정상(?:적인)?\s*접근|자동화(?:된)?\s*요청|접근이?\s*제한|서비스\s*이용이?\s*제한/i.test(document.body?.innerText || ''),
        controls: Array.from(document.querySelectorAll('[onclick]')).filter(enabled).map(e => ({tag: e.tagName, name: e.getAttribute('name'), onclick: e.getAttribute('onclick')})) };
})()`;
interface Dom {
    outside?: boolean; vars: Record<string, string | null>; ready: boolean; loading: boolean; restricted: boolean;
    filters: Record<string, { safe: boolean; values: string[] }>; pageNo: string; pageSize: string;
    controls: { tag: string; name: string | null; onclick: string }[];
}
const regionControl = (c: Dom['controls'][number]) => c.tag === 'A' ? /^(?:javascript:)?goDcair\('([A-Z]{2})'\);?$/.exec(c.onclick) : null;
function prepare(d: Dom): RegionSnapshot {
    if (d.outside || !d.vars || !/^[A-Z]{2}$/.test(d.vars.TabGubun || '')) throw new RegionDiscoveryError('invalid_region_dom');
    const v = d.vars, month = (v.nowYear || '') + (v.nowMonth || '');
    const scope = v.airSect === 'ICN' && /^[A-Z]{3}$/.test(v.SelectedCityCd || '') && monthOK(month) && v.nowDay === '' && v.order === 'LP' && v.view === ''
        && d.filters.ck_dep.safe && d.filters.ck_status.safe && d.pageSize === '20'
        ? { departure: 'ICN', city: v.SelectedCityCd!, month } : null;
    const cities: RegionSnapshot['cities'] = [], months: string[] = scope ? [month] : [], regions: string[] = [];
    for (const c of d.controls) {
        const r = regionControl(c); if (r && !regions.includes(r[1])) regions.push(r[1]);
        const city = /^(?:javascript:)?goSelectedCity\('([A-Z]{3})','([1-9]\d{7})'\);?$/.exec(c.onclick);
        if (city && c.tag === 'INPUT' && c.name === 'city' && monthOK(city[2].slice(0,6))) {
            const iso = city[2].replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
            const date = new Date(iso + 'T00:00:00Z');
            if (Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === iso && !cities.some(x => x.code === city[1])) cities.push({ code: city[1], firstDepartureDate: city[2] });
        }
        const m = /^(?:javascript:)?(?:nextMonth|prevMonth)\(([1-9]\d{3}),\s*(\d{1,2})\);?$/.exec(c.onclick);
        const candidate = m ? m[1] + m[2].padStart(2,'0') : '';
        if (c.tag === 'BUTTON' && monthOK(candidate) && !months.includes(candidate)) months.push(candidate);
    }
    return { region: v.TabGubun!, cities, monthCandidates: months, availableRegions: regions, currentScope: scope, restricted: d.restricted };
}
/** Existing exact tab only. Inspect never enables interception or performs actions. */
export async function createOnlineTourRegionDiscovery(client: CdpClient, options: RegionDiscoveryOptions) {
    options = { ...options };
    if (![options.maxNavigations, options.maxProductRequests].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 6)) throw new RegionDiscoveryError('invalid_budget');
    const diagnostics: RegionDiagnostics = { actions: 0, documentRequests: 0, permittedDocumentRequests: 0, productRequests: 0, permittedProductRequests: 0, blockedRequests: 0 };
    let sessionId: string | undefined, frameId = '', closed = false, cleanupExpired = false;
    const send = (method: string, params: Record<string, unknown> = {}, browser = false): Promise<any> => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new RegionDiscoveryError('cdp_deadline')), method === 'Page.stopLoading' ? 1000 : 15000);
        Promise.resolve().then(() => { if (closed || cleanupExpired) throw new RegionDiscoveryError('closed'); return client.send(method, params, browser ? undefined : sessionId); }).then(resolve, () => reject(new RegionDiscoveryError('cdp_failed'))).finally(() => clearTimeout(timer));
    });
    try {
        const targets = (await send('Target.getTargets', {}, true)).targetInfos as { type: string; targetId: string; url: string }[];
        const pages = targets.filter(t => t.type === 'page' && matches(t.url, LIST));
        if (pages.length !== 1) throw new RegionDiscoveryError('require_exactly_one_existing_list_tab');
        if (!targets.some(t => t.type === 'page' && matches(t.url, 'https://myaccount.google.com/'))) throw new RegionDiscoveryError('require_existing_google_home_tab');
        sessionId = (await send('Target.attachToTarget', { targetId: pages[0].targetId, flatten: true }, true)).sessionId;
        if (!sessionId) throw new RegionDiscoveryError('attachment_failed');
        await send('Page.enable'); await send('Network.enable', { maxResourceBufferSize: 2097152, maxTotalBufferSize: 6291456 });
    } catch (e) { if (sessionId) await send('Target.detachFromTarget', { sessionId }, true).catch(() => {}); await client.close().catch(() => {}); throw e; }
    async function readDom(): Promise<Dom> {
        if (closed) throw new RegionDiscoveryError('closed');
        const tree = await send('Page.getFrameTree');
        if (!matches(tree.frameTree?.frame?.url, LIST)) throw new RegionDiscoveryError('target_left_list');
        frameId = tree.frameTree.frame.id;
        const r = await send('Runtime.evaluate', { expression: DOM_READ, returnByValue: true });
        if (r.exceptionDetails || !r.result?.value || r.result.value.outside) throw new RegionDiscoveryError('dom_failed');
        return r.result.value;
    }
    let latched: RegionDiscoveryError | null = null, busy = false, armed = false, closing = false;
    let lastRejectedRequest: Record<string, string | boolean> | null = null;
    let lastSnapshot: RegionSnapshot | null = null, lastActionAt = 0;
    const visited = new Set<string>(), jobs = new Set<Promise<void>>(), paused = new Set<string>();
    const partialEvidence: RegionFirstPage[] = [];
    interface RecordState { api: boolean; url: string; status?: number; done: boolean; scope?: ListScope; callback?: string; filters?: string[]; }
    interface Action { region: string; started: boolean; documentCount: number; apiCount: number; documentDone: boolean; finished: boolean; records: Map<string, RecordState>; firstPage: RegionFirstPage | null; }
    let active: Action | undefined;
    let stopJob: Promise<any> | undefined;
    function stop() { return stopJob ?? (stopJob = send('Page.stopLoading').catch(() => {})); }
    function fail(reason: string) { if (!latched) latched = new RegionDiscoveryError(reason); if (active?.started) void stop(); }
    const check = () => { if (closed || closing) throw new RegionDiscoveryError('closed'); if (latched) throw latched; };
    function documentMatches(raw: string, region: string) {
        if (!matches(raw, LIST)) return false;
        const u = new URL(raw), q = u.searchParams;
        return !u.hash && Array.from(q.keys()).every(k => ['TabGubun','SelectedCityCd'].includes(k)) && q.getAll('TabGubun').length === 1 && q.get('TabGubun') === region
            && q.getAll('SelectedCityCd').length === 1 && q.get('SelectedCityCd') === '';
    }
    function apiRecord(raw: string, region: string): RecordState {
        if (!matches(raw, API)) throw new RegionDiscoveryError('outside_api');
        const u = new URL(raw), q = u.searchParams;
        const wanted: Record<string, string> = { areaCode: region, transportStartCity: 'ICN', eventStartDate: '', order: 'LP', pageNo: '1', pageSize: '20', pageYn: 'Y' };
        const allowed = [...Object.keys(wanted), 'transportEndCity','eventStartMonth','callback','depPyunStr','statusStr','_'];
        if (u.hash || Array.from(q.keys()).some(k => !allowed.includes(k) || q.getAll(k).length !== 1) || Object.keys(wanted).some(k => q.get(k) !== wanted[k])) throw new RegionDiscoveryError('unexpected_api_query');
        const city = q.get('transportEndCity') || '', month = q.get('eventStartMonth') || '', callback = q.get('callback') || '';
        if (!/^[A-Z]{3}$/.test(city) || !monthOK(month) || !/^[A-Za-z_$][\w$]{0,127}$/.test(callback)) throw new RegionDiscoveryError('invalid_api_scope');
        const filters = ['depPyunStr','statusStr'].map(k => { const v = q.get(k); if (v === null || !/^[A-Za-z0-9_,]*$/.test(v) || v.length > 500) throw new RegionDiscoveryError('invalid_api_filters'); return v.split(',').filter(Boolean).sort().join(','); });
        if (q.has('_') && !/^\d{1,20}$/.test(q.get('_')!)) throw new RegionDiscoveryError('invalid_cache_buster');
        return { api: true, url: raw, done: false, callback, scope: { departure: 'ICN', city, month }, filters };
    }
    function parsePage(text: string, r: RecordState): RegionFirstPage {
        const wrapper = /^\s*([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*;?\s*$/.exec(text);
        if (!wrapper || wrapper[1] !== r.callback) throw new RegionDiscoveryError('invalid_jsonp');
        let p: any; try { p = JSON.parse(wrapper[2]); } catch { throw new RegionDiscoveryError('invalid_jsonp'); }
        if (p.status !== 200 || p.error || p.success === false) throw new RegionDiscoveryError('api_error');
        const data = p.data, paging = data?.paging, count = paging?.totalCount ?? data?.count, last = paging?.totalLastPage;
        if (!Array.isArray(data?.list) || data.list.length > 20 || paging?.curPage !== 1 || !Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(last) || last < 0
            || count < data.list.length || (count > 0 && last < 1) || data.list.some((x: any) => !x || typeof x !== 'object' || Array.isArray(x))) throw new RegionDiscoveryError('invalid_first_page');
        if (data.list.length && validatePilotResponse(text, r.callback!).status !== 'pilot_ready_for_review') throw new RegionDiscoveryError('invalid_product_rows');
        // Public product-field projection, not the response envelope. Validate the projection too
        // so every emitted raw row remains reusable by the strict existing product mapper.
        const allowed = /^(?:event_code|event_name|event_status_code|adult_fee_price|transport_detail_name|dep_pyun_name|air(?:line)?_?(?:code|name)|air_nm|air_cd|adult_price|child_price|infant_price|tax|fuel|res_cnt|seat_cnt|dep_(?:start|end)_(?:date|time)|arr_(?:start|end)_(?:date|time)|(?:start|end|dep|arr)_city_(?:code(?:_name)?2?|name)|(?:transport|event)_(?:start|end)_(?:city|date|time)|(?:departure|arrival)_(?:date|time)|night|days|stay_days|airline|price|currency)$/;
        const rawProducts = data.list.map((row: Record<string, unknown>) => {
            const clean: Record<string, unknown> = {};
            for (const key of Object.keys(row)) { const v = row[key]; if (allowed.test(key) && (typeof v === 'number' && Number.isFinite(v) || v === null || typeof v === 'string' && v.length <= 500 && !/[?]|https?:\/\/|bearer\s/i.test(v))) clean[key] = v; }
            return clean;
        });
        if (rawProducts.length && validatePilotResponse(r.callback + '(' + JSON.stringify({ status: 200, data: { list: rawProducts } }) + ');', r.callback!).status !== 'pilot_ready_for_review') throw new RegionDiscoveryError('invalid_product_rows');
        return { scope: r.scope!, pageNo: 1, totalCount: count, lastPage: last, rawProducts };
    }
    function job(work: Promise<void>) { jobs.add(work); void work.finally(() => jobs.delete(work)); }
    const unsubscribe = client.onEvent(e => {
        if (closed || e.sessionId !== sessionId) return;
        const p = e.params, a = active;
        if (e.method === 'Inspector.detached' || e.method === 'Inspector.targetCrashed') fail('target_disconnected');
        if (e.method === 'Page.frameNavigated' && p.frame?.id === frameId && !matches(p.frame.url, LIST)) fail('target_left_list');
        if (e.method === 'Fetch.requestPaused') {
            paused.add(p.requestId);
            let r: RecordState | undefined;
            const doc = p.resourceType === 'Document';
            if (doc) diagnostics.documentRequests++; else diagnostics.productRequests++;
            try {
                if (!armed || closing || latched || !a?.started || a.finished) throw new RegionDiscoveryError('off_action_request');
                if (p.responseStatusCode !== undefined || p.redirectedRequestId || !p.networkId || p.frameId !== frameId || p.request?.method !== 'GET' || p.request?.postData) throw new RegionDiscoveryError('invalid_paused_request');
                if (doc) {
                    if (a.documentCount || diagnostics.permittedDocumentRequests >= options.maxNavigations || !documentMatches(p.request.url, a.region)) throw new RegionDiscoveryError('unexpected_document');
                    a.documentCount++; diagnostics.permittedDocumentRequests++; r = { api: false, url: p.request.url, done: false };
                } else {
                    if (!a.documentCount || a.apiCount || diagnostics.permittedProductRequests >= options.maxProductRequests) throw new RegionDiscoveryError('product_budget_or_multiple');
                    r = apiRecord(p.request.url, a.region); a.apiCount++; diagnostics.permittedProductRequests++;
                }
                // Reserve synchronously; concurrent pauses cannot share the last permission.
                a.records.set(p.networkId, r);
            } catch (error) {
                const reason = error instanceof RegionDiscoveryError ? error.reason : 'invalid_request';
                // Structural flags only: never persist URL/query, IDs, headers or request body.
                if (!lastRejectedRequest) lastRejectedRequest = { reason, mainFrame: p.frameId === frameId,
                    networkIdPresent: !!p.networkId, redirected: !!p.redirectedRequestId, responseStage: p.responseStatusCode !== undefined,
                    method: ['GET','POST'].includes(p.request?.method) ? p.request.method : 'other', bodyPresent: !!p.request?.postData,
                    urlKind: matches(p.request?.url, LIST) ? 'list' : matches(p.request?.url, API) ? 'api' : 'other', resourceKind: doc ? 'document' : 'product' };
                diagnostics.blockedRequests++; fail(reason);
            }
            job(send(r ? 'Fetch.continueRequest' : 'Fetch.failRequest', r ? { requestId: p.requestId } : { requestId: p.requestId, errorReason: 'Aborted' })
                .then(() => { paused.delete(p.requestId); }, () => { fail('guard_command_failed'); }));
            return;
        }
        const r = a?.records.get(p.requestId);
        if (e.method === 'Network.requestWillBeSent' && p.redirectResponse && (r || p.type === 'Document' || matches(p.request?.url, API))) { fail('unexpected_redirect'); return; }
        if (e.method === 'Network.responseReceived' && (matches(p.response?.url, API) || p.type === 'Document') && [401,403,429].includes(Number(p.response?.status))) fail('http_access_status');
        if (!a || a.finished || !r) return; // No unrelated or unmatched response-body reads.
        if (e.method === 'Network.requestWillBeSent' && (p.redirectResponse || p.request?.url !== r.url)) { fail('unexpected_redirect'); return; }
        if (e.method === 'Network.responseReceived') {
            if (p.response?.url !== r.url || p.frameId !== frameId || !Number.isInteger(p.response.status) || p.response.status < 200 || p.response.status >= 300) { fail('invalid_response'); return; }
            r.status = p.response.status;
        }
        if (e.method === 'Network.loadingFailed') fail('request_failed');
        if (e.method === 'Network.loadingFinished' && !r.done && !latched) {
            r.done = true;
            job((async () => {
                try {
                    if (!r.status || !Number.isFinite(p.encodedDataLength) || p.encodedDataLength > 2097152) throw new RegionDiscoveryError('invalid_response_size');
                    const body = await send('Network.getResponseBody', { requestId: p.requestId });
                    if (a.finished || latched || closing) return;
                    if (typeof body.body !== 'string' || body.body.length > 2796204) throw new RegionDiscoveryError('body_too_large');
                    const bytes = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8');
                    if (bytes.length > 2097152) throw new RegionDiscoveryError('body_too_large');
                    const text = bytes.toString('utf8');
                    if (ACCESS.test(text)) throw new RegionDiscoveryError('access_body');
                    if (r.api) { a.firstPage = parsePage(text, r); partialEvidence.push(a.firstPage); }
                    else { if (!/<(?:!doctype\s+html|html)\b/i.test(text)) throw new RegionDiscoveryError('invalid_document'); a.documentDone = true; }
                } catch (error) { if (!a.finished) fail(error instanceof RegionDiscoveryError ? error.reason : 'response_failed'); }
            })());
        }
    });
    async function inspect(): Promise<RegionSnapshot> {
        if (busy) throw new RegionDiscoveryError('concurrent_inspection');
        try { const snapshot = prepare(await readDom()); if (snapshot.restricted) fail('restricted_dom'); lastSnapshot = snapshot; return { ...snapshot, restricted: snapshot.restricted || !!latched }; }
        catch (error) { fail(error instanceof RegionDiscoveryError ? error.reason : 'inspection_failed'); throw latched; }
    }
    async function performRegion(code: string, reload: boolean): Promise<RegionDiscoveryResult> {
        if (busy) { fail('concurrent_action'); throw latched; }
        check(); busy = true;
        let a: Action | undefined;
        try {
            if (!/^[A-Z]{2}$/.test(code) || visited.has(code)) throw new RegionDiscoveryError('region_already_visited_or_invalid');
            visited.add(code); // Every call is one-shot, including validation failures.
            if (diagnostics.actions >= options.maxNavigations || diagnostics.permittedProductRequests >= options.maxProductRequests) throw new RegionDiscoveryError('budget_exhausted');
            const delay = Math.max(0, 5000 - (Date.now() - lastActionAt)); if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            check();
            const before = await readDom();
            if (before.restricted || !before.ready || before.loading) throw new RegionDiscoveryError('initial_state_not_safe');
            if (reload) {
                const tree = await send('Page.getFrameTree');
                if (diagnostics.actions !== 0 || !documentMatches(tree.frameTree?.frame?.url, code)) throw new RegionDiscoveryError('recovery_scope_changed');
            } else {
                const snapshot = prepare(before); lastSnapshot = snapshot;
                if (snapshot.region === code) throw new RegionDiscoveryError('initial_state_not_safe');
            }
            const choices = before.controls.filter(c => regionControl(c)?.[1] === code);
            if (!reload && choices.length !== 1) throw new RegionDiscoveryError('region_control_not_unique');
            a = { region: code, started: false, finished: false, documentCount: 0, apiCount: 0, documentDone: false, records: new Map(), firstPage: null }; active = a; stopJob = undefined;
            if (!armed) { armed = true; await send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }, { urlPattern: API, requestStage: 'Request' }, { urlPattern: API + '\\?*', requestStage: 'Request' }] }); }
            check(); a.started = true; diagnostics.actions++; lastActionAt = Date.now();
            if (reload) await send('Page.reload', { ignoreCache: false });
            else {
            const expression = `(() => { const state = ${DOM_READ};
                if (state.outside || state.restricted || !state.ready || state.loading || JSON.stringify(state.vars) !== ${JSON.stringify(JSON.stringify(before.vars))}) return false;
                const nodes = Array.from(document.querySelectorAll('[onclick]')).filter(e => e.tagName === 'A' && e.getAttribute('onclick') === ${JSON.stringify(choices[0].onclick)} && !e.hidden && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden');
                if (nodes.length !== 1) return false; nodes[0].click(); return true; })()`;
            const clicked = await send('Runtime.evaluate', { expression, returnByValue: true });
            if (clicked.exceptionDetails || clicked.result?.value !== true) throw new RegionDiscoveryError('click_guard_changed');
            }
            const deadline = Date.now() + 90000; let idleSince = 0;
            while (Date.now() < deadline) {
                check();
                if (a.documentDone) {
                    const dom = await readDom();
                    if (dom.restricted) throw new RegionDiscoveryError('restricted_dom');
                    // Network completion precedes HTML parsing and deferred scripts.
                    // A missing list function while loading is not a malformed final page.
                    if (!dom.ready) { idleSince = 0; await new Promise(resolve => setTimeout(resolve, 25)); continue; }
                    const observed = prepare(dom); lastSnapshot = observed;
                    if (observed.region !== code) throw new RegionDiscoveryError('final_region_mismatch');
                    if (dom.ready && !dom.loading && !jobs.size) {
                        const apiState = Array.from(a.records.values()).find(r => r.api);
                        if (a.firstPage) {
                            if (JSON.stringify(observed.currentScope) !== JSON.stringify(a.firstPage.scope) || dom.pageNo !== '2' || !apiState
                                || ['ck_dep','ck_status'].some((k,i) => !dom.filters[k].safe || dom.filters[k].values.slice().sort().join(',') !== apiState.filters![i])) throw new RegionDiscoveryError('final_scope_mismatch');
                        } else if (a.apiCount || observed.currentScope || observed.cities.length || dom.vars.SelectedCityCd !== '') { idleSince = 0; await new Promise(resolve => setTimeout(resolve, 25)); continue; }
                        if (!idleSince) idleSince = Date.now();
                        if (Date.now() - idleSince >= 250) { check(); return { snapshot: observed, firstPage: a.firstPage }; }
                    } else idleSince = 0;
                }
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new RegionDiscoveryError('idle_deadline');
        } catch (error) {
            fail(error instanceof RegionDiscoveryError ? error.reason : 'action_failed');
            if (a?.started) await stop();
            throw new RegionDiscoveryError(latched!.reason, lastSnapshot ? { snapshot: lastSnapshot, firstPage: a?.firstPage || null } : null);
        } finally { if (a) a.finished = true; active = undefined; busy = false; }
    }
    let closePromise: Promise<void> | undefined;
    function close(): Promise<void> {
        if (closePromise) return closePromise;
        closing = true;
        closePromise = (async () => {
            let cleanupError = false;
            const cleanup = (async () => {
                if (diagnostics.actions > 0) { stopJob = undefined; await send('Page.stopLoading'); }
                if (armed) {
                    // Abort pending permissions before disabling. A failed abort never gets retried.
                    while (jobs.size) await Promise.all(Array.from(jobs));
                    if (paused.size) throw new RegionDiscoveryError('cleanup_failed');
                    await send('Fetch.disable');
                }
                await send('Target.detachFromTarget', { sessionId }, true);
            })();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try { await Promise.race([cleanup, new Promise<never>((_, reject) => { timer = setTimeout(() => { cleanupExpired = true; reject(new RegionDiscoveryError('cleanup_failed')); }, 5000); })]); }
            catch { cleanupError = true; }
            finally {
                if (timer) clearTimeout(timer); cleanupExpired = true; closed = true; unsubscribe();
                let socketTimer: ReturnType<typeof setTimeout> | undefined;
                try { await Promise.race([client.close(), new Promise<never>((_, reject) => { socketTimer = setTimeout(() => reject(new RegionDiscoveryError('cleanup_failed')), 1000); })]); }
                catch { cleanupError = true; }
                finally { if (socketTimer) clearTimeout(socketTimer); }
            }
            if (cleanupError) { if (!latched) latched = new RegionDiscoveryError('cleanup_failed'); throw new RegionDiscoveryError('cleanup_failed'); }
        })();
        return closePromise;
    }
    return { inspect, visitRegion: (code: string) => performRegion(code, false), reloadExistingRegion: (code: string) => performRegion(code, true), close, get diagnostics() { return { ...diagnostics }; }, partialEvidence, get failure() { return latched?.reason || null; },
        get lastRejectedRequest() { return lastRejectedRequest ? { ...lastRejectedRequest } : null; },
        get lastFailure(): RegionFailure | null { return latched ? { reason: latched.reason, phase: closing ? 'cleanup' : 'discovery', region: active?.region || lastSnapshot?.region || null } : null; } };
}
