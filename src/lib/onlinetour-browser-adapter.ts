// ws is already installed; keep its small transport boundary typed without adding @types/ws.
interface RawSocket {
    readyState: number;
    on(event: string, listener: (...args: any[]) => void): unknown;
    off(event: string, listener: (...args: any[]) => void): unknown;
    send(data: string, callback: (error?: Error) => void): void;
    close(): void; terminate(): void;
}
const WebSocket = require('ws') as { new(endpoint: string, options: Record<string, unknown>): RawSocket; OPEN: number; CLOSED: number };
import { discoverNormalChromeEndpoint, ONLINE_LIST_URL, validatePilotResponse } from './onlinetour-browser-collector';
import { ListReadError, type ListPage, type ListScope } from './onlinetour-list-traversal';
import { parseOnlineTourJsonp } from './scrapers/source-response';

export interface PartialPageEvidence {
    scope: ListScope; pageNo: number; attempt: number;
    rawProducts: Record<string, unknown>[];
    flights: import('../types/flight').Flight[];
}

export interface BrowserSnapshot {
    currentScope: ListScope; availableScopes: ListScope[]; nextPageNo: number;
    nextPageAvailable: boolean; restricted: boolean;
    preflight: { googleHomeTabPresent: true; evidence: 'tab_url_metadata_only_not_session_guarantee' };
}
export interface CdpClient {
    send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any>;
    onEvent(listener: (event: { method: string; params: any; sessionId?: string }) => void): () => void;
    close(): Promise<void>;
}
export async function connectNormalChrome(): Promise<CdpClient> {
    let endpoint: string;
    try { endpoint = discoverNormalChromeEndpoint(); }
    catch { throw failure('validation', 'normal_chrome_discovery_failed'); }
    // Official, existing normal profile discovery only. No HTTP endpoint probing or browser launch.
    const socket = new WebSocket(endpoint, { handshakeTimeout: 180_000, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false });
    return connectRawCdpSocket(socket);
}

/** Injectable socket seam for offline protocol tests; never opens a tab or browser. */
export async function connectRawCdpSocket(socket: RawSocket): Promise<CdpClient> {
    const listeners = new Set<Parameters<CdpClient['onEvent']>[0]>();
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    let nextId = 0;
    let ended = false;
    function terminatePending() {
        ended = true;
        for (const item of Array.from(pending.values())) { clearTimeout(item.timer); item.reject(failure('transient', 'cdp_disconnected')); }
        pending.clear();
    }
    const onError = () => terminatePending();
    const onClose = () => terminatePending();
    const onMessage = (data: { toString(): string }) => {
        let message: any;
        try { message = JSON.parse(data.toString()); } catch { terminatePending(); socket.terminate(); return; }
        if (typeof message.id === 'number') {
            const item = pending.get(message.id);
            if (!item) return;
            pending.delete(message.id); clearTimeout(item.timer);
            if (message.error) item.reject(failure('transient', 'cdp_command_failed')); else item.resolve(message.result);
        } else if (typeof message.method === 'string') {
            for (const listener of Array.from(listeners)) listener({ method: message.method, params: message.params || {}, sessionId: message.sessionId });
        }
    };
    socket.on('error', onError); socket.on('close', onClose); socket.on('message', onMessage);
    if (socket.readyState !== WebSocket.OPEN) {
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => finish(failure('transient', 'cdp_connect_deadline')), 180_000);
                const opened = () => finish();
                const failed = () => finish(failure('transient', 'cdp_connect_failed'));
                function finish(error?: Error) {
                    clearTimeout(timer); socket.off('open', opened); socket.off('error', failed); socket.off('close', failed);
                    if (error) reject(error); else resolve();
                }
                socket.on('open', opened); socket.on('error', failed); socket.on('close', failed);
            });
        } catch (e) { socket.terminate(); throw e; }
    }
    return {
        send(method, params = {}, sessionId) {
            if (ended || socket.readyState !== WebSocket.OPEN) return Promise.reject(failure('transient', 'cdp_disconnected'));
            return new Promise((resolve, reject) => {
                const id = ++nextId;
                const timer = setTimeout(() => { pending.delete(id); reject(failure('transient', 'cdp_command_deadline')); }, 15_000);
                pending.set(id, { resolve, reject, timer });
                try {
                    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }), error => {
                        if (!error || !pending.has(id)) return;
                        clearTimeout(timer); pending.delete(id); reject(failure('transient', 'cdp_send_failed'));
                    });
                } catch { clearTimeout(timer); pending.delete(id); reject(failure('transient', 'cdp_send_failed')); }
            });
        },
        onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async close() {
            terminatePending(); listeners.clear();
            if (socket.readyState === WebSocket.CLOSED) return;
            await new Promise<void>(resolve => {
                const timer = setTimeout(() => { socket.terminate(); finish(); }, 1000);
                const finish = () => { clearTimeout(timer); socket.off('close', finish); resolve(); };
                socket.on('close', finish); socket.close();
            });
        },
    };
}

