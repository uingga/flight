const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}, extras = {}, append = '') {
    const source = fs.readFileSync(file, 'utf8') + append;
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: name => {
        if (name in mocks) return mocks[name];
        throw new Error(`Unexpected dependency ${name}`);
    }, URL, URLSearchParams, console, process: { env: { THREADS_ACCESS_TOKEN: 'fixture-only' } }, ...extras }, { filename: file });
    return module.exports;
}
const helper = load('src/lib/threads-tracking.ts');
const root = { id: 'root', trackingContent: null, shareCode: null };
const link = 'https://tikitikit.kr/s/xmodetour-CHI-20107439';
const reply = { id: 'reply', text: link, root_post: { id: 'root' }, replied_to: { id: 'middle' }, is_reply_owned_by_me: true };
const connected = helper.connectOwnReplyTracking([root], [reply], true)[0];
assert.equal(connected.trackingContent, 'share_xmodetour-CHI-20107439');
assert.equal(connected.trackingReplyIds[0], 'reply');
assert.equal(helper.connectOwnReplyTracking([root], [{ ...reply, is_reply_owned_by_me: false }], true)[0].trackingContent, null);
assert.equal(helper.connectOwnReplyTracking([root], [{ ...reply, root_post: { id: 'someone-else' } }], true)[0].trackingContent, null);
assert.equal(helper.connectOwnReplyTracking([root], [reply], false)[0].trackingIssue, 'replies-unavailable');
assert.equal(helper.connectOwnReplyTracking([root], [reply, { ...reply, id: 'r2', text: 'https://tikitikit.kr/s/another' }], true)[0].trackingIssue, 'multiple-links');
assert.equal(helper.connectOwnReplyTracking([{ ...root, trackingContent: 'direct' }], [reply], false)[0].trackingContent, 'direct');
assert.equal(helper.connectOwnReplyTracking([root], [{ ...reply, text: '', link_attachment_url: link }], true)[0].trackingContent, connected.trackingContent);
assert.equal(helper.connectOwnReplyTracking([root], [reply, reply], true)[0].trackingReplyIds.length, 1);
assert.equal(helper.extractTracking(`${link}?utm_content=explicit`).trackingContent, 'explicit');
assert.equal(helper.extractTracking('https://tikitikit.kr.evil.test/s/code').trackingContent, null);
assert.equal(helper.extractTracking('https://tikitikit.kr/s/%ZZ').trackingContent, null);
assert.equal(helper.extractTracking(`${link}).`).shareCode, 'xmodetour-CHI-20107439');

async function integration(mode) {
    let replyCalls = 0;
    const fetch = async raw => {
        const url = new URL(raw);
        if (url.pathname.endsWith('/me/threads')) return { ok: true, json: async () => ({ data: [{ id: 'root', text: '항공권 링크는 아래에', timestamp: '2026-09-08T01:00:00Z' }] }) };
        if (url.pathname.endsWith('/root/insights')) return { ok: true, json: async () => ({ data: [{ name: 'views', total_value: 286 }] }) };
        assert.ok(url.pathname.endsWith('/me/replies'));
        replyCalls++;
        assert.equal(url.searchParams.get('since'), '1788829200');
        if (mode === 'denied') return { ok: false, status: 403, json: async () => ({ error: { code: 10, message: 'permission' } }) };
        const next = mode === 'capped' || replyCalls === 1;
        return { ok: true, json: async () => ({ data: replyCalls === 2 ? [reply] : [], ...(next ? { paging: { next: 'unused', cursors: { after: `page${replyCalls}` } } } : {}) }) };
    };
    const server = load('src/lib/server/threads-insights.ts', { 'server-only': {}, '@/lib/threads-tracking': helper }, { fetch });
    const posts = await server.getThreadsPostInsights();
    assert.equal(posts[0].metrics.views, 286);
    if (mode === 'ok') { assert.equal(posts[0].trackingContent, connected.trackingContent); assert.equal(replyCalls, 2); }
    else { assert.equal(posts[0].trackingContent, null); assert.equal(posts[0].trackingIssue, 'replies-unavailable'); }
    if (mode === 'capped') assert.equal(replyCalls, 3);
    return posts;
}
(async () => {
    const posts = await integration('ok');
    await integration('denied');
    await integration('capped');
    const api = load('src/app/api/threads-insights/route.ts', {
        'next/server': {}, '@/lib/ga4': {}, '@/lib/server/threads-insights': {},
    }, {}, '\nexport { attachAttribution, visibleAttribution, sumAttribution };');
    const row = { content: connected.trackingContent, sessions: 3, users: 2, detailOpens: 2, detailUsers: 2, bookingClicks: 1, bookingUsers: 1 };
    const duplicatedPosts = [posts[0], { ...posts[0], id: 'reply' }];
    const attached = api.attachAttribution(duplicatedPosts, [row]);
    assert.equal(attached[0].attribution.sessions, 3);
    assert.equal(attached[1].attributionShared, true);
    const visible = api.visibleAttribution(duplicatedPosts, { contentRows: [row], threadsRows: [row] });
    assert.equal(visible.length, 1);
    assert.equal(api.sumAttribution(visible).sessions, 3);
    console.log('PASS: root/self-reply mapping, nested replies, ownership, attachments, UTM, malformed URLs, ambiguity, direct precedence, pagination, permissions, request cap, original metrics, deduplicated attribution totals');
})().catch(error => { console.error(error); process.exitCode = 1; });
