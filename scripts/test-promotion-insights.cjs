const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks, extras = {}) {
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, URL, console,
        process: { env: { ADMIN_KEY: 'fixture-only' } }, require: name => {
            assert.ok(name in mocks, `Unexpected dependency: ${name}`);
            return mocks[name];
        }, ...extras });
    return module.exports;
}
const tracking = load('src/lib/threads-tracking.ts', {});
const verified = load('src/lib/threads-post-links.ts', { './threads-tracking': tracking });
const posts = verified.connectVerifiedPostLinks([
    { id: '18338163979251867', permalink: 'https://www.threads.com/@tikitikit.kr/post/DdAzc1RD1sp',
        trackingContent: null, shareCode: null, trackingIssue: 'replies-permission-denied' },
    { id: 'pqc', permalink: '', ...tracking.extractTracking('https://www.tikitikit.kr/t/g-pqc1438') },
]);
let clock = Date.parse('2026-09-09T08:20:16Z');
class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
}
let reportCalls = 0;
let postCalls = 0;
const api = load('src/app/api/threads-insights/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/server/threads-insights': { hasThreadsInsightsConfig: () => true,
        getThreadsPostInsights: async () => { postCalls++; return posts; }, ThreadsApiError: class extends Error {} },
    '@/lib/ga4': {
        ga4Config: () => ({}), dim: (row, index = 0) => row.dimensionValues[index].value,
        num: (row, index = 0) => Number(row.metricValues[index].value),
        runReport: async (_config, request) => {
            reportCalls++;
            assert.equal(request.dateRanges[0].startDate, '29daysAgo');
            assert.equal(request.dateRanges[0].endDate, 'today');
            const event = request.dimensions.length === 2;
            const row = (dims, values) => ({ dimensionValues: dims.map(value => ({ value })), metricValues: values.map(value => ({ value: String(value) })) });
            return { rows: event ? [row(['share_xmodetour-CHI-20107439', 'detail_open'], [1, 1])]
                : [row(['share_xmodetour-CHI-20107439'], [1, 1]), row(['share_group_pqc1438'], [2, 2])] };
        },
    },
}, { Date: FakeDate });
const request = key => ({ nextUrl: new URL(`https://example.test/api/threads-insights?key=${key}`) });
(async () => {
    assert.equal((await api.GET(request('wrong'))).status, 401);
    assert.equal(reportCalls, 0);
    const first = await api.GET(request('fixture-only'));
    assert.equal(first.body.posts[0].attribution.users, 1);
    assert.equal(first.body.posts[0].attribution.detailUsers, 1);
    assert.equal(first.body.posts[1].attribution.users, 2);
    assert.equal(first.body.posts[1].attribution.bookingUsers, 0);
    clock += 9 * 60_000;
    assert.equal((await api.GET(request('fixture-only'))).body.generatedAt, first.body.generatedAt);
    assert.equal(postCalls, 1);
    assert.equal(reportCalls, 4);
    assert.equal((await api.GET(request('wrong'))).status, 401);
    clock += 61_000;
    assert.notEqual((await api.GET(request('fixture-only'))).body.generatedAt, first.body.generatedAt);
    assert.equal(postCalls, 2);
    assert.equal(reportCalls, 8);
    console.log('PASS: audited post + group link attribution, shared 30-day window, authentication before cache, cache timestamp/expiry; no network calls');
})().catch(error => { console.error(error); process.exitCode = 1; });
