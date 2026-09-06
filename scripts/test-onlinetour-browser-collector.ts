import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { Browser } from 'playwright';
import { spawnSync } from 'node:child_process';
import * as collector from '../src/lib/onlinetour-browser-collector';

// Sanitized public real-sample subset from onlinetour-probe-products.json.
// Offline fixture only; the wrapper and later test mutations are synthetic.
const sample = {
    event_code: '260907907138', event_status_code: '00', dep_start_date: '20260907', arr_start_date: '09-10(목)',
    dep_start_time: '02:10', dep_end_time: '0535', arr_start_time: '1745', arr_end_time: '01:10',
    adult_price: '469000', adult_fee_price: '0', res_cnt: '8',
    start_city_code: 'ICN', start_city_code_name: '인천', start_city_code2: 'PQC',
    start_city_code_name2: '푸꾸옥', end_city_code: 'PQC', end_city_code2: 'ICN',
    arr_city_code: 'PQC', arr_city_code_name: '푸꾸옥', transport_detail_name: '비엣젯항공',
};
const jsonp = (rows: unknown[] = [sample], status = 200) =>
    `siteCallback(${JSON.stringify({ status, data: { list: rows } })});`;

test('real-sample JSONP maps without losing raw fields; always partial pilot', () => {
    assert.equal(typeof collector.validatePilotResponse, 'function', 'pilot validator must exist');
    const result = collector.validatePilotResponse(jsonp(), 'siteCallback');
    assert.equal(result.status, 'pilot_ready_for_review');
    assert.deepEqual(result.rawProducts, [sample]);
    assert.equal(result.flights[0].departure.time, '02:10');
    assert.equal(result.flights[0].departure.arrivalTime, '05:35');
    assert.equal(result.flights[0].arrival.date, '2026-09-10');
    assert.equal(result.flights[0].availableSeats, 8);
    assert.equal(result.flights[0].price, 469000);
    assert.equal(result.partialScope, true);
});

for (const [field, value] of [
    ['dep_start_time', '99:99'], ['dep_end_time', '2400'], ['arr_start_time', ''],
    ['arr_end_time', 'at 01:10'], ['dep_start_time', '210'], ['arr_start_time', null],
    ['dep_start_date', '20260230'], ['arr_start_date', '09-31(목)'],
    ['arr_start_date', '09-01(화)'], ['adult_price', 'NaN'], ['adult_fee_price', null],
    ['adult_fee_price', '-1'], ['res_cnt', '-1'], ['res_cnt', '1.5'], ['res_cnt', null],
] as const) {
    test(`reject invalid ${field}=${JSON.stringify(value)} without silent normalization`, () => {
        const result = collector.validatePilotResponse(jsonp([sample, { ...sample, event_code: 'invalid-fixture', [field]: value }]), 'siteCallback');
        assert.equal(result.status, 'failed_validation');
        assert.equal(result.rawProducts.length, 2);
        assert.equal(result.flights.length, 1);
        assert.equal(result.issues[0].row, 1);
    });
}
test('empty, oversized, duplicate and malformed lists are not pilot success', () => {
    for (const rows of [[], [sample, sample], [null], Array.from({ length: 21 }, (_, i) => ({ ...sample, event_code: `fixture-${i}` }))]) {
        assert.equal(collector.validatePilotResponse(jsonp(rows), 'siteCallback').status, 'failed_validation');
    }
    assert.throws(() => collector.validatePilotResponse(jsonp() + 'evil();', 'siteCallback'));
    assert.throws(() => collector.validatePilotResponse(jsonp(), 'otherCallback'));
});
test('zero known seats remains zero, never unknown', () => {
    const result = collector.validatePilotResponse(jsonp([{ ...sample, res_cnt: '0' }]), 'siteCallback');
    assert.equal(result.flights[0].availableSeats, 0);
});

