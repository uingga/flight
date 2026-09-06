import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

// Offline protocol + small DOM harness. No Chrome, HTTP, cookies, or saved account data.
const modulePath = path.resolve(__dirname, '../src/lib/onlinetour-browser-adapter.ts');
const listUrl = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
const scope = { departure: 'ICN', city: 'PQC', month: '202609' };
class Element {
    disabled = false; hidden = false; checked = false; value = ''; innerText = '';
    attrs: Record<string, string> = {}; clicked = 0;
    constructor(readonly tagName: string, attrs: Record<string, string> = {}) { this.attrs = attrs; this.value = attrs.value || ''; }
    getAttribute(name: string) { return this.attrs[name] ?? null; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    closest() { return null; }
    click() { this.clicked++; }
}
export class FakeCdp {
    calls: { method: string; params: any; sessionId?: string }[] = [];
    listeners = new Set<(e: any) => void>();
    closed = false;
    url = listUrl;
    body = '항공권 목록';
    page = new Element('INPUT', { id: 'pageNo', value: '2' });
    size = new Element('INPUT', { id: 'pageSize', value: '20' });
    more = new Element('BUTTON', { id: 'btn_more', onclick: 'getDcairMainList()' });
    city = new Element('INPUT', { name: 'city', type: 'radio', onclick: "javascript:goSelectedCity('PQC','20260907');" });
    month = new Element('BUTTON', { onclick: 'javascript:nextMonth(2026,10)' });
    status = new Element('INPUT', { name: 'ck_status', value: 'total' });
    context: vm.Context;
    onAction: (() => void) | undefined;
    bodies = new Map<string, string>();
    fetchEnabled = false;
    networkFirst = false;
    paused = new Map<string, { start: any; followups: { method: string; params: any }[] }>();
    emittedRequests: any[] = [];
    emitDirect(method: string, params: any, sessionId = 'session') {
        if (method === 'Network.requestWillBeSent') this.emittedRequests.push(params);
        Array.from(this.listeners).forEach(fn => fn({ method, params, sessionId }));
    }
    constructor() {
        const self = this;
        const elements = [this.page, this.size, this.more, this.city, this.month, this.status];
        const document = {
            get body() { return { innerText: self.body, textContent: self.body }; },
            readyState: 'complete',
            querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; },
            querySelectorAll(selector: string): Element[] {
                if (selector === '#pageNo') return [self.page];
                if (selector === '#pageSize') return [self.size];
                if (selector === '#btn_more') return [self.more];
                if (selector === '[onclick]') return elements.filter(e => e.attrs.onclick);
                if (selector.includes('ck_dep')) return [];
                if (selector.includes('ck_status')) return [self.status];
                return [];
            },
        };
        // Sanitized observed function-local contract, deliberately not executed.
        const getDcairMainList = vm.runInNewContext(`(function getDcairMainList() {
            var TabGubun = 'AS'; var airSect = 'ICN'; var SelectedCityCd = 'PQC';
            var nowYear = '2026'; var nowMonth = '09'; var nowDay = ''; var order = 'LP'; var view = '';
        })`);
        this.context = vm.createContext({ document, getDcairMainList, location: { get href() { return self.url; } },
            getComputedStyle: (e: Element) => ({ display: e.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }),
            URL, console: { log() { throw new Error('no logging'); } } });
        vm.runInContext('window = globalThis', this.context);
        this.more.click = () => { this.more.clicked++; this.onAction?.(); };
        this.month.click = () => { this.month.clicked++; this.onAction?.(); };
        this.city.click = () => { this.city.clicked++; this.onAction?.(); };
    }
    emit(method: string, params: any, sessionId = 'session') {
        if (sessionId === 'session' && method.startsWith('Network.')) {
            const pending = this.paused.get(params.requestId);
            if (pending) { pending.followups.push({ method, params }); return; }
            if (method === 'Network.requestWillBeSent' && this.fetchEnabled
                && new URL(params.request.url).origin + new URL(params.request.url).pathname === 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list') {
                this.paused.set(params.requestId, { start: params, followups: [] });
                if (this.networkFirst) this.emitDirect(method, params, sessionId);
                this.emitDirect('Fetch.requestPaused', { requestId: 'fetch-' + params.requestId, networkId: params.requestId, request: params.request });
                return;
            }
        }
        this.emitDirect(method, params, sessionId);
    }
    async send(method: string, params: any = {}, sessionId?: string): Promise<any> {
        this.calls.push({ method, params, sessionId });
        if (method === 'Target.getTargets') return { targetInfos: [
            { targetId: 'target', type: 'page', url: this.url },
            { targetId: 'private', type: 'page', url: 'https://myaccount.google.com/' },
        ] };
        if (method === 'Target.attachToTarget') return { sessionId: 'session' };
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: this.url } } };
        if (method === 'Runtime.evaluate') return { result: { value: vm.runInContext(params.expression, this.context) } };
        if (method === 'Fetch.enable') this.fetchEnabled = true;
        if (method === 'Fetch.disable') { assert.equal(this.paused.size, 0, 'cleanup must not release pending requests'); this.fetchEnabled = false; }
        if (method === 'Fetch.continueRequest' || method === 'Fetch.failRequest') {
            const id = params.requestId.replace(/^fetch-/, ''); const pending = this.paused.get(id);
            this.paused.delete(id);
            if (pending && method === 'Fetch.continueRequest') {
                assert.deepEqual(params, { requestId: 'fetch-' + id }, 'ordinary request must stay untouched');
                if (!this.networkFirst) this.emitDirect('Network.requestWillBeSent', pending.start);
                pending.followups.forEach(e => this.emitDirect(e.method, e.params));
            }
        }
        if (method === 'Page.reload') this.onAction?.();
        if (method === 'Network.getResponseBody') return { body: this.bodies.get(params.requestId) || '', base64Encoded: false };
        return {};
    }
    onEvent(fn: (e: any) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
    async close() { this.closed = true; }
}
const tests: [string, () => Promise<void>][] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);
let adapterModule: typeof import('../src/lib/onlinetour-browser-adapter');
async function authorizedAdapter(client: FakeCdp, max = 100) {
    const adapter = await adapterModule.createOnlineTourBrowserAdapter(client);
    adapter.authorizeProductRequests(max); return adapter;
}
test('read-only inspect executes static DOM contract and safe detach', async () => {
    assert.ok(fs.existsSync(modulePath), 'real browser adapter implementation must exist');
    adapterModule = await import('../src/lib/onlinetour-browser-adapter');
    const client = new FakeCdp();
    const adapter = await authorizedAdapter(client);
    const snapshot = await adapter.inspect();
    assert.deepEqual(snapshot.currentScope, scope);
    assert.deepEqual(snapshot.availableScopes, [scope, { ...scope, month: '202610' }]);
    assert.equal(snapshot.nextPageNo, 2);
    assert.equal(snapshot.nextPageAvailable, true);
    assert.equal(snapshot.restricted, false);
    assert.equal(adapter.diagnostics.actions, 0);
    assert.equal(adapter.diagnostics.productRequests, 0);
    assert.equal(client.more.clicked + client.city.clicked + client.month.clicked, 0);
    assert.ok(!client.calls.some(c => c.method === 'Page.reload'));
    assert.ok(client.calls.filter(c => c.method === 'Runtime.evaluate').every(c => c.sessionId === 'session'));
    await adapter.close();
    assert.equal(client.closed, true);
    assert.ok(client.calls.some(c => c.method === 'Target.detachFromTarget'));
    assert.ok(!client.calls.some(c => /closeTarget|Browser.close|createTarget/.test(c.method)));
    assert.ok(!client.calls.some(c => /Page.reload|Page.navigate|Page.stopLoading/.test(c.method)));
});