const API_URL = 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list';
const ACCESS = /captcha|access denied|request blocked|temporarily blocked|unusual traffic|비정상(?:적인)?\s*접근|자동화(?:된)?\s*요청|접근이?\s*제한|서비스\s*이용이?\s*제한/i;
const accessStatus = (status: unknown) => [401, 403, 429].includes(Number(status));
function matches(raw: string, expected: string): boolean {
    try { const u = new URL(raw); return !u.username && !u.password && u.origin + u.pathname === expected; }
    catch { return false; }
}
const failure = (kind: ListReadError['kind'], reason: string) => new ListReadError(kind, reason);
const same = (a: ListScope, b: ListScope) => a.departure === b.departure && a.city === b.city && a.month === b.month;
const validScope = (s: ListScope) => s && /^[A-Z]{3}$/.test(s.departure) && /^[A-Z]{3}$/.test(s.city)
    && /^[1-9]\d{3}(0[1-9]|1[0-2])$/.test(s.month) && (s.sort === undefined || s.sort === 'LP')
    && (s.filter === undefined || s.filter === '');

// Static, read-only script: never execute the function source or return its API key.
const DOM_READ = String.raw`(() => {
    const targetUrl = new URL(location.href);
    if (targetUrl.username || targetUrl.password || targetUrl.origin + targetUrl.pathname !== 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList')
        return { url: location.href };
    const visible = e => !!e && !e.hidden && e.getClientRects().length > 0 &&
        getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    const enabled = e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true';
    const source = typeof window.getDcairMainList === 'function' ? Function.prototype.toString.call(window.getDcairMainList) : '';
    const vars = {};
    for (const name of ['TabGubun','airSect','SelectedCityCd','nowYear','nowMonth','nowDay','order','view']) {
        const re = new RegExp('\\bvar\\s+' + name + '\\s*=\\s*([\x22\x27])([^\x22\x27\\\\]*)\\1\\s*;','g');
        const hits = Array.from(source.matchAll(re));
        vars[name] = hits.length === 1 ? hits[0][2] : null;
    }
    const filters = {};
    for (const name of ['ck_dep','ck_status']) {
        const inputs = Array.from(document.querySelectorAll('input[name=' + name + ']'));
        const selected = inputs.filter(e => e.checked);
        const total = selected.some(e => e.value === 'total');
        filters[name] = { safe: selected.length === 0 || total,
            values: total ? inputs.filter(e => e.value !== 'total').map(e => e.value) : [] };
    }
    const more = document.querySelector('#btn_more');
    return { url: location.href, vars, filters,
        pageNo: document.querySelector('#pageNo')?.value,
        pageSize: document.querySelector('#pageSize')?.value,
        more: enabled(more), moreOnclick: more?.getAttribute('onclick'),
        bodyRestricted: /captcha|access denied|request blocked|temporarily blocked|unusual traffic|비정상(?:적인)?\s*접근|자동화(?:된)?\s*요청|접근이?\s*제한|서비스\s*이용이?\s*제한/i.test(document.body?.innerText || ''),
        ready: document.readyState === 'complete',
        loading: Array.from(document.querySelectorAll('[class*="loading"], [id*="loading"]')).some(visible) || /조회중입니다/.test(document.body?.innerText || ''),
        controls: Array.from(document.querySelectorAll('[onclick]')).filter(enabled).map(e => ({
            tag: e.tagName, name: e.getAttribute('name'), onclick: e.getAttribute('onclick') })) };
})()`;
interface DomState {
    url: string; vars: Record<string, string>; filters: Record<string, { safe: boolean; values: string[] }>;
    pageNo: string; pageSize: string; more: boolean; moreOnclick: string; bodyRestricted: boolean;
    ready: boolean; loading: boolean; controls: { tag: string; name: string; onclick: string }[];
}
function prepare(dom: DomState): { snapshot: BrowserSnapshot; controls: { scope: ListScope; onclick: string }[] } {
    const v = dom.vars;
    const currentScope: ListScope = { departure: v.airSect, city: v.SelectedCityCd, month: v.nowYear + v.nowMonth };
    if (!validScope(currentScope) || !/^[A-Z]{2,3}$/.test(v.TabGubun) || v.nowDay !== '' || v.order !== 'LP' || v.view !== ''
        || !dom.filters.ck_dep.safe || !dom.filters.ck_status.safe || dom.pageSize !== '20'
        || !/^[1-9]\d*$/.test(dom.pageNo) || !Number.isSafeInteger(Number(dom.pageNo))) throw failure('validation', 'unsupported_list_state');
    const controls: { scope: ListScope; onclick: string }[] = [];
    for (const control of dom.controls) {
        const city = /^(?:javascript:)?goSelectedCity\(\s*'([A-Z]{3})'\s*,\s*'(\d{8})'\s*\);?$/.exec(control.onclick);
        const month = /^(?:javascript:)?(?:nextMonth|prevMonth)\(\s*([1-9]\d{3})\s*,\s*(\d{1,2})\s*\);?$/.exec(control.onclick);
        let target: ListScope | undefined;
        if (city && control.tag === 'INPUT' && control.name === 'city' && currentScope.departure === 'ICN')
            target = { departure: 'ICN', city: city[1], month: city[2].slice(0, 6) };
        if (month && control.tag === 'BUTTON') target = { ...currentScope, month: month[1] + month[2].padStart(2, '0') };
        if (target && validScope(target)) controls.push({ scope: target, onclick: control.onclick });
    }
    const availableScopes = [currentScope];
    for (const control of controls) if (!availableScopes.some(s => same(s, control.scope))) availableScopes.push(control.scope);
    return { snapshot: { currentScope, availableScopes, nextPageNo: Number(dom.pageNo), nextPageAvailable: dom.more,
        restricted: dom.bodyRestricted, preflight: { googleHomeTabPresent: true, evidence: 'tab_url_metadata_only_not_session_guarantee' } }, controls };
}

