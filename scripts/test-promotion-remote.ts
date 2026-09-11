import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeTe31Listing, parseTe31Listing, collectTe31 } from '../src/lib/server/promotion-te31';
import { TE31_POSTS } from '../src/lib/te31-posts';
import { boundedText, CollectionDeadline } from '../src/lib/server/promotion-http';
import { collectThreads } from '../src/lib/server/promotion-threads';
import { collectGa4 } from '../src/lib/server/promotion-ga4';
import { collectRemoteSource, parseRemoteRequest, parseRemoteResult, remoteResultDto, REMOTE_SOURCE_URL, type RemoteRequest } from '../src/lib/server/promotion-remote';
import { handlePromotionSource, type SourceHandlerDeps } from '../src/lib/server/promotion-source-handler';
import { kstDay, dayBefore, observedMetrics, type SourceResult } from '../src/lib/promotion-daily';
import { runPromotionDaily } from '../src/lib/server/promotion-runner';
import type { PromotionStore } from '../src/lib/server/promotion-store';

globalThis.fetch = (async () => { throw new Error('Unexpected live request'); }) as typeof fetch;
const raw = readFileSync('scripts/fixtures/te31-listing-page1.euc-kr.html');
const provenance = JSON.parse(readFileSync('scripts/fixtures/te31-listing-page1.euc-kr.meta.json','utf8'));
const ids = TE31_POSTS.map(post => post.id);
const fixture = decodeTe31Listing(raw,'text/html');
test('real CP949/EUC-KR evidence hash, actual header/comments alignment and 3 registered rows', () => {
    assert.equal(createHash('sha256').update(raw).digest('hex'),provenance.fixtureSha256);
    assert.equal(provenance.sourceSha256,'80ed1df679486e6d6d8d1041fdc41669b4711184b0fef5b779e87ab402bd6d76');
    assert.equal(provenance.sourceBytes,88344); assert.equal(provenance.parentRequests,1); assert.equal(provenance.articlePagesOpened,0);
    const parsed = parseTe31Listing(fixture,ids);
    assert.equal(parsed.size,3);
    assert.deepEqual(parsed.get(5235),{comments:1,views:114});
    assert.deepEqual(parsed.get(5232),{comments:0,views:133});
    assert.deepEqual(parsed.get(5211),{comments:5,views:179});
    assert.ok(!parsed.has(5196)); assert.equal(parsed.get(5232)?.recommendations,undefined);
    assert.throws(()=>parseTe31Listing(raw.toString('utf8'),ids),/schema/);
});
test('TE31 charset allowlist, meta fallback, header conflict, malformed bytes and size', () => {
    assert.equal(decodeTe31Listing(raw,'text/html; charset=EUC-KR'),fixture);
    assert.equal(decodeTe31Listing(raw,'text/html; charset=windows-949'),fixture);
    assert.throws(()=>decodeTe31Listing(raw,'application/json'),/content_type/);
    assert.throws(()=>decodeTe31Listing(raw,'text/html; charset=utf-8'),/charset/);
    assert.throws(()=>decodeTe31Listing(raw,'text/html; charset=utf-16'),/charset/);
    assert.throws(()=>decodeTe31Listing(new Uint8Array(2_000_001),'text/html'),/content_type/);
    assert.throws(()=>decodeTe31Listing(Uint8Array.from([255]),'text/html; charset=utf-8'),/encoding/);
    const utf8 = Buffer.from(fixture.replace('charset=euc-kr','charset=utf-8'));
    assert.ok(decodeTe31Listing(utf8).includes('댓글'));
});
test('blank zero ONLY for present known-schema comment TD; missing cell or wrong signature stays unknown', () => {
    const commentCell = /<td\b[^>]*data-original-comment-target="[^"]*no=5232&re=100000"[^>]*><\/td>/;
    assert.ok(commentCell.test(fixture));
    const missing = parseTe31Listing(fixture.replace(commentCell,''),ids).get(5232)!;
    assert.equal(missing.comments,null); assert.equal(missing.views,null);
    assert.equal(parseTe31Listing(fixture.replace('id="revolution_main_table"','id="unknown"'),ids).get(5232)?.comments,null);
    assert.equal(parseTe31Listing(fixture.replace(commentCell,cell=>cell.replace('최근 댓글 확인','unknown')),ids).get(5232)?.comments,null);
    assert.equal(parseTe31Listing(fixture.replace(commentCell,cell=>cell.replace('></td>','>—</td>')),ids).get(5232)?.comments,null);
    assert.deepEqual([...parseTe31Listing(fixture.replace(/<!--[\s\S]*?-->/g,''),ids)], [...parseTe31Listing(fixture,ids)]);
});
test('TE31 collector decodes raw bytes with charset-less HTML header, remains partial for page1-only fixture', async () => {
    let calls=0;
    const result=await collectTe31(kstDay(),{verified:true,sleep:async()=>{},fetcher:(async()=>{calls++;return new Response(raw,{headers:{'Content-Type':'text/html'}});}) as typeof fetch});
    assert.equal(calls,3); assert.equal(result.outcome,'partial'); assert.equal(result.posts.length,3);
    assert.equal(result.posts.find(post=>post.id==='5232')?.metrics.comments.value,0);
    assert.ok(result.posts.every(post=>post.metrics.recommendations===undefined));
});
test('Threads global deadline stops new requests and retains completed observations', async () => {
    let clock=0; let calls=0; const deadline=new CollectionDeadline(100,()=>clock);
    const result=await collectThreads(kstDay(),'fixture',(async raw=>{
        calls++; const url=new URL(String(raw));
        if(url.pathname.endsWith('me/threads')) return Response.json({data:[{id:'1',text:'https://www.tikitikit.kr/s/a'},{id:'2'},{id:'3'}]});
        clock+=60; return Response.json({data:[{name:'views',values:[{value:9}]}]});
    }) as typeof fetch,deadline);
    assert.equal(calls,3); assert.equal(result.outcome,'partial'); assert.equal(result.reason,'source_deadline');
    assert.equal(result.posts.length,1); assert.equal(result.posts[0].metrics.views.value,9);
});
test('deadline aborts the active fetch cooperatively, no detached race or later requests', async () => {
    let calls=0; let aborted=false;
    const keeper=setTimeout(()=>{},1000);
    try {
        const result=await collectThreads(kstDay(),'fixture',((_url,init)=>new Promise((_resolve,reject)=>{
            calls++; init!.signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});
        })) as typeof fetch,new CollectionDeadline(25));
        assert.ok(aborted); assert.equal(calls,1); assert.equal(result.outcome,'failed'); assert.equal(result.reason,'source_deadline');
    } finally {clearTimeout(keeper);}
});
test('GA4 global deadline preserves prior report values and issues no later report', async () => {
    let clock=0;let calls=0;
    const result=await collectGa4(kstDay(),[{id:'1',platform:'threads',title:'fixture',url:'',trackingContent:'share_a',metrics:{}}],async()=>{
        calls++; clock+=60;
        return {rowCount:1,metadata:{timeZone:'Asia/Seoul'},rows:[{dimensionValues:[{value:dayBefore(kstDay()).replace(/-/g,'')},{value:'share_a'},...calls===2?[{value:'booking_click'}]:[]],metricValues:[{value:'1'},{value:'1'}]}]};
    },new CollectionDeadline(100,()=>clock));
    assert.equal(calls,2); assert.equal(result.outcome,'partial'); assert.equal(result.reason,'source_deadline'); assert.equal(result.posts[0].metrics.users.value,1);
});
const input:RemoteRequest={source:'threads',day:kstDay(),runId:'12345678-1234-4123-8123-123456789abc'};
const good=():SourceResult=>({source:'threads',outcome:'partial',reason:'source_deadline',observedAt:new Date().toISOString(),posts:[{id:'1',platform:'threads',title:'fixture',url:'',trackingContent:null,metrics:observedMetrics({views:0},kstDay(),new Date().toISOString())}]});
test('strict request and result contracts reject arbitrary source/url/day/run and provider extras', () => {
    assert.deepEqual(parseRemoteRequest(input),input);
    for(const value of [{...input,source:'te31'},{...input,source:['threads']},{...input,day:'2020-01-01'},{...input,runId:'x'},{...input,url:'http://localhost'}]) assert.throws(()=>parseRemoteRequest(value));
    assert.equal(parseRemoteResult(good(),input).posts[0].metrics.views.value,0);
    for(const result of [{...good(),access_token:'fixture'},{...good(),source:'ga4'},{...good(),posts:[{...good().posts[0],url:'https://localhost/a'}]},
        {...good(),posts:[{...good().posts[0],metrics:{views:{value:null,day:kstDay(),observedAt:new Date().toISOString()}}}]}]) assert.throws(()=>parseRemoteResult(result,input));
    const extra=Object.assign(good(),{access_token:'must-not-cross'});
    assert.ok(!JSON.stringify(remoteResultDto(extra,input)).includes('must-not-cross'));
});
test('GitHub remote client fixed origin/header, bounded signal, envelope validation and no redirects/retries', async () => {
    process.env.PROMOTION_JOB_SECRET='fixture-remote';let calls=0;
    const fetcher=(async(raw,init)=>{calls++;assert.equal(String(raw),REMOTE_SOURCE_URL);assert.equal(init?.redirect,'error');assert.ok(init?.signal);
        assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-remote');assert.deepEqual(JSON.parse(String(init?.body)),input);
        return Response.json({day:input.day,runId:input.runId,result:good()});}) as typeof fetch;
    assert.equal((await collectRemoteSource('threads',input.day,input.runId,fetcher)).outcome,'partial');assert.equal(calls,1);
    for(const status of [302,401,403,429,500]) {
        let count=0; await assert.rejects(collectRemoteSource('threads',input.day,input.runId,(async()=>{count++;return new Response('bad',{status});}) as typeof fetch)); assert.equal(count,1);
    }
    await assert.rejects(collectRemoteSource('threads',input.day,input.runId,(async()=>Response.json({day:input.day,runId:'other',result:good()})) as typeof fetch),/envelope/);
    await assert.rejects(collectRemoteSource('threads',input.day,input.runId,(async()=>new Response('x',{headers:{'content-length':'2000001'}})) as typeof fetch),/too_large/);
    // Generic JSON decoding does not inherit TE31's charset fallback.
    await assert.rejects(boundedText(new URL(REMOTE_SOURCE_URL),{},(async()=>new Response(raw)) as typeof fetch));
});
const req=(body:unknown=input,auth='Bearer fixture-job',query='')=>new Request(`https://www.tikitikit.kr/api/internal/promotion-source${query}`,{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(body)});
test('remote endpoint auth/validation before DB and collection; active lease, replay and concurrency fencing', async () => {
    let claims=0;let collections=0;let available=true;let active=true;
    const deps:SourceHandlerDeps={secret:'fixture-job',store:{claimRemote:async()=>{claims++;const take=available;available=false;return take;},currentThreads:async()=>[],activeRun:async()=>active},
        collect:async()=>{collections++;return good();}};
    assert.equal((await handlePromotionSource(req(input,''),deps)).status,401);
    for(const r of [req({...input,source:'other'}),req({...input,runId:'bad'}),req(input,'Bearer fixture-job','?url=http://localhost'),req({...input,padding:'x'.repeat(600)})]) assert.equal((await handlePromotionSource(r,deps)).status,400);
    assert.equal(claims,0); assert.equal(collections,0);
    const both=await Promise.all([handlePromotionSource(req(),deps),handlePromotionSource(req(),deps)]);
    assert.deepEqual(both.map(r=>r.status).sort(),[200,409]);assert.equal(collections,1);
    const body=await both.find(r=>r.status===200)!.json(); assert.equal(body.runId,input.runId);assert.equal(body.result.posts[0].metrics.views.value,0);
    available=true; active=false; assert.equal((await handlePromotionSource(req(),deps)).status,409);
});
test('remote claim migration and workflow keep Vercel analytics secrets in Vercel', () => {
    const sql=readFileSync('supabase/migrations/20260911_create_promotion_remote_claims.sql','utf8');
    assert.match(sql,/for update/);assert.match(sql,/r.id is distinct from p_id/);assert.match(sql,/240 seconds/);assert.match(sql,/primary key\(day, source\)/);
    assert.match(sql,/enable row level security/);assert.match(sql,/from public, anon, authenticated/);
    const workflow=readFileSync('.github/workflows/promotion-daily.yml','utf8');assert.match(workflow,/secrets.PROMOTION_JOB_SECRET/);
    assert.doesNotMatch(workflow,/THREADS_ACCESS_TOKEN|GA4_PRIVATE_KEY|GA4_CLIENT_EMAIL|GA4_PROPERTY_ID/);
    const route=readFileSync('src/app/api/internal/promotion-source/route.ts','utf8');assert.match(route,/maxDuration = 300/);
});
test('runner passes its claimed run ID through both remote calls and persists partial evidence', async () => {
    const saved:SourceResult[]=[];let runId='';const remoteClaims=new Set<string>();let remoteCalls=0;let listCalls=0;
    const store:PromotionStore={claim:async(_day,id)=>{runId=id;return true;},latest:async()=>[],save:async(_day,id,result)=>{assert.equal(id,runId);saved.push(result);},finish:async()=>saved.every(row=>row.outcome==='success')?'complete':'incomplete'};
    const deps:SourceHandlerDeps={secret:'fixture-remote',store:{claimRemote:async request=>{
        assert.equal(request.runId,runId);if(remoteClaims.has(request.source))return false;remoteClaims.add(request.source);return true;
    },currentThreads:async()=>{assert.equal(saved[0]?.source,'threads');return saved[0].posts;},activeRun:async request=>request.runId===runId},collect:async request=>request.source==='threads'?good():{source:'ga4',outcome:'success',reason:'daily_kst_recent3_provisional',observedAt:new Date().toISOString(),posts:[]}};
    process.env.PROMOTION_JOB_SECRET='fixture-remote';process.env.PROMOTION_TE31_LISTING_VERIFIED='1';
    const unexpected=globalThis.fetch;
    try {
        globalThis.fetch=(async(url,init)=>{
            if(String(url)===REMOTE_SOURCE_URL){remoteCalls++;return handlePromotionSource(new Request(String(url),init),deps);}
            assert.equal(new URL(String(url)).hostname,'te31.com');listCalls++;
            // Return every registered ID on one synthetic page to avoid any real wait or request.
            const html='<table><tr><th>제목</th><th>조회</th><th>댓글</th></tr>'+ids.map(id=>`<tr><td><a href="view.php?id=freead&no=${id}">fixture</a></td><td>0</td><td>0</td></tr>`).join('')+'</table>';
            return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
        }) as typeof fetch;
        const outcome=await runPromotionDaily(store);
        assert.equal(outcome.status,'incomplete');assert.equal(remoteCalls,2);assert.equal(listCalls,1);
        assert.deepEqual(saved.map(row=>row.source),['threads','te31','ga4']);assert.equal(saved[0].posts[0].metrics.views.value,0);
        assert.equal(saved[0].outcome,'partial');
    } finally {globalThis.fetch=unexpected;delete process.env.PROMOTION_TE31_LISTING_VERIFIED;}
});