const apiUrl = (pageNo: number, requested = scope) => 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list?' + new URLSearchParams({
    transportStartCity: requested.departure, transportEndCity: requested.city, eventStartMonth: requested.month,
    eventStartDate: '', areaCode: 'AS', order: 'LP', pageNo: String(pageNo), pageSize: '20', pageYn: 'Y',
    depPyunStr: '', statusStr: '', callback: 'offlineCallback',
});
export function respond(client: FakeCdp, pageNo: number, options: { requested?: typeof scope; status?: number; text?: string; document?: boolean; next?: boolean; noRequest?: boolean } = {}) {
    const requested = options.requested || scope;
    if (options.document) {
        client.emit('Network.requestWillBeSent', { requestId: 'document', frameId: 'main', type: 'Document', request: { method: 'GET', url: listUrl } });
        client.bodies.set('document', '<!doctype html><html><body>항공권 목록</body></html>');
        client.emit('Network.responseReceived', { requestId: 'document', frameId: 'main', type: 'Document', response: { url: listUrl, status: 200, headers: { 'content-type': 'text/html' } } });
        client.emit('Network.loadingFinished', { requestId: 'document', encodedDataLength: 80 });
    }
    const url = apiUrl(pageNo, requested);
    if (!options.noRequest) client.emit('Network.requestWillBeSent', { requestId: 'api', type: 'Script', frameId: 'main', request: { method: 'GET', url } });
    client.bodies.set('api', options.text ?? `offlineCallback(${JSON.stringify({ status: 200, data: { list: [{ event_code: 'offline-only' }], paging: { curPage: pageNo, totalLastPage: 2, totalCount: 21 } } })});`);
    client.emit('Network.responseReceived', { requestId: 'api', type: 'Script', frameId: 'main', response: { url, status: options.status ?? 200, headers: { 'content-type': 'text/javascript' } } });
    client.emit('Network.loadingFinished', { requestId: 'api', encodedDataLength: 200 });
    client.page.value = String(pageNo + 1);
    client.more.hidden = options.next === false;
}
test('real more DOM click captures correlated JSONP and terminal screen state', async () => {
    const client = new FakeCdp();
    const adapter = await authorizedAdapter(client);
    client.onAction = () => respond(client, 2, { next: false });
    const result = await adapter.readPage(scope, 2, 1);
    assert.deepEqual(result, { pageNo: 2, totalCount: 21, lastPage: 2, rawProducts: [{ event_code: 'offline-only' }], nextPageAvailable: false });
    assert.equal(client.more.clicked, 1);
    assert.equal(adapter.diagnostics.actions, 1);
    assert.equal(adapter.diagnostics.productRequests, 1);
    assert.ok(client.calls.some(c => c.method === 'Network.getResponseBody'));
    await adapter.close();
});