export async function createOnlineTourBrowserAdapter(client: CdpClient) {
    const diagnostics = { actions: 0, productRequests: 0, documentRequests: 0,
        permittedProductRequests: 0, blockedProductRequests: 0 };
    let productRequestCap: number | undefined;
    let fetchArmed = false;
    let closing = false;
    let cleanupExpired = false;
    const pausedRequests = new Set<string>();
    const guardJobs = new Set<Promise<void>>();
    function authorizeProductRequests(max: number): void {
        if (closed || busy || productRequestCap !== undefined || !Number.isSafeInteger(max) || max < 1 || max > 100)
            throw failure('validation', 'invalid_query_authorization');
        productRequestCap = max; // Authorization alone never sends browser commands.
    }
    let sessionId: string | undefined;
    let targetId = '';
    let closed = false;
    let accessLatched = false;
    try {
        const targets = (await client.send('Target.getTargets')).targetInfos as { type: string; url: string; targetId: string }[];
        const pages = targets.filter(t => t.type === 'page' && matches(t.url, ONLINE_LIST_URL));
        if (pages.length !== 1) throw failure('validation', 'require_exactly_one_existing_list_tab');
        if (!targets.some(t => t.type === 'page' && matches(t.url, 'https://myaccount.google.com/')))
            throw failure('validation', 'require_existing_google_home_tab');
        targetId = pages[0].targetId;
        sessionId = (await client.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
        if (!sessionId) throw failure('validation', 'attachment_failed');
        await client.send('Network.enable', { maxResourceBufferSize: 2 * 1024 * 1024, maxTotalBufferSize: 6 * 1024 * 1024 }, sessionId);
        await client.send('Page.enable', {}, sessionId);
    } catch (e) {
        if (sessionId) await client.send('Target.detachFromTarget', { sessionId }).catch(() => {});
        await client.close().catch(() => {});
        throw e instanceof ListReadError ? e : failure('transient', 'attachment_failed');
    }
    let actionEndsAt = Infinity;
    const send = (method: string, params: Record<string, unknown> = {}, browserLevel = false): Promise<any> => new Promise((resolve, reject) => {
        // Bound injected clients too. The underlying raw client independently evicts timed-out IDs.
        const timeout = method === 'Page.stopLoading' ? 1000 : Math.min(15_000, Math.max(1, actionEndsAt - Date.now()));
        const timer = setTimeout(() => reject(failure('transient', 'cdp_command_deadline')), timeout);
        Promise.resolve().then(() => {
            if (closed || cleanupExpired) throw failure('validation', 'adapter_closed');
            return client.send(method, params, browserLevel ? undefined : sessionId);
        }).then(resolve, () => reject(failure('transient', 'cdp_command_failed')))
            .finally(() => clearTimeout(timer));
    });
    async function readDom(): Promise<DomState> {
        if (closed) throw failure('validation', 'adapter_closed');
        const tree = await send('Page.getFrameTree');
        if (!matches(tree.frameTree?.frame?.url, ONLINE_LIST_URL)) { accessLatched = true; throw failure('access', 'target_left_list'); }
        frameId = tree.frameTree.frame.id;
        const result = await send('Runtime.evaluate', { expression: DOM_READ, returnByValue: true });
        if (result.exceptionDetails || !result.result?.value) throw failure('validation', 'dom_inspection_failed');
        const dom = result.result.value as DomState;
        if (!matches(dom.url, ONLINE_LIST_URL)) { accessLatched = true; throw failure('access', 'target_left_list'); }
        if (dom.bodyRestricted) accessLatched = true;
        return dom;
    }
    async function inspect(): Promise<BrowserSnapshot> {
        const dom = await readDom();
        const snapshot = prepare(dom).snapshot;
        snapshot.restricted = accessLatched;
        return snapshot;
    }
    // One action at a time; request IDs belong to the action that observed their start.
    interface RequestRecord { api: boolean; callback: string; status?: number; headers?: Record<string, unknown>; done: boolean; }
    interface Action {
        scope: ListScope; pageNo: number; dom: DomState; requests: Map<string, RequestRecord>;
        jobs: Set<Promise<void>>; error?: ListReadError; result?: Omit<ListPage, 'nextPageAvailable'>;
        finalized: boolean; started: boolean; apiCount: number; permittedCount: number; documentDone: boolean; needsDocument: boolean;
    }
    let active: Action | undefined;
    const orphanEvidence: PartialPageEvidence[] = [];
    let validationLatched = false;
    let busy = false;
    let firstAttempt: { scope: ListScope; pageNo: number; currentScope: ListScope; pagination: string } | undefined;
    let frameId = '';
    let stopPromise: Promise<unknown> | undefined;
    const stop = () => stopPromise ?? (stopPromise = send('Page.stopLoading').catch(() => {}));
    function failAction(a: Action | undefined, error: ListReadError) {
        if (error.kind === 'access') accessLatched = true;
        if (error.kind === 'validation') validationLatched = true;
        if (a && !a.finalized && (!a.error || error.kind === 'access')) a.error = error;
        if (a?.started && !a.finalized) void stop();
    }
    function parseBody(text: string, callback: string, pageNo: number): Omit<ListPage, 'nextPageAvailable'> {
        if (ACCESS.test(text)) throw failure('access', 'access_body');
        if (!/^[A-Za-z_$][\w$]*$/.test(callback) || !/\)\s*;?\s*$/.test(text)) throw failure('validation', 'invalid_jsonp');
        let payload: ReturnType<typeof parseOnlineTourJsonp>;
        try { payload = parseOnlineTourJsonp(text, callback); }
        catch (e) {
            if (accessStatus((e as { status?: number }).status)) throw failure('access', 'api_access_status');
            if (Number((e as { status?: number }).status) >= 500) throw failure('transient', 'api_server_error');
            throw failure('validation', 'invalid_jsonp');
        }
        const paging = payload.data.paging;
        const totalCount = paging?.totalCount ?? payload.data.count;
        const lastPage = paging?.totalLastPage;
        if (paging?.curPage !== pageNo || !Number.isSafeInteger(totalCount) || totalCount! < 0
            || !Number.isSafeInteger(lastPage) || lastPage! < 0 || payload.data.list.length > 20
            || payload.data.list.some(row => !row || typeof row !== 'object' || Array.isArray(row)))
            throw failure('validation', 'invalid_paging');
        return { pageNo, totalCount: totalCount!, lastPage: lastPage!, rawProducts: payload.data.list };
    }
    function requestMatches(url: string, method: string, a: Action): string {
        const q = new URL(url).searchParams;
        const wanted: Record<string, string> = { transportStartCity: a.scope.departure, transportEndCity: a.scope.city,
            eventStartMonth: a.scope.month, eventStartDate: '', areaCode: a.dom.vars.TabGubun, order: 'LP',
            pageNo: String(a.pageNo), pageSize: '20', pageYn: 'Y' };
        if (method !== 'GET' || Object.keys(wanted).some(k => q.getAll(k).length !== 1 || q.get(k) !== wanted[k]))
            throw failure('validation', 'unexpected_api_scope');
        for (const [key, filter] of [['depPyunStr', 'ck_dep'], ['statusStr', 'ck_status']]) {
            const values = (q.get(key) || '').split(',').filter(Boolean).sort();
            const expected = a.dom.filters[filter].values.slice().sort();
            if (q.getAll(key).length !== 1 || JSON.stringify(values) !== JSON.stringify(expected)) throw failure('validation', 'unexpected_api_filters');
        }
        const callback = q.get('callback') || '';
        if (q.getAll('callback').length !== 1 || !/^[A-Za-z_$][\w$]*$/.test(callback)) throw failure('validation', 'invalid_callback');
        return callback;
    }
    const unsubscribe = client.onEvent(event => {
        if (closed) return;
        const p = event.params;
        if (event.method === 'Target.targetInfoChanged' && p.targetInfo?.targetId === targetId
            && !matches(p.targetInfo.url, ONLINE_LIST_URL)) failAction(active, failure('access', 'target_left_list'));
        if (event.sessionId !== sessionId) return;
        const a = active;
        if (event.method === 'Fetch.requestPaused') {
            pausedRequests.add(p.requestId);
            let refusal: ListReadError | undefined;
            try {
                if (!fetchArmed || closing || !a || !a.started || a.finalized || a.error || accessLatched || validationLatched)
                    throw failure('validation', 'off_action_query');
                if (!matches(p.request?.url, API_URL)) throw failure('validation', 'outside_paused_url');
                if (productRequestCap === undefined || diagnostics.permittedProductRequests >= productRequestCap)
                    throw failure('validation', 'product_query_budget_exhausted');
                requestMatches(p.request.url, p.request.method, a);
                if (a.permittedCount !== 0) throw failure('validation', 'multiple_api_requests');
                // Reserve synchronously BEFORE any asynchronous CDP continuation.
                diagnostics.permittedProductRequests++; a.permittedCount++;
            } catch (e) { refusal = e instanceof ListReadError ? e : failure('validation', 'invalid_paused_request'); }
            if (refusal) { diagnostics.blockedProductRequests++; failAction(a, refusal); }
            const job = send(refusal ? 'Fetch.failRequest' : 'Fetch.continueRequest',
                refusal ? { requestId: p.requestId, errorReason: 'Aborted' } : { requestId: p.requestId })
                .then(() => { pausedRequests.delete(p.requestId); }, () => {
                    failAction(a, failure('validation', 'query_guard_command_failed'));
                });
            guardJobs.add(job); void job.finally(() => guardJobs.delete(job));
            return;
        }
        if (event.method === 'Page.frameNavigated' && p.frame?.id === frameId && !matches(p.frame.url, ONLINE_LIST_URL))
            failAction(a, failure('access', 'target_left_list'));
        if (event.method === 'Inspector.detached' || event.method === 'Inspector.targetCrashed')
            failAction(a, failure('transient', 'target_disconnected'));
        if (event.method === 'Network.requestWillBeSent') {
            const tracked = a?.requests.get(p.requestId);
            if (tracked && (p.redirectResponse || !matches(p.request?.url, tracked.api ? API_URL : ONLINE_LIST_URL))) {
                a!.requests.delete(p.requestId);
                failAction(a, failure('validation', 'unexpected_redirect'));
                return;
            }
            const api = matches(p.request?.url, API_URL);
            const doc = p.type === 'Document' && p.frameId === frameId;
            if (doc && (!matches(p.request.url, ONLINE_LIST_URL) || accessStatus(p.redirectResponse?.status)))
                failAction(a, failure('access', 'document_redirect_or_access'));
            if (!a || a.finalized || (!api && !doc)) return;
            // Network.requestWillBeSent can precede Fetch.requestPaused: observed starts are NOT dispatch permission.
            if (api) diagnostics.productRequests++; else diagnostics.documentRequests++;
            try {
                const callback = api ? requestMatches(p.request.url, p.request.method, a) : '';
                if (api && ++a.apiCount !== 1) throw failure('validation', 'multiple_api_requests');
                if (doc && !a.needsDocument) throw failure('validation', 'unexpected_navigation');
                if (p.redirectResponse) throw failure('validation', 'unexpected_redirect');
                a.requests.set(p.requestId, { api, callback, done: false });
            } catch (e) { failAction(a, e instanceof ListReadError ? e : failure('validation', 'invalid_request')); }
        }
        if (event.method === 'Network.responseReceived') {
            const targetResponse = matches(p.response?.url, API_URL) || (p.type === 'Document' && p.frameId === frameId);
            if (targetResponse && accessStatus(p.response?.status)) failAction(a, failure('access', 'http_access_status'));
            if (p.type === 'Document' && p.frameId === frameId && !matches(p.response?.url, ONLINE_LIST_URL))
                failAction(a, failure('access', 'document_left_list'));
            const r = a?.requests.get(p.requestId);
            if (a && !a.finalized && r) {
                if (!matches(p.response?.url, r.api ? API_URL : ONLINE_LIST_URL)) {
                    a.requests.delete(p.requestId);
                    failAction(a, failure('validation', 'outside_response_url'));
                    return;
                }
                r.status = p.response.status; r.headers = p.response.headers;
                if (r.status! >= 500) failAction(a, failure('transient', 'http_server_error'));
                else if (r.status! < 200 || r.status! >= 300) failAction(a, failure('validation', 'unexpected_http_status'));
            }
        }
        if (!a || a.finalized) return;
        const r = a.requests.get(p.requestId);
        if (!r) return; // Never adopt stale response/loading events.
        if (event.method === 'Network.loadingFailed') failAction(a, failure('transient', 'target_request_failed'));
        if (event.method === 'Network.loadingFinished' && !r.done) {
            r.done = true;
            if (p.encodedDataLength > 2 * 1024 * 1024) { failAction(a, failure('validation', 'body_too_large')); return; }
            const job = (async () => {
                try {
                    if (r.status === undefined) throw failure('validation', 'missing_response_status');
                    const body = await send('Network.getResponseBody', { requestId: p.requestId });
                    if (a.finalized) return;
                    if (typeof body.body !== 'string' || body.body.length > 3 * 1024 * 1024) throw failure('validation', 'body_too_large');
                    const bytes = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8');
                    if (bytes.length > 2 * 1024 * 1024) throw failure('validation', 'body_too_large');
                    const text = bytes.toString('utf8');
                    if (ACCESS.test(text)) throw failure('access', 'access_body');
                    if (r.status! < 200 || r.status! >= 300) return;
                    if (r.api) a.result = parseBody(text, r.callback, a.pageNo);
                    else {
                        if (!/<(?:!doctype\s+html|html)\b/i.test(text)) throw failure('validation', 'invalid_document');
                        a.documentDone = true;
                    }
                } catch (e) {
                    if (!a.finalized) failAction(a, e instanceof ListReadError ? e : failure('transient', 'response_body_failed'));
                }
            })();
            a.jobs.add(job);
            void job.finally(() => a.jobs.delete(job));
        }
    });
    async function readPage(scope: ListScope, pageNo: number, attempt: number): Promise<ListPage> {
        if (busy) throw failure('validation', 'concurrent_action');
        if (closing || closed) throw failure('validation', 'adapter_closed');
        if (accessLatched) throw failure('access', 'access_latched');
        if (validationLatched) throw failure('validation', 'validation_latched');
        if (!validScope(scope) || !Number.isSafeInteger(pageNo) || pageNo < 1 || ![1, 2].includes(attempt)) throw failure('validation', 'invalid_page_request');
        busy = true;
        let a: Action | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let readyTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            const dom = await readDom();
            if (accessLatched) throw failure('access', 'access_latched');
            const prepared = prepare(dom);
            if (dom.loading || !dom.ready) throw failure('validation', 'list_not_idle');
            const current = same(scope, prepared.snapshot.currentScope);
            const choices = prepared.controls.filter(c => same(c.scope, scope));
            if (pageNo > 1 && !current) throw failure('validation', 'scope_changed');
            const pagination = JSON.stringify([dom.pageNo, dom.pageSize, dom.more, dom.moreOnclick]);
            if (attempt === 2) {
                if (!firstAttempt || firstAttempt.pageNo !== pageNo || !same(firstAttempt.scope, scope)
                    || !current || !same(firstAttempt.currentScope, prepared.snapshot.currentScope))
                    throw failure('validation', 'unsafe_retry_scope_changed');
                if (firstAttempt.pagination !== pagination) throw failure('validation', 'unsafe_retry_page_advanced');
            }
            if (pageNo === 1 && !current && choices.length !== 1) throw failure('validation', 'unreachable_scope');
            if (pageNo > 1 && Number(dom.pageNo) !== pageNo)
                throw failure('validation', attempt === 2 ? 'unsafe_retry_page_advanced' : 'unexpected_dom_page');
            if (productRequestCap === undefined) throw failure('validation', 'query_authorization_required');
            if (diagnostics.permittedProductRequests >= productRequestCap) throw failure('validation', 'product_query_budget_exhausted');
            if (pageNo > 1 && (!dom.more || !/^\s*getDcairMainList\(\);?\s*$/.test(dom.moreOnclick))) throw failure('validation', 'more_unavailable');
            a = { scope: { ...scope }, pageNo, dom, requests: new Map(), jobs: new Set(), finalized: false, started: false,
                apiCount: 0, permittedCount: 0, documentDone: false, needsDocument: pageNo === 1 };
            if (attempt === 1) firstAttempt = { scope: { ...scope }, pageNo,
                currentScope: { ...prepared.snapshot.currentScope }, pagination };
            active = a; stopPromise = undefined;
            actionEndsAt = Date.now() + 90_000;
            const action = a;
            timer = setTimeout(() => failAction(action, failure('transient', 'action_deadline')), 90_000);
            if (!fetchArmed) {
                // Exact API in this target session only; inspection/attachment never arms Fetch.
                fetchArmed = true;
                await send('Fetch.enable', { patterns: [
                    { urlPattern: API_URL, requestStage: 'Request' },
                    { urlPattern: API_URL + '\\?*', requestStage: 'Request' },
                ] });
            }
            if (accessLatched) throw failure('access', 'access_latched');
            if (action.error) throw action.error;
            action.started = true;
            diagnostics.actions++;
            if (pageNo === 1 && current) await send('Page.reload', { ignoreCache: false });
            else {
                const expected = { vars: dom.vars, pageNo: dom.pageNo, onclick: pageNo > 1 ? dom.moreOnclick : choices[0].onclick, more: pageNo > 1 };
                // Only click the exact already observed handler; never eval handler text, set hidden inputs, or call site API.
                const expression = `(() => { const state = ${DOM_READ}; const expected = ${JSON.stringify(expected)};
                    if (state.url !== ${JSON.stringify(dom.url)} || state.bodyRestricted || state.loading || !state.ready ||
                        JSON.stringify(state.vars) !== JSON.stringify(expected.vars) || state.pageNo !== expected.pageNo ||
                        state.pageSize !== '20' || !state.filters.ck_dep.safe || !state.filters.ck_status.safe) return false;
                    const nodes = Array.from(document.querySelectorAll(expected.more ? '#btn_more' : '[onclick]'))
                        .filter(e => e.getAttribute('onclick') === expected.onclick && !e.hidden && !e.disabled &&
                            e.getAttribute('aria-disabled') !== 'true' && e.getClientRects().length > 0 &&
                            getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden');
                    if (nodes.length !== 1) return false;
                    nodes[0].click(); return true; })()`;
                const clicked = await send('Runtime.evaluate', { expression, returnByValue: true });
                if (clicked.exceptionDetails || clicked.result?.value !== true) throw failure('validation', 'click_guard_changed');
            }
            while (true) {
                if (action.jobs.size) await Promise.all(Array.from(action.jobs));
                if (accessLatched) throw failure('access', 'access_latched');
                if (action.error) throw action.error;
                if (action.result && (!action.needsDocument || action.documentDone)) {
                    if (!readyTimer) readyTimer = setTimeout(() => failAction(action, failure('validation', 'ui_completion_timeout')), 5000);
                    const after = await readDom();
                    if (accessLatched) throw failure('access', 'access_latched');
                    const observed = prepare(after).snapshot;
                    if (!same(observed.currentScope, scope)) throw failure('validation', 'response_scope_changed');
                    if (after.ready && !after.loading && observed.nextPageNo === pageNo + 1) {
                        // One protocol round trip above flushes already queued response events; drain body checks before success.
                        await Promise.all(Array.from(action.jobs));
                        if (accessLatched) throw failure('access', 'access_latched');
                        if (action.error) throw action.error;
                        if (Array.from(action.requests.values()).some(r => !r.done)) throw failure('validation', 'unfinished_target_request');
                        return { ...action.result, nextPageAvailable: observed.nextPageAvailable };
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        } catch (e) {
            const error = accessLatched ? failure('access', 'access_latched') : e instanceof ListReadError ? e : failure('transient', 'cdp_action_failed');
            if (a) {
                failAction(a, error); if (a.started) await stop(); await Promise.all(Array.from(a.jobs));
                const evidence: PartialPageEvidence = { scope: { ...scope }, pageNo, attempt, rawProducts: [], flights: [] };
                for (const raw of a.result?.rawProducts || []) {
                    try {
                        if (typeof raw.event_code !== 'string' || !raw.event_code || raw.event_code !== raw.event_code.trim()
                            || /[\u0000-\u001f\u007f]/.test(raw.event_code)) continue;
                        // Internal singleton validation only; never persist this synthetic envelope as live evidence.
                        const validated = validatePilotResponse(`partialRow(${JSON.stringify({ status: 200, data: { list: [raw] } })});`, 'partialRow');
                        if (validated.status !== 'pilot_ready_for_review' || validated.flights[0]?.id !== `online-${raw.event_code}`) continue;
                        evidence.rawProducts.push(validated.rawProducts[0] as Record<string, unknown>);
                        evidence.flights.push(validated.flights[0]);
                    } catch { /* Invalid rows are not promoted to validated evidence. */ }
                }
                if (evidence.rawProducts.length) orphanEvidence.push(evidence);
            }
            throw accessLatched ? failure('access', 'access_latched') : error;
        } finally {
            if (timer) clearTimeout(timer);
            if (readyTimer) clearTimeout(readyTimer);
            if (a) a.finalized = true;
            active = undefined; busy = false;
            actionEndsAt = Infinity;
        }
    }
    async function close() {
        if (closed) return;
        if (busy) throw failure('validation', 'action_in_progress');
        closing = true;
        actionEndsAt = Date.now() + 5000;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                (async () => {
                    if (fetchArmed) {
                        // Cancel owned loads before draining. Inspect-only never sends stopLoading.
                        if (diagnostics.actions > 0) await send('Page.stopLoading');
                        while (guardJobs.size) await Promise.all(Array.from(guardJobs));
                        for (const requestId of Array.from(pausedRequests)) {
                            await send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
                            pausedRequests.delete(requestId);
                        }
                        // Never disable/detach with an unresolved paused request.
                        await send('Fetch.disable');
                        while (guardJobs.size) await Promise.all(Array.from(guardJobs));
                        if (pausedRequests.size) throw failure('validation', 'query_guard_cleanup_failed');
                        fetchArmed = false;
                    }
                    await send('Target.detachFromTarget', { sessionId }, true);
                })(),
                new Promise<never>((_, reject) => { deadline = setTimeout(() => {
                    cleanupExpired = true; reject(failure('transient', 'cleanup_deadline'));
                }, 5000); }),
            ]);
        } finally {
            if (deadline) clearTimeout(deadline);
            closed = true; unsubscribe(); // Invalidate any timed-out cleanup work before closing transport.
            let transportTimer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([client.close(), new Promise<never>((_, reject) => {
                    transportTimer = setTimeout(() => reject(failure('transient', 'transport_close_deadline')), 2000);
                })]);
            } finally { if (transportTimer) clearTimeout(transportTimer); }
        }
    }
    return { inspect, readPage, close, diagnostics, authorizeProductRequests,
        get partialEvidence(): PartialPageEvidence[] { return JSON.parse(JSON.stringify(orphanEvidence)); } };
}
