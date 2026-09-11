import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { kstDay, dayBefore, dailyDelta, mergeLatest, observedMetrics, type SourceLatest, type SourceResult } from '../src/lib/promotion-daily';
import { assertTe31ListingUrl, collectTe31, parseTe31Listing, te31ListingUrl } from '../src/lib/server/promotion-te31';
import { boundedText, headerAuthorized } from '../src/lib/server/promotion-http';
import { collectThreads, parseThreadMetrics } from '../src/lib/server/promotion-threads';
import { collectGa4, validateDailyReport } from '../src/lib/server/promotion-ga4';
import { runPromotionDaily, type PromotionAdapter } from '../src/lib/server/promotion-runner';
import type { PromotionStore } from '../src/lib/server/promotion-store';
import { TE31_POSTS } from '../src/lib/te31-posts';
import { GET } from '../src/app/api/admin/promotion-daily/route';
import { POST } from '../src/app/api/internal/promotion-daily/route';
import { NextRequest } from 'next/server';

// No live URLs are opened by this test suite. Any accidental default fetch fails immediately.
globalThis.fetch = (async () => { throw new Error('Unexpected live request'); }) as typeof fetch;
const listing = (rows: string) => `<table><tr><th>제목</th><th>조회</th><th>댓글</th><th>추천</th></tr>${rows}</table>`;
const htmlResponse = (html: string) => new Response(html, {headers:{'Content-Type':'text/html; charset=utf-8'}});
const row = (id: string, views = '0', comments = '0', extra = '') => `<tr><td><a href="view.php?id=freead&amp;no=${id}${extra}">synthetic</a></td><td>${views}</td><td>${comments}</td><td>—</td></tr>`;
const result = (source = 'te31', day = '2026-09-10', values = { views: 5 }): SourceResult => ({ source, outcome: 'success', reason: 'fixture', observedAt: `${day}T00:00:00Z`, posts: [{ id: '1', platform: source, title: 'fixture', url: '', metrics: observedMetrics(values, day, `${day}T00:00:00Z`) }] });
test('KST day boundary, previous calendar day, leap/month boundary', () => {
    assert.equal(kstDay(new Date('2026-09-10T14:59:59Z')), '2026-09-10');
    assert.equal(kstDay(new Date('2026-09-10T15:00:00Z')), '2026-09-11');
    assert.equal(dayBefore('2024-03-01'), '2024-02-29');
    assert.equal(dayBefore('2026-01-01'), '2025-12-31');
});
test('parser exact board/ID, zero vs missing, commas and unknown recommendations', () => {
    const parsed = parseTe31Listing(listing(row('5235', '1,234', '0') + row('52350', '999') + row('5232', '—', '')), [5235, 5232]);
    assert.deepEqual(parsed.get(5235), { views: 1234, comments: 0, recommendations: null });
    assert.deepEqual(parsed.get(5232), { views: null, comments: null, recommendations: null });
    for (const bad of ['5235x', '05235', '5235&no=5232', '5235&id=other']) assert.equal(parseTe31Listing(listing(row(bad)), [5235]).size, 0);
    assert.equal(parseTe31Listing(listing(row('5235').replace('id=freead', 'id=other')), [5235]).size, 0);
    assert.equal(parseTe31Listing(listing(row('5235').replace('view.php', 'https://evil.test/rgr/view.php')), [5235]).size, 0);
    assert.throws(() => parseTe31Listing(listing(row('5235','2') + row('5235','3')), [5235]), /conflicting/);
    assert.throws(() => parseTe31Listing('<html>unknown layout</html>', [5235]), /schema/);
});
test('TE31 SSRF guard rejects scheme/host/path/port/credentials/query/fragment', () => {
    assertTe31ListingUrl(te31ListingUrl(1));
    for (const url of ['http://te31.com/rgr/zboard.php?id=freead&page=1', 'https://te31.com.evil.test/rgr/zboard.php?id=freead&page=1',
        'https://127.0.0.1/rgr/zboard.php?id=freead&page=1', 'https://te31.com/rgr/view.php?id=freead&page=1',
        'https://te31.com:8443/rgr/zboard.php?id=freead&page=1', 'https://u:p@te31.com/rgr/zboard.php?id=freead&page=1',
        'https://te31.com/rgr/zboard.php?id=freead&page=1&url=http://localhost', 'https://te31.com/rgr/zboard.php?id=freead&page=1#x',
        'https://te31.com/rgr/zboard.php?id=freead&page=4']) assert.throws(() => assertTe31ListingUrl(new URL(url)));
    assert.throws(() => te31ListingUrl(0)); assert.throws(() => te31ListingUrl(4));
});
test('network guards refuse redirects, access errors, size overflow; no retry', async () => {
    for (const status of [301, 302, 401, 403, 429]) {
        let calls = 0;
        await assert.rejects(boundedText(te31ListingUrl(1), {}, (async (_url, init) => { calls++; assert.equal(init?.redirect, 'error'); assert.ok(init?.signal); return new Response('no', { status }); }) as typeof fetch));
        assert.equal(calls, 1);
    }
    await assert.rejects(boundedText(te31ListingUrl(1), {}, (async () => new Response('12345')) as typeof fetch, 4), /too_large/);
    await assert.rejects(boundedText(te31ListingUrl(1), {}, (async () => new Response('x', { headers: { 'content-length':'100' } })) as typeof fetch, 4), /too_large/);
});
test('unvalidated TE31 makes no requests; 3 pages, >=5s gaps, registered IDs only', async () => {
    const unsupported = await collectTe31('2026-09-11', { verified: false }); assert.equal(unsupported.outcome, 'unsupported');
    const waits: number[] = []; let calls = 0;
    const partial = await collectTe31('2026-09-11', { verified: true, sleep: async ms => { waits.push(ms); }, fetcher: (async url => {
        calls++; assertTe31ListingUrl(new URL(String(url))); return htmlResponse(listing(row('5235', '10') + row('999999', '30')));
    }) as typeof fetch });
    assert.equal(calls, 3); assert.deepEqual(waits, [5000, 5000]); assert.equal(partial.outcome, 'partial'); assert.equal(partial.posts.length, 1);
    assert.equal(partial.posts[0].metrics.comments.value, 0); assert.equal(partial.posts[0].metrics.recommendations, undefined);
});
test('TE31 access challenge stops source and preserves already observed partial', async () => {
    for (const status of [401,403,429,200]) {
        let calls = 0;
        const collected = await collectTe31('2026-09-11', { verified: true, sleep: async () => {}, fetcher: (async () => {
            calls++; return calls === 1 ? htmlResponse(listing(row('5235'))) : new Response(status === 200 ? 'CAPTCHA' : 'denied', { status, headers:{'Content-Type':'text/html'} });
        }) as typeof fetch });
        assert.equal(calls, 2); assert.equal(collected.outcome, 'partial'); assert.equal(collected.posts.length, 1);
    }
});
test('all six registry posts can complete from one synthetic listing', async () => {
    const collected = await collectTe31('2026-09-11', { verified: true, fetcher: (async () => htmlResponse(listing(TE31_POSTS.map(post => row(String(post.id))).join('')))) as typeof fetch });
    assert.equal(collected.outcome, 'success'); assert.equal(collected.posts.length, 6);
});
test('missing thread metrics never become zero; valid explicit zeros survive', () => {
    assert.equal(parseThreadMetrics([]).views, null);
    assert.equal(parseThreadMetrics([{ name:'views', values:[{ value:0 }] }]).views, 0);
    assert.equal(parseThreadMetrics([{ name:'views', values:[{}] }]).views, null);
});
test('Threads recent30, own replies, shared attribution, missing link, API failures', async () => {
    let requests = 0;
    const collected = await collectThreads('2026-09-11', 'fixture', (async (raw, init) => {
        const url = new URL(String(raw)); requests++; assert.equal(url.hostname, 'graph.threads.net'); assert.equal(url.searchParams.has('access_token'), false); assert.equal(init?.redirect, 'error');
        if (url.pathname.endsWith('/me/threads')) return Response.json({ data: ['1','2','3'].map(id => ({ id, text: id === '1' ? 'https://www.tikitikit.kr/s/fixture' : '', timestamp:'2026-09-10T00:00:00Z' })) });
        if (url.pathname.endsWith('/me/replies')) return Response.json({ data: [{ id:'r', is_reply_owned_by_me:true, root_post:{id:'2'}, text:'https://www.tikitikit.kr/s/fixture' }] });
        if (url.pathname.includes('/3/')) return new Response('failure', { status: 500 });
        return Response.json({ data:[{name:'views', values:[{value:0}]}] });
    }) as typeof fetch);
    assert.equal(requests, 5); assert.equal(collected.outcome,'partial'); assert.equal(collected.posts[2].metrics.views,undefined);
    assert.equal(collected.posts[0].shared,true); assert.equal(collected.posts[1].trackingContent,'share_fixture'); assert.equal(collected.posts[2].trackingContent,null);
});
test('Threads permission denial stops further metric requests without retry', async () => {
    let calls = 0;
    const collected = await collectThreads('2026-09-11', 'fixture', (async () => {
        calls++; return calls === 1 ? Response.json({data:[{id:'1'},{id:'2'}]}) : new Response('denied', {status:403});
    }) as typeof fetch);
    assert.equal(calls,2); assert.equal(collected.outcome,'failed');
});
test('partial/failed results preserve prior good metric and true success timestamps', () => {
    const good = mergeLatest(undefined, result());
    const partial = result('te31','2026-09-11', { views: 0 }); partial.outcome = 'partial';
    partial.posts[0].metrics = observedMetrics({ comments:0, views:null }, '2026-09-11', partial.observedAt);
    const merged = mergeLatest(good, partial);
    assert.equal(merged.posts[0].metrics.views.value, 5); assert.equal(merged.posts[0].metrics.views.day, '2026-09-10');
    assert.equal(merged.posts[0].metrics.comments.value,0); assert.equal(merged.lastSuccessAt,good.observedAt);
    const failed = mergeLatest(merged, { ...partial, outcome:'failed', posts:[] }); assert.deepEqual(failed.posts,merged.posts);
});
test('delta unavailable on first day or gap; previous calendar day only', () => {
    const current = result('te31','2026-09-11', {views:7}); const metric = current.posts[0].metrics.views;
    assert.equal(dailyDelta(metric,'1','views','te31',[]),null);
    assert.equal(dailyDelta(metric,'1','views','te31',[{day:'2026-09-09',source:'te31',payload:result('te31','2026-09-09')}]),null);
    assert.equal(dailyDelta(metric,'1','views','te31',[{day:'2026-09-10',source:'te31',payload:result()}]),2);
});
test('GA4 daily dates KST, corrections, exact source+campaign, share content without source exclusivity', async () => {
    let calls = 0; const thread = result('threads').posts[0]; thread.trackingContent = 'share_fixture';
    const collected = await collectGa4('2026-09-11',[thread],async request => {
        calls++; assert.deepEqual(request.dateRanges,[{startDate:'2026-09-08',endDate:'2026-09-10'}]);
        const filters = JSON.stringify(request.dimensionFilter); const te31 = request.dimensions![1].name === 'sessionCampaignName';
        if (te31) { assert.match(filters,/te31/); assert.match(filters,/EXACT/); }
        else if (calls <= 2) { assert.match(filters,/share_/); assert.doesNotMatch(filters,/sessionSource/); }
        const events = request.dimensions!.length === 3;
        const dims = ['20260910',te31 ? 'tikitikit_te31_pus-260908' : 'share_fixture',...events ? ['booking_click'] : []];
        return {rowCount:1,metadata:{timeZone:'Asia/Seoul'},rows:[{dimensionValues:dims.map(value => ({value})),metricValues:['0','0'].map(value => ({value}))}]};
    });
    assert.equal(calls,6); assert.equal(collected.outcome,'success');
    assert.equal(collected.posts.find(post => post.id === 'te31:5232')!.metrics.users.value,0);
    assert.equal(collected.posts.find(post => post.id === 'threads:1')!.metrics.users.day,'2026-09-10');
    assert.equal(collected.posts.find(post => post.id === 'threads:1')!.metrics.detailUsers,undefined);
    assert.ok(!collected.posts.some(post => post.id === 'te31:5170'));
});
test('GA4 timezone, sampling, truncation failures are explicit and missing rows stay unknown', async () => {
    for (const report of [{rowCount:0,metadata:{timeZone:'UTC'}}, {rowCount:2,rows:[],metadata:{timeZone:'Asia/Seoul'}}, {rowCount:0,metadata:{timeZone:'Asia/Seoul',subjectToThresholding:true}}]) assert.throws(() => validateDailyReport(report));
    let calls = 0;
    const collected = await collectGa4('2026-09-11',[],async () => { calls++; if (calls === 1) throw new Error('failure'); return {rowCount:0,metadata:{timeZone:'Asia/Seoul'}}; });
    assert.equal(collected.outcome,'partial'); assert.equal(collected.posts.length,0);
});
test('older corrections do not replace newer GA4 latest; latest correction wins delta', () => {
    const latest = mergeLatest(undefined,result('ga4','2026-09-10',{views:20}));
    const corrected = result('ga4','2026-09-09',{views:9}); corrected.observedAt = '2026-09-11T00:00:00Z'; corrected.posts[0].metrics.views.observedAt = corrected.observedAt;
    assert.equal(mergeLatest(latest,corrected).posts[0].metrics.views.value,20);
    const history = [result('ga4','2026-09-09',{views:5}),corrected].map(payload => ({day:payload.observedAt.slice(0,10),source:'ga4',payload}));
    assert.equal(dailyDelta(latest.posts[0].metrics.views,'1','views','ga4',history),11);
});
class MemoryStore implements PromotionStore {
    claimed = new Set<string>(); active = false; records: SourceResult[] = []; values: {source:string;payload:SourceLatest}[] = []; status = 'running';
    async claim(day:string) { if (this.claimed.has(day) || this.active) return false; this.claimed.add(day); this.active=true; return true; }
    async latest() { return this.values; }
    async save(_day:string,_id:string,result:SourceResult,latest:SourceLatest) { this.records.push(result); this.values.push({source:result.source,payload:latest}); }
    async finish() { this.active=false; return this.status=this.records.length === 3 && this.records.every(row => row.outcome === 'success') ? 'complete' : 'incomplete'; }
}
test('runner concurrency and repeat same KST day issue one set of work; missing adapter incomplete', async () => {
    const store = new MemoryStore(); let calls=0;
    const adapters:PromotionAdapter[] = ['threads','te31','ga4'].map(source => ({source,collect:async day => { calls++; return result(source,day); }}));
    const values = await Promise.all([runPromotionDaily(store,adapters),runPromotionDaily(store,adapters)]);
    assert.deepEqual(values.map(value=>value.status).sort(),['complete','skipped']); assert.equal(calls,3);
    assert.equal((await runPromotionDaily(store,adapters)).status,'skipped'); assert.equal(calls,3);
    const incomplete = new MemoryStore(); assert.equal((await runPromotionDaily(incomplete,[])).status,'incomplete'); assert.ok(incomplete.records.every(row=>row.outcome==='unsupported'));
});
test('runner adapter failure isolates source; failed persistence never completes run', async () => {
    const store = new MemoryStore();
    const adapters:PromotionAdapter[] = ['threads','te31','ga4'].map(source=>({source,collect:async day=>{ if(source==='te31') throw new Error('no'); return result(source,day); }}));
    assert.equal((await runPromotionDaily(store,adapters)).status,'incomplete'); assert.equal(store.records.length,3); assert.equal(store.records[1].outcome,'failed');
    const broken = new MemoryStore(); broken.save = async () => {throw new Error('save failed');};
    await assert.rejects(runPromotionDaily(broken,adapters)); assert.equal(broken.status,'running');
    await assert.rejects(runPromotionDaily(store,adapters,'2020-01-01'),/day_mismatch/);
});
test('read and job endpoints require header, ignore query auth, accept no public writes', async () => {
    process.env.ADMIN_KEY='fixture-admin'; process.env.PROMOTION_JOB_SECRET='fixture-job';
    assert.equal(headerAuthorized(new Headers({authorization:'Bearer fixture-admin'}),'fixture-admin'),true);
    assert.equal(headerAuthorized(new Headers({authorization:'Bearer fixture-admin'}),undefined),false);
    const anonymous=new NextRequest('http://localhost/api/admin/promotion-daily?key=fixture-admin');
    assert.equal((await GET(anonymous)).status,401);
    assert.equal((await POST(new NextRequest('http://localhost/api/internal/promotion-daily?key=fixture-job',{method:'POST'}))).status,401);
    const invalid=new NextRequest('http://localhost/api/admin/promotion-daily?days=999',{headers:{authorization:'Bearer fixture-admin'}});
    assert.equal((await GET(invalid)).status,400);
    const valid=new NextRequest('http://localhost/api/admin/promotion-daily',{headers:{authorization:'Bearer fixture-admin'}});
    assert.equal((await GET(valid)).status,503); // no storage, never fabricates an empty success
    assert.equal((await GET(valid)).headers.get('cache-control'),'private, no-store');
});
test('migration static contract: service role only, transactional fencing, no zero seed or unrelated tables', () => {
    const sql=readFileSync('supabase/migrations/20260911_create_promotion_daily.sql','utf8');
    assert.equal((sql.match(/enable row level security/g)||[]).length,4);
    assert.match(sql,/pg_advisory_xact_lock/); assert.match(sql,/day date primary key/); assert.match(sql,/for update/g);
    assert.match(sql,/r\.id is distinct from p_id/); assert.match(sql,/lease_until <= now\(\)/); assert.match(sql,/count\(\*\) = 3 and bool_and/);
    assert.match(sql,/from public, anon, authenticated/g); assert.doesNotMatch(sql,/flight_|account_/);
});
test('authenticated dispatch is fixed, daily claim suppresses duplicates, redirects fail closed', async () => {
    process.env.SUPABASE_URL='https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_fixture';
    process.env.GH_PAT='fixture-gh'; process.env.PROMOTION_JOB_SECRET='fixture-job';
    const unexpected=globalThis.fetch; let claim=true; let githubCalls=0; const statuses:string[]=[];
    const request=()=>new NextRequest('http://localhost/api/internal/promotion-daily?url=http://localhost',{method:'POST',headers:{authorization:'Bearer fixture-job'}});
    try {
        globalThis.fetch=(async(raw,init)=>{
            const url=new URL(String(raw));
            if(url.hostname==='api.github.com') {
                githubCalls++; assert.equal(url.pathname,'/repos/uingga/flight/actions/workflows/promotion-daily.yml/dispatches');
                assert.equal(init?.redirect,'error'); assert.deepEqual(JSON.parse(String(init?.body)),{ref:'main',inputs:{day:kstDay()}});
                return new Response(null,{status:githubCalls===1 ? 204 : 302});
            }
            assert.equal(url.hostname,'fixture.supabase.co');
            if(url.pathname.endsWith('promotion_claim_dispatch')) { const saved=claim; claim=false; return Response.json(saved); }
            assert.equal(init?.method,'PATCH'); statuses.push(JSON.parse(String(init?.body)).status); return Response.json([]);
        }) as typeof fetch;
        assert.equal((await POST(request())).status,200);
        assert.deepEqual(await (await POST(request())).json(),{action:'skipped',day:kstDay()}); assert.equal(githubCalls,1);
        claim=true; assert.equal((await POST(request())).status,502); assert.deepEqual(statuses,['dispatched','failed']);
    } finally {
        globalThis.fetch=unexpected;
        delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.GH_PAT;
    }
});