async function expectKind(fn: () => Promise<unknown>, kind: string, reason?: string) {
    await assert.rejects(fn, (e: any) => e.kind === kind && (!reason || e.message === reason));
}
async function fastDeadlines(fn: () => Promise<void>) {
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((callback: any, ms?: number, ...args: any[]) => original(callback, ms === 90_000 || ms === 5000 || ms === 15_000 ? 15 : ms, ...args)) as typeof setTimeout;
    try { await fn(); } finally { globalThis.setTimeout = original; }
}
for (const status of [401, 403, 429]) test(`HTTP ${status} permanently stops later actions`, async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => respond(client, 2, { status });
    await expectKind(() => adapter.readPage(scope, 2, 1), 'access');
    await expectKind(() => adapter.readPage(scope, 1, 1), 'access');
    assert.equal(adapter.diagnostics.actions, 1);
    assert.ok(client.calls.some(c => c.method === 'Page.stopLoading'));
    await adapter.close();
});
for (const text of ['<html>CAPTCHA</html>', 'offlineCallback({"status":429});']) test(`access body ${text.startsWith('<') ? 'html' : 'api status'} is latched`, async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => respond(client, 2, { text });
    await expectKind(() => adapter.readPage(scope, 2, 1), 'access');
    await expectKind(() => adapter.readPage(scope, 1, 1), 'access');
    await adapter.close();
});
test('transient more failure advanced by site cannot retry or skip page', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => {
        client.emit('Network.requestWillBeSent', { requestId: 'failure', type: 'Script', request: { method: 'GET', url: apiUrl(2) } });
        client.page.value = '3';
        client.emit('Network.loadingFailed', { requestId: 'failure' });
    };
    await expectKind(() => adapter.readPage(scope, 2, 1), 'transient');
    await expectKind(() => adapter.readPage(scope, 2, 2), 'validation', 'unsafe_retry_page_advanced');
    assert.equal(client.more.clicked, 1); assert.equal(client.page.value, '3');
    await adapter.close();
});
test('first page reload validates fresh document and fresh API', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => respond(client, 1, { document: true });
    assert.equal((await adapter.readPage(scope, 1, 1)).pageNo, 1);
    assert.equal(adapter.diagnostics.documentRequests, 1);
    assert.equal(client.calls.filter(c => c.method === 'Page.reload').length, 1);
    await adapter.close();
});
test('one-click observed month verifies new scope without guessed navigation', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    const next = { ...scope, month: '202610' };
    client.onAction = () => {
        const source = vm.runInContext('getDcairMainList.toString()', client.context).replace("nowMonth = '09'", "nowMonth = '10'");
        vm.runInContext(`getDcairMainList = (${source})`, client.context);
        respond(client, 1, { requested: next, document: true });
    };
    assert.equal((await adapter.readPage(next, 1, 1)).pageNo, 1);
    assert.equal(client.month.clicked, 1);
    assert.ok(!client.calls.some(c => c.method === 'Page.navigate' || c.method === 'Page.reload'));
    await adapter.close();
});
test('unreachable scopes and restrictive checkboxes cause zero actions', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    await expectKind(() => adapter.readPage({ ...scope, departure: 'PUS' }, 1, 1), 'validation', 'unreachable_scope');
    client.status.value = '00'; client.status.checked = true;
    await expectKind(() => adapter.readPage(scope, 1, 1), 'validation');
    assert.equal(adapter.diagnostics.actions, 0); assert.equal(client.status.checked, true);
    await adapter.close();
});
test('wrong API scope is rejected and permanently stops actions', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => respond(client, 2, { requested: { ...scope, city: 'NRT' } });
    await expectKind(() => adapter.readPage(scope, 2, 1), 'validation');
    await expectKind(() => adapter.readPage(scope, 1, 1), 'validation');
    assert.equal(adapter.diagnostics.actions, 1); await adapter.close();
});
for (const text of ['offlineCallback({bad});', 'offlineCallback({"status":200,"data":{"list":[]}});evil()', 'offlineCallback({"status":200,"data":{"list":[]}});']) test(`malformed JSONP or absent paging rejected: ${text.length}`, async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => respond(client, 2, { text });
    await expectKind(() => adapter.readPage(scope, 2, 1), 'validation'); await adapter.close();
});
test('unmatched stale API response cannot satisfy deadline', async () => fastDeadlines(async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => respond(client, 2, { noRequest: true });
    await expectKind(() => adapter.readPage(scope, 2, 1), 'transient', 'action_deadline');
    assert.ok(!client.calls.some(c => c.method === 'Network.getResponseBody'));
    assert.equal(adapter.diagnostics.productRequests, 0); await adapter.close();
}));
test('no events times out; late query is blocked without changing action results', async () => fastDeadlines(async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    await expectKind(() => adapter.readPage(scope, 2, 1), 'transient', 'action_deadline');
    const before = { ...adapter.diagnostics };
    respond(client, 2);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(adapter.diagnostics, { ...before, blockedProductRequests: before.blockedProductRequests + 1 });
    assert.equal(client.emittedRequests.length, 0);
    assert.deepEqual(adapter.partialEvidence, []);
    await adapter.close();
}));
test('redirect to login never reads private document DOM', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.url = 'https://www.onlinetour.co.kr/login';
    await expectKind(() => adapter.readPage(scope, 1, 1), 'access');
    assert.ok(!client.calls.some(c => c.method === 'Runtime.evaluate'));
    assert.equal(adapter.diagnostics.actions, 0); await adapter.close();
});
test('connector exports real normal-Chrome entrypoint', async () => {
    assert.equal(typeof adapterModule.connectNormalChrome, 'function');
});