const wsPath = '/devtools/browser/12345678-1234-4abc-8abc-123456789abc';
test('DevToolsActivePort accepts only strict port and browser UUID path', () => {
    assert.equal(typeof collector.parseDevToolsActivePort, 'function');
    assert.equal(collector.parseDevToolsActivePort(`54321\r\n${wsPath}\r\n`), `ws://127.0.0.1:54321${wsPath}`);
    for (const value of [`0\n${wsPath}`, `65536\n${wsPath}`, `080\n${wsPath}`, ` 54321\n${wsPath}`,
        `54321\nws://evil.test${wsPath}`, `54321\n${wsPath}?token=x`, `54321\n${wsPath}/../page`,
        `54321\n${wsPath}\nextra`, `54321\n/devtools/page/1234`, `-1\n${wsPath}`]) {
        assert.throws(() => collector.parseDevToolsActivePort(value));
    }
});
function temporaryRepo() { return fs.mkdtempSync(path.join(os.tmpdir(), 'onlinetour-offline-test-')); }
test('discovery reads only normal User Data discovery file, no endpoint override', () => {
    assert.equal(typeof collector.discoverNormalChromeEndpoint, 'function');
    const root = temporaryRepo();
    try {
        const dir = path.join(root, 'Google', 'Chrome', 'User Data');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), `54321\n${wsPath}`);
        assert.equal(collector.discoverNormalChromeEndpoint(root), `ws://127.0.0.1:54321${wsPath}`);
        assert.throws(() => collector.discoverNormalChromeEndpoint('relative'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('staging uses UUID directories and exclusive fixed filenames, never operational writes', () => {
    assert.equal(typeof collector.createStagingRun, 'function');
    const root = temporaryRepo();
    try {
        fs.mkdirSync(path.join(root, 'data'));
        fs.writeFileSync(path.join(root, 'data', 'all-flights-cache.json'), 'do-not-touch');
        const first = collector.createStagingRun(root);
        const second = collector.createStagingRun(root);
        assert.notEqual(first.directory, second.directory);
        assert.equal(path.dirname(first.directory), path.join(root, '.local-crawler', 'staging'));
        assert.match(path.basename(first.directory), /^[0-9a-f-]{36}$/);
        first.write('raw-products.json', [sample]);
        assert.throws(() => first.write('raw-products.json', []));
        assert.throws(() => first.write('../escape.json' as never, []));
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(first.directory, 'raw-products.json'), 'utf8')), [sample]);
        assert.equal(fs.readFileSync(path.join(root, 'data', 'all-flights-cache.json'), 'utf8'), 'do-not-touch');
        assert.deepEqual(fs.readdirSync(root).sort(), ['.local-crawler', 'data']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
for (const linkedComponent of ['.local-crawler', 'staging']) {
    test(`reject ${linkedComponent} junction/symlink before writing`, () => {
        const root = temporaryRepo(); const outside = temporaryRepo();
        try {
            const parent = linkedComponent === 'staging' ? path.join(root, '.local-crawler') : root;
            fs.mkdirSync(parent, { recursive: true });
            fs.symlinkSync(outside, path.join(parent, linkedComponent), 'junction');
            assert.throws(() => collector.createStagingRun(root));
            assert.deepEqual(fs.readdirSync(outside), []);
        } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
    });
}



const listUrl = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
const apiUrl = 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list?callback=siteCallback&pageNo=1&pageSize=20&pageYn=Y&transportStartCity=ICN&transportEndCity=PQC&eventStartMonth=202609';
function browserFixture(options: { body?: string; status?: number; noResponse?: boolean; networkError?: boolean;
    google?: string; target?: string; duplicate?: boolean; stalledBody?: boolean; api?: string } = {}) {
    const page = new EventEmitter() as EventEmitter & Record<string, any>;
    const counts = { reload: 0, stop: 0, disconnect: 0, detach: 0, text: 0 };
    const frame = {};
    page.url = () => options.target ?? listUrl;
    page.mainFrame = () => frame;
    page.reload = async () => {
        counts.reload++;
        if (options.noResponse) return;
        const request = { url: () => options.api ?? apiUrl, method: () => 'GET',
            isNavigationRequest: () => false, frame: () => frame };
        page.emit('request', request);
        if (options.networkError) { page.emit('requestfailed', request); return; }
        page.emit('response', { url: request.url, status: () => options.status ?? 200, request: () => request,
            text: async () => { counts.text++; return options.stalledBody ? new Promise<string>(() => {}) : (options.body ?? jsonp()); } });
    };
    const google = { url: () => options.google ?? 'https://myaccount.google.com/' };
    // No DOM/storage/evaluate/cookies methods exist on non-target pages.
    const other = { url: () => 'https://unrelated.example/private' };
    const context = { pages: () => options.duplicate ? [page, page, google, other] : [page, google, other],
        newCDPSession: async (target: unknown) => {
            assert.equal(target, page);
            return { send: async (command: string) => { assert.equal(command, 'Page.stopLoading'); counts.stop++; },
                detach: async () => { counts.detach++; } };
        } };
    page.context = () => context;
    const browser = { contexts: () => [context], close: async () => { counts.disconnect++; } } as unknown as Browser;
    return { browser, counts, page };
}
test('diagnostics distinguish no API request from a pending API body without leaking URLs', async () => {
    for (const [options, waiting] of [
        [{ noResponse: true }, ['api_request']],
        [{ stalledBody: true }, ['api_body']],
    ] as const) {
        const root = temporaryRepo(); const mock = browserFixture(options);
        try {
            const run = collector.createStagingRun(root);
            const summary = await collector.collectBrowserPilot(mock.browser, run, 25);
            const diagnostics = (summary as any).diagnostics;
            assert.ok(diagnostics, 'failure must have stage diagnostics');
            assert.deepEqual(diagnostics.waitingAtFailure, waiting);
            assert.equal(diagnostics.stages.reload_started.count, 1);
            assert.equal(diagnostics.stages.reload_completed.count, 1);
            assert.equal(diagnostics.http.api, 'stalledBody' in options ? 200 : null);
            assert.equal(JSON.stringify(diagnostics).includes('https://'), false);
            assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run.directory, 'summary.json'), 'utf8')).diagnostics, diagnostics);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});

test('received products survive a later navigation timeout, but the pilot remains failed', async () => {
    const root = temporaryRepo(); const mock = browserFixture();
    const originalReload = mock.page.reload;
    mock.page.reload = async () => { await originalReload(); return new Promise<void>(() => {}); };
    try {
        const run = collector.createStagingRun(root);
        const summary = await collector.collectBrowserPilot(mock.browser, run, 25);
        assert.equal(summary.status, 'failed_timeout');
        assert.equal(summary.rawCount, 1, 'a parsed response must not be reported as zero because navigation stalled');
        assert.equal(summary.mappedCount, 1);
        assert.deepEqual(summary.diagnostics.waitingAtFailure, ['navigation']);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run.directory, 'raw-products.json'), 'utf8')), [sample]);
        assert.equal(summary.productionReady, false);
        assert.equal(mock.counts.reload, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('diagnostics distinguish a requested API with no response from a stalled document body', async () => {
    for (const documentStalled of [false, true]) {
        const root = temporaryRepo(); const mock = browserFixture({ noResponse: !documentStalled });
        const originalReload = mock.page.reload;
        mock.page.reload = async () => {
            const request = { url: () => documentStalled ? listUrl : apiUrl, method: () => 'GET',
                isNavigationRequest: () => documentStalled, frame: () => mock.page.mainFrame() };
            mock.page.emit('request', request);
            if (documentStalled) mock.page.emit('response', { url: request.url, status: () => 200,
                request: () => request, text: () => new Promise<string>(() => {}) });
            await originalReload();
        };
        try {
            const run = collector.createStagingRun(root);
            const summary = await collector.collectBrowserPilot(mock.browser, run, 25);
            assert.equal(summary.status, 'failed_timeout');
            assert.deepEqual(summary.diagnostics.waitingAtFailure, [documentStalled ? 'document_body' : 'api_response']);
            assert.equal(summary.rawCount, documentStalled ? 1 : 0);
            assert.equal(summary.diagnostics.stages.api_request?.count, 1);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});

test('a late API body cannot change returned or saved timeout evidence', async () => {
    const root = temporaryRepo(); const mock = browserFixture({ noResponse: true });
    let finishBody!: (body: string) => void;
    const body = new Promise<string>(resolve => { finishBody = resolve; });
    const originalReload = mock.page.reload;
    mock.page.reload = async () => {
        await originalReload();
        const request = { url: () => apiUrl, method: () => 'GET',
            isNavigationRequest: () => false, frame: () => mock.page.mainFrame() };
        mock.page.emit('request', request);
        mock.page.emit('response', { url: request.url, status: () => 200, request: () => request, text: () => body });
    };
    try {
        const run = collector.createStagingRun(root);
        const summary = await collector.collectBrowserPilot(mock.browser, run, 25);
        const before = JSON.stringify(summary);
        finishBody(jsonp());
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(JSON.stringify(summary), before);
        assert.equal(summary.rawCount, 0);
        assert.equal(fs.readFileSync(path.join(run.directory, 'summary.json'), 'utf8'), JSON.stringify(summary, null, 2) + '\n');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('document access restriction after API validation remains failed with received rows as evidence only', async () => {
    const root = temporaryRepo(); const mock = browserFixture();
    let finishDocument!: (body: string) => void;
    const document = new Promise<string>(resolve => { finishDocument = resolve; });
    const originalReload = mock.page.reload;
    mock.page.reload = async () => {
        const request = { url: () => listUrl, isNavigationRequest: () => true, frame: () => mock.page.mainFrame() };
        mock.page.emit('response', { url: request.url, status: () => 200, request: () => request, text: () => document });
        await originalReload();
        setImmediate(() => finishDocument('<html>access denied</html>'));
    };
    try {
        const run = collector.createStagingRun(root);
        const summary = await collector.collectBrowserPilot(mock.browser, run, 1000);
        assert.equal(summary.status, 'failed_access_restriction');
        assert.equal(summary.rawCount, 1);
        assert.equal(summary.productionReady, false);
        assert.equal(mock.counts.reload, 1);
        assert.equal(mock.counts.stop, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('terminal HTTP error is recorded as a received rejection, not a missing response', async () => {
    for (const status of [403, 500]) {
        const root = temporaryRepo(); const mock = browserFixture({ status });
        try {
            const summary = await collector.collectBrowserPilot(mock.browser, collector.createStagingRun(root), 1000);
            assert.equal(summary.diagnostics.http.api, status);
            assert.equal(summary.diagnostics.stages.api_response?.count, 1);
            assert.deepEqual(summary.diagnostics.waitingAtFailure, [], 'terminal rejection is not an outstanding wait');
            assert.equal(summary.status, status === 403 ? 'failed_access_restriction' : 'failed_network');
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});

test('one existing-tab reload captures first site JSONP to staging, disconnects only', async () => {
    assert.equal(typeof collector.collectBrowserPilot, 'function');
    const root = temporaryRepo(); const mock = browserFixture();
    try {
        const run = collector.createStagingRun(root);
        const summary = await collector.collectBrowserPilot(mock.browser, run, 1000);
        assert.equal(summary.status, 'pilot_ready_for_review');
        assert.equal(summary.rawCount, 1); assert.equal(summary.mappedCount, 1);
        assert.equal(summary.partialScope, true); assert.equal(summary.productionReady, false);
        assert.equal(summary.preflight.googleHomeTabPresent, true);
        assert.deepEqual(mock.counts, { reload: 1, stop: 1, disconnect: 1, detach: 1, text: 1 });
        assert.equal(mock.page.listenerCount('response'), 0);
        assert.deepEqual(fs.readdirSync(run.directory).sort(), ['flights.json', 'raw-products.json', 'summary.json']);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run.directory, 'raw-products.json'), 'utf8')), [sample]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


for (const [name, options, status] of [
    ['HTTP401', { status: 401 }, 'failed_access_restriction'],
    ['HTTP403', { status: 403 }, 'failed_access_restriction'],
    ['HTTP429', { status: 429 }, 'failed_access_restriction'],
    ['CAPTCHA', { body: '<html>CAPTCHA access denied</html>' }, 'failed_access_restriction'],
    ['API403', { body: jsonp([], 403) }, 'failed_access_restriction'],
    ['network error', { networkError: true }, 'failed_network'],
    ['HTTP500', { status: 500 }, 'failed_network'],
    ['response timeout', { noResponse: true }, 'failed_timeout'],
    ['body timeout', { stalledBody: true }, 'failed_timeout'],
    ['empty list', { body: jsonp([]) }, 'failed_validation'],
    ['invalid mapping', { body: jsonp([{ ...sample, dep_start_time: '99:99' }]) }, 'failed_validation'],
    ['wrong page size', { api: apiUrl.replace('pageSize=20', 'pageSize=100') }, 'failed_validation'],
    ['wrong page', { api: apiUrl.replace('pageNo=1', 'pageNo=2') }, 'failed_validation'],
    ['wrong host', { api: apiUrl.replace('api.onlinetour.co.kr', 'evil.test') }, 'failed_timeout'],
    ['no Google home', { google: 'https://accounts.google.com/login' }, 'failed_preflight'],
    ['Google intro not home', { google: 'https://myaccount.google.com/intro' }, 'failed_preflight'],
    ['wrong target path', { target: listUrl + '/other' }, 'failed_preflight'],
    ['duplicate target', { duplicate: true }, 'failed_preflight'],
] as const) {
    test(`bounded failure: ${name}; stop, no retry, preserve failed summary`, { timeout: 2000 }, async () => {
        const root = temporaryRepo(); const mock = browserFixture(options);
        try {
            const run = collector.createStagingRun(root);
            const summary = await collector.collectBrowserPilot(mock.browser, run, 25);
            assert.equal(summary.status, status);
            assert.equal(mock.counts.reload, status === 'failed_preflight' ? 0 : 1);
            assert.equal(mock.counts.stop, status === 'failed_preflight' ? 0 : 1);
            assert.equal(mock.counts.disconnect, 1);
            assert.equal(mock.page.listenerCount('response'), 0);
            assert.equal(JSON.parse(fs.readFileSync(path.join(run.directory, 'summary.json'), 'utf8')).status, status);
            assert.equal(summary.productionReady, false);
            if ('status' in options && [401, 403, 429].includes(options.status)) assert.equal(mock.counts.text, 0);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
}
const savedProducts = path.resolve(__dirname, '../.local-crawler/verification/onlinetour-probe-products.json');
test('OFFLINE replay: saved public 20-row real capture with synthetic JSONP wrapper', {
    skip: !fs.existsSync(savedProducts),
}, () => {
    const rows = JSON.parse(fs.readFileSync(savedProducts, 'utf8'));
    assert.equal(rows.length, 20);
    const result = collector.validatePilotResponse(jsonp(rows), 'siteCallback');
    assert.equal(result.status, 'pilot_ready_for_review');
    assert.equal(result.flights.length, 20);
    assert.equal(result.productionReady, false);
});


test('CLI help is offline; no args or arbitrary output/endpoint options refuse before connection', () => {
    const repo = path.resolve(__dirname, '..');
    const invoke = (...args: string[]) => spawnSync(process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'scripts/crawl-onlinetour-browser.ts', ...args], { cwd: repo, encoding: 'utf8' });
    const help = invoke('--help');
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--consent-confirmed/);
    for (const args of [[], ['--output-dir=data'], ['--endpoint=ws:\/\/evil'], ['--consent-confirmed', '--all-cities']]) {
        const refused = invoke(...args);
        assert.equal(refused.status, 2);
        assert.match(refused.stderr, /consent|unsupported/i);
    }
});


test('displayed total adult_price never subtracts fee, including a fee exceeding total', () => {
    for (const fee of ['10000', '500000']) {
        const result = collector.validatePilotResponse(jsonp([{ ...sample, adult_fee_price: fee }]), 'siteCallback');
        assert.equal(result.status, 'pilot_ready_for_review');
        assert.equal(result.flights[0].price, 469000);
        assert.equal((result.rawProducts[0] as typeof sample).adult_fee_price, fee);
    }
});
test('unknown/nonbookable status is an explicit invalid row, never a bookable flight', () => {
    for (const status of ['01', '99', null, undefined]) {
        const result = collector.validatePilotResponse(jsonp([{ ...sample, event_status_code: status }]), 'siteCallback');
        assert.equal(result.status, 'failed_validation');
        assert.equal(result.flights.length, 0);
        assert.equal(result.issues[0].reason, 'unsupported_event_status');
    }
});