test('pending body command is bounded and cannot mutate finalized result', async () => fastDeadlines(async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    const send = client.send.bind(client);
    let release: ((value: any) => void) | undefined;
    client.send = (method, params, sessionId) => method === 'Network.getResponseBody'
        ? new Promise(resolve => { release = resolve; }) : send(method, params, sessionId);
    client.onAction = () => respond(client, 2);
    const outcome = await Promise.race([
        adapter.readPage(scope, 2, 1).then(() => 'success', (e: any) => e.kind),
        new Promise(resolve => setTimeout(() => resolve('unbounded'), 150)),
    ]);
    assert.equal(outcome, 'transient');
    const before = JSON.stringify(adapter.diagnostics);
    release?.({ body: '<html>CAPTCHA</html>', base64Encoded: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(JSON.stringify(adapter.diagnostics), before);
    await adapter.close();
}));

class FakeSocket extends EventEmitter {
    readyState = 1; sent: any[] = []; terminated = false;
    send(text: string, callback: (error?: Error) => void) { this.sent.push(JSON.parse(text)); callback(); }
    close() { this.readyState = 3; this.emit('close'); }
    terminate() { this.terminated = true; this.close(); }
}
test('raw WebSocket transport correlates IDs, sessions, errors and disconnects safely', async () => {
    const socket = new FakeSocket(); const client = await adapterModule.connectRawCdpSocket(socket);
    const eventLog: any[] = [];
    const off = client.onEvent(e => eventLog.push(e));
    const first = client.send('Runtime.evaluate', { expression: '1' }, 'only-target');
    const second = client.send('Page.getFrameTree', {}, 'only-target');
    assert.deepEqual(socket.sent.map(p => p.sessionId), ['only-target', 'only-target']);
    socket.emit('message', JSON.stringify({ id: socket.sent[1].id, result: { second: true } }));
    socket.emit('message', JSON.stringify({ method: 'Network.loadingFinished', params: { requestId: 'r' }, sessionId: 'only-target' }));
    socket.emit('message', JSON.stringify({ id: socket.sent[0].id, result: { first: true } }));
    assert.deepEqual(await first, { first: true }); assert.deepEqual(await second, { second: true });
    assert.equal(eventLog.length, 1); off();
    const failed = client.send('Unknown');
    socket.emit('message', JSON.stringify({ id: socket.sent[2].id, error: { message: 'SECRET_ENDPOINT' } }));
    await expectKind(() => failed, 'transient', 'cdp_command_failed');
    await client.close();
    assert.equal(socket.readyState, 3);
    assert.ok(!socket.sent.some(p => /Browser.close|closeTarget/.test(p.method)));
});
test('raw WebSocket command timeout is sanitized and late replies ignored', async () => fastDeadlines(async () => {
    const socket = new FakeSocket(); const client = await adapterModule.connectRawCdpSocket(socket);
    await expectKind(() => client.send('Runtime.evaluate'), 'transient', 'cdp_command_deadline');
    socket.emit('message', JSON.stringify({ id: socket.sent[0].id, result: { late: true } }));
    await client.close();
}));
test('document access body overrides a successful API before return', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => {
        respond(client, 1, { document: true });
        client.bodies.set('document', '<html>access denied</html>');
    };
    await expectKind(() => adapter.readPage(scope, 1, 1), 'access');
    await expectKind(() => adapter.readPage(scope, 1, 2), 'access');
    assert.equal(adapter.diagnostics.actions, 1); await adapter.close();
});
test('read-only DOM evaluation checks URL before reading a raced-away page', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    const send = client.send.bind(client);
    client.send = async (method, params, sessionId) => {
        if (method === 'Runtime.evaluate') {
            client.url = 'https://example.com/private';
            vm.runInContext("Object.defineProperty(document, 'body', {get(){throw new Error('private_body_read')}})", client.context);
        }
        return send(method, params, sessionId);
    };
    await expectKind(() => adapter.inspect(), 'access', 'target_left_list');
    await adapter.close();
});

for (const redirectEvent of [true, false]) test(`S1 outside API response never read (redirect event ${redirectEvent})`, async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => {
        client.emit('Network.requestWillBeSent', { requestId: 'outside', type: 'Script', request: { method: 'GET', url: apiUrl(2) } });
        if (redirectEvent) client.emit('Network.requestWillBeSent', { requestId: 'outside', type: 'Script', redirectResponse: { status: 302 }, request: { method: 'GET', url: 'https://example.com/private' } });
        client.emit('Network.responseReceived', { requestId: 'outside', type: 'Script', response: { url: 'https://example.com/private', status: 200 } });
        client.emit('Network.loadingFinished', { requestId: 'outside', encodedDataLength: 10 });
    };
    await expectKind(() => adapter.readPage(scope, 2, 1), 'validation');
    assert.ok(!client.calls.some(c => c.method === 'Network.getResponseBody'));
    await adapter.close();
});

for (const event of ['http', 'target', 'frame']) test(`L1 inspect ambient ${event} is read-only`, async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    await adapter.inspect();
    if (event === 'http') client.emit('Network.responseReceived', { response: { url: apiUrl(1), status: 429 } });
    if (event === 'target') client.emit('Target.targetInfoChanged', { targetInfo: { targetId: 'target', url: 'https://example.com/private' } });
    if (event === 'frame') client.emit('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/private' } });
    assert.equal((await adapter.inspect()).restricted, true);
    await adapter.close();
    assert.equal(adapter.diagnostics.actions, 0);
    assert.ok(!client.calls.some(c => /Page.reload|Page.navigate|Page.stopLoading|Fetch.enable/.test(c.method)));
});

for (const advance of [true, false]) test(`L3 first page retry requires unchanged original pagination (${advance})`, async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => {
        client.emit('Network.requestWillBeSent', { requestId: 'failed', type: 'Script', request: { method: 'GET', url: apiUrl(1) } });
        if (advance) client.page.value = '3';
        client.emit('Network.loadingFailed', { requestId: 'failed' });
    };
    await expectKind(() => adapter.readPage(scope, 1, 1), 'transient');
    client.onAction = () => respond(client, 1, { document: true });
    if (advance) await expectKind(() => adapter.readPage(scope, 1, 2), 'validation', 'unsafe_retry_page_advanced');
    else assert.equal((await adapter.readPage(scope, 1, 2)).pageNo, 1);
    assert.equal(client.calls.filter(c => c.method === 'Page.reload').length, advance ? 1 : 2);
    await adapter.close();
});

export const validRow = (id: string) => ({
    event_code: id, event_status_code: '00', dep_start_date: '20260907', arr_start_date: '09-10(목)',
    dep_start_time: '02:10', dep_end_time: '0535', arr_start_time: '1745', arr_end_time: '01:10',
    adult_price: '469000', adult_fee_price: '0', res_cnt: '8', start_city_code: 'ICN', start_city_code_name: '인천',
    start_city_code2: 'PQC', start_city_code_name2: '푸꾸옥', end_city_code: 'PQC', end_city_code2: 'ICN',
    arr_city_code: 'PQC', arr_city_code_name: '푸꾸옥', transport_detail_name: '비엣젯항공',
});
export const rowBody = (pageNo: number, rows: Record<string, unknown>[]) => `offlineCallback(${JSON.stringify({ status: 200, data: {
    list: rows, paging: { curPage: pageNo, totalLastPage: 2, totalCount: 2 } } })});`;
for (const gate of ['document', 'dom']) test(`L2 ${gate} failure preserves only validated orphan rows defensively`, async () => fastDeadlines(async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => {
        respond(client, 1, { document: gate === 'dom', text: rowBody(1, [validRow('orphan'), { event_code: 'invalid' }]) });
        if (gate === 'dom') client.status.checked = true, client.status.value = '00';
    };
    await assert.rejects(() => adapter.readPage(scope, 1, 1));
    const evidence = (adapter as any).partialEvidence;
    assert.ok(Array.isArray(evidence), 'failed-page evidence getter required');
    assert.equal(evidence.length, 1);
    assert.deepEqual(evidence[0].rawProducts, [validRow('orphan')]);
    assert.equal(evidence[0].flights[0].id, 'online-orphan');
    assert.equal(evidence[0].pageNo, 1); assert.equal(evidence[0].attempt, 1);
    evidence[0].rawProducts[0].event_code = 'mutated'; evidence[0].flights[0].price = 0;
    assert.equal((adapter as any).partialEvidence[0].rawProducts[0].event_code, 'orphan');
    assert.equal((adapter as any).partialEvidence[0].flights[0].price, 469000);
    await adapter.close();
}));
test('L2 returned pages are not duplicated as orphan evidence', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client);
    client.onAction = () => respond(client, 2, { text: rowBody(2, [validRow('accepted')]) });
    await adapter.readPage(scope, 2, 1);
    assert.deepEqual((adapter as any).partialEvidence, []); await adapter.close();
});

test('L4 concurrent queries reserve cap before dispatch, unchanged exact request, late traffic blocked', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client, 1);
    assert.ok(!client.calls.some(c => c.method === 'Fetch.enable'), 'authorization alone is inert');
    const first = { method: 'GET', url: apiUrl(2) + '&key=offline-key', headers: { 'X-Offline': 'unchanged', Cookie: 'fake-only' }, postData: '' };
    client.onAction = () => {
        client.emit('Network.requestWillBeSent', { requestId: 'one', type: 'Script', request: first });
        client.emit('Network.requestWillBeSent', { requestId: 'two', type: 'Script', request: { ...first } });
    };
    await expectKind(() => adapter.readPage(scope, 2, 1), 'validation');
    assert.equal(client.emittedRequests.length, 1, 'second query must be aborted BEFORE network emission');
    assert.deepEqual(client.emittedRequests[0].request, first);
    assert.deepEqual(client.calls.filter(c => c.method === 'Fetch.continueRequest').map(c => c.params), [{ requestId: 'fetch-one' }]);
    assert.ok(client.calls.some(c => c.method === 'Fetch.failRequest' && c.params.requestId === 'fetch-two'));
    const enable = client.calls.find(c => c.method === 'Fetch.enable')!;
    assert.equal(enable.sessionId, 'session');
    assert.deepEqual(enable.params, { patterns: [
        { urlPattern: 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list', requestStage: 'Request' },
        { urlPattern: 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list\\?*', requestStage: 'Request' },
    ] });
    client.emit('Network.requestWillBeSent', { requestId: 'late', type: 'Script', request: first });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(client.emittedRequests.length, 1);
    assert.equal((adapter.diagnostics as any).permittedProductRequests, 1);
    assert.equal((adapter.diagnostics as any).blockedProductRequests, 2);
    assert.equal(adapter.diagnostics.productRequests, 1);
    await adapter.close(); assert.equal(client.paused.size, 0);
});

test('L4 unapproved adapter refuses owned action and stays read-only', async () => {
    const client = new FakeCdp(); const adapter = await adapterModule.createOnlineTourBrowserAdapter(client);
    await adapter.inspect();
    await expectKind(() => adapter.readPage(scope, 1, 1), 'validation', 'query_authorization_required');
    for (const max of [0, -1, 1.5, 101, NaN]) assert.throws(() => adapter.authorizeProductRequests(max));
    adapter.authorizeProductRequests(2);
    assert.throws(() => adapter.authorizeProductRequests(3));
    await adapter.close();
    assert.ok(!client.calls.some(c => /Page.reload|Page.navigate|Page.stopLoading|Fetch.enable/.test(c.method)));
});
test('L4 exact outside paused URLs and other sessions never receive permission', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client, 2);
    client.onAction = () => {
        client.emit('Fetch.requestPaused', { requestId: 'foreign', request: { method: 'GET', url: apiUrl(2) } }, 'another-session');
        client.emit('Fetch.requestPaused', { requestId: 'outside', request: { method: 'GET', url: 'https://api.onlinetour.co.kr/v2/flight/international/dcair/listExtra' } });
    };
    await expectKind(() => adapter.readPage(scope, 2, 1), 'validation');
    assert.equal(adapter.diagnostics.permittedProductRequests, 0);
    assert.equal(adapter.diagnostics.blockedProductRequests, 1);
    assert.ok(!client.calls.some(c => c.method === 'Fetch.continueRequest' || c.params?.requestId === 'foreign'));
    assert.ok(client.calls.some(c => c.method === 'Fetch.failRequest' && c.params.requestId === 'outside'));
    await adapter.close();
});
test('L4 two actual queries exhaust authorization before any third UI action', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client, 2);
    client.onAction = () => respond(client, 1, { document: true });
    await adapter.readPage(scope, 1, 1);
    client.onAction = () => respond(client, 2);
    await adapter.readPage(scope, 2, 1);
    await expectKind(() => adapter.readPage(scope, 1, 1), 'validation', 'product_query_budget_exhausted');
    assert.equal(adapter.diagnostics.actions, 2); assert.equal(adapter.diagnostics.productRequests, 2);
    assert.equal(adapter.diagnostics.permittedProductRequests, 2);
    await adapter.close();
});
test('L4 cleanup does not disable or detach unresolved pauses and closes failed transport', async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client, 1);
    client.onAction = () => respond(client, 2);
    await adapter.readPage(scope, 2, 1);
    const original = client.send.bind(client);
    client.send = async (method, params, sessionId) => {
        if (method === 'Fetch.failRequest') throw new Error('offline abort unavailable');
        return original(method, params, sessionId);
    };
    client.emit('Network.requestWillBeSent', { requestId: 'pending', type: 'Script', request: { method: 'GET', url: apiUrl(2) } });
    await new Promise(resolve => setTimeout(resolve, 0));
    await assert.rejects(() => adapter.close());
    assert.equal(client.paused.size, 1);
    assert.ok(!client.calls.some(c => c.method === 'Fetch.disable' || c.method === 'Target.detachFromTarget'));
    assert.equal(client.closed, true, 'cleanup error must not leave the WebSocket attached');
    assert.ok(client.calls.filter(c => c.method === 'Page.stopLoading').length >= 1);
    assert.equal(client.calls.filter(c => c.method === 'Fetch.continueRequest').length, 1);
    await adapter.close();
});
test('L4 a pause during guard arming is off-action, never grants a query or reload', async () => fastDeadlines(async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client, 1);
    const original = client.send.bind(client);
    client.send = async (method, params, sessionId) => {
        const result = await original(method, params, sessionId);
        if (method === 'Fetch.enable') client.emit('Network.requestWillBeSent', { requestId: 'ambient', type: 'Script', request: { method: 'GET', url: apiUrl(1) } });
        return result;
    };
    await expectKind(() => adapter.readPage(scope, 1, 1), 'validation', 'off_action_query');
    assert.equal(adapter.diagnostics.permittedProductRequests, 0);
    assert.equal(client.emittedRequests.length, 0);
    assert.ok(!client.calls.some(c => c.method === 'Page.reload' || c.method === 'Fetch.continueRequest'));
    await adapter.close();
}));

for (const command of ['Fetch.disable', 'Target.detachFromTarget']) test(`L4 cleanup ${command} failure closes transport and reports failure`, async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client, 1);
    client.onAction = () => respond(client, 2); await adapter.readPage(scope, 2, 1);
    const original = client.send.bind(client);
    client.send = async (method, params, sessionId) => {
        if (method === command) throw new Error('offline cleanup command failure');
        return original(method, params, sessionId);
    };
    await assert.rejects(() => adapter.close());
    assert.equal(client.closed, true);
});
test('L4 continuous late pauses cannot extend aggregate cleanup deadline', async () => fastDeadlines(async () => {
    const client = new FakeCdp(); const adapter = await authorizedAdapter(client, 1);
    client.onAction = () => respond(client, 2); await adapter.readPage(scope, 2, 1);
    const original = client.send.bind(client); let sequence = 0, cleanupStarted = false;
    const late = () => client.emit('Network.requestWillBeSent', { requestId: `late-${++sequence}`, type: 'Script', request: { method: 'GET', url: apiUrl(2) } });
    client.send = async (method, params, sessionId) => {
        if (method === 'Page.stopLoading') cleanupStarted = true;
        const result = await original(method, params, sessionId);
        if (method === 'Fetch.failRequest') {
            await new Promise(resolve => setTimeout(resolve, 1));
            if (!client.closed) late();
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        return result;
    };
    late();
    const result = await Promise.race([adapter.close().then(() => 'closed', () => 'failed'),
        new Promise(resolve => setTimeout(() => resolve('unbounded'), 150))]);
    assert.equal(result, 'failed', 'continuous pauses must hit the aggregate cleanup deadline');
    assert.equal(cleanupStarted, true); assert.equal(client.closed, true);
    assert.equal(client.calls.filter(c => c.method === 'Fetch.continueRequest').length, 1);
}));

test('L4 Network start before Fetch pause is observation only, not permission', async () => {
    const client = new FakeCdp(); client.networkFirst = true;
    const adapter = await authorizedAdapter(client, 1);
    client.onAction = () => {
        client.emit('Network.requestWillBeSent', { requestId: 'first', type: 'Script', request: { method: 'GET', url: apiUrl(2) } });
        // Let the first reserved continuation dispatch before a second observed start.
        setTimeout(() => client.emit('Network.requestWillBeSent', { requestId: 'second', type: 'Script', request: { method: 'GET', url: apiUrl(2) } }), 0);
    };
    await expectKind(() => adapter.readPage(scope, 2, 1), 'validation');
    assert.equal(adapter.diagnostics.productRequests, 2, 'CDP observed starts include a blocked query');
    assert.equal(adapter.diagnostics.permittedProductRequests, 1);
    assert.equal(adapter.diagnostics.blockedProductRequests, 1);
    assert.deepEqual(client.calls.filter(c => c.method === 'Fetch.continueRequest').map(c => c.params), [{ requestId: 'fetch-first' }]);
    await adapter.close();
});

async function main() {
    let passed = 0;
    for (const [name, fn] of tests) {
        try { await fn(); passed++; console.log(`PASS ${name}`); }
        catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; break; }
    }
    console.log(`Offline adapter tests: ${passed}/${tests.length} passed; live requests: 0`);
}
if (require.main === module) void main();
