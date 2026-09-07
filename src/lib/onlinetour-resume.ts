import assert from 'node:assert/strict';
import { connectDedicatedChrome } from './onlinetour-browser-adapter';
import { createOnlineTourRegionDiscovery } from './onlinetour-region-discovery';
import { validatePilotResponse } from './onlinetour-browser-collector';
import type { CataloguePlan, CatalogueResume } from './onlinetour-catalogue';

const LIST = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
const matches = (v: string) => { try { const u = new URL(v); return !u.username && !u.password && u.origin + u.pathname === LIST; } catch { return false; } };
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export function validateResumeEvidence(summary: any, raw: Record<string, any>[], flights: unknown, plan: CataloguePlan, now = Date.now()) {
    // Only a pre-traversal first-page checkpoint is currently supported. Other missing
    // metadata is reported, never guessed from a page counter or silently re-requested.
    if (!uuid(summary?.runId) || summary.status !== 'failed' || summary.cleanupConfirmed !== true || summary.productionReady !== false
        || summary.productRequests !== 1 || summary.regionalNavigations !== 1 || summary.listDocumentRequests !== 0
        || summary.readAttempts !== 0 || summary.parentRunId || summary.scopeResults?.length !== 0
        || summary.incompletePageCount !== 1 || JSON.stringify(summary.plan) !== JSON.stringify(plan)) throw Error('unsupported_resume_checkpoint');
    const r = summary.lastRejectedRequest;
    if (summary.failure !== 'invalid_paused_request' || r?.reason !== 'invalid_paused_request'
        || r.mainFrame !== false || r.redirected !== false || r.responseStage !== false
        || r.resourceKind !== 'document' || !((r.origin === 'https://www.facebook.com' && r.path === '/tr/' && r.method === 'POST')
            || (r.origin === 'https://gum.criteo.com' && r.path === '/syncframe' && r.method === 'GET')))
        throw Error('resume_failure_not_internal_auxiliary');
    const started = Date.parse(summary.startedAt), finished = Date.parse(summary.finishedAt);
    if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started || finished > now || now - finished > 3600_000)
        throw Error('stale_resume_checkpoint');
    const v = validatePilotResponse('resume(' + JSON.stringify({ status: 200, data: { list: raw } }) + ');', 'resume');
    if (v.status !== 'pilot_ready_for_review' || v.flights.length !== summary.uniqueCount) throw Error('invalid_resume_rows');
    assert.deepEqual(flights, v.flights);
    return { started, finished, validation: v };
}
const READ_CHECKPOINT = String.raw`(() => {
    const u = new URL(location.href);
    if (u.username || u.password || u.origin + u.pathname !== 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList') return { outside:true };
    const visible = e => !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    const more = document.querySelector('#btn_more');
    return { timeOrigin:performance.timeOrigin,ready:document.readyState === 'complete',pageNo:document.querySelector('#pageNo')?.value,
        pageSize:document.querySelector('#pageSize')?.value,more:visible(more) && !more.disabled && more.getAttribute('aria-disabled') !== 'true',
        loading:Array.from(document.querySelectorAll('[class*="loading"],[id*="loading"]')).some(visible),
        restricted:/captcha|access denied|request blocked|temporarily blocked|unusual traffic|비정상(?:적인)?\s*접근|자동화(?:된)?\s*요청|접근이?\s*제한|서비스\s*이용이?\s*제한/i.test(document.body?.innerText || ''),
        cards:Array.from(document.querySelector('#data_list')?.children || []).map(e => ({
            id:/^go_reserve\('([0-9]+)'\);\s*return;$/.exec(e.querySelector('article.info [onclick^="go_reserve("]')?.getAttribute('onclick') || '')?.[1],
            airline:e.querySelector('.cell1 em')?.textContent.trim(),price:e.querySelector('.cell5 strong')?.textContent.trim(),
            seats:e.querySelector('.cell6 b')?.textContent.replace(/\s/g,''),
            times:Array.from(e.querySelectorAll('.path .city time')).map(t => t.textContent.replace(/\s/g,''))
        })) };
})()`;
export function assertLiveCheckpoint(state: any, raw: Record<string, any>[], started: number, finished: number) {
    if (state?.restricted) throw Error('access_restriction');
    if (state?.outside || state?.ready !== true || state.loading || state.restricted || state.pageNo !== '2' || state.pageSize !== '20'
        || !Number.isFinite(state.timeOrigin) || state.timeOrigin < started || state.timeOrigin > finished
        || typeof state.more !== 'boolean' || state.cards?.length !== raw.length) throw Error('resume_screen_changed');
    const md = (v: string) => /^\d{8}$/.test(v) ? v.slice(4,6) + '-' + v.slice(6,8) : v.slice(0,5);
    const tm = (v: string) => v.includes(':') ? v : v.slice(0,2) + ':' + v.slice(2);
    for (let i=0; i<raw.length; i++) {
        const r=raw[i], c=state.cards[i];
        if(c.id !== r.event_code || c.airline !== r.dep_pyun_name || !/^\d{1,3}(?:,\d{3})*$/.test(c.price || '')
            || Number(c.price.replace(/,/g,'')) !== Number(r.adult_price) || c.seats !== Number(r.res_cnt) + '석' || c.times?.length !== 4)
            throw Error('resume_card_changed');
        const dateKeys=['dep_start_date','dep_end_date','arr_start_date','arr_end_date'], timeKeys=['dep_start_time','dep_end_time','arr_start_time','arr_end_time'];
        for(let j=0;j<4;j++) {
            const match=/^(\d{2}-\d{2})\([^)]*\)(\d{2}:\d{2})$/.exec(c.times[j]);
            if(!match || match[1] !== md(r[dateKeys[j]]) || match[2] !== tm(r[timeKeys[j]])) throw Error('resume_card_time_changed');
        }
    }
}
export async function inspectResumeCheckpoint(summary: any, raw: Record<string, any>[], flights: unknown, plan: CataloguePlan,
    expectedIdentity?: { targetId: string; loaderId: string; timeOrigin: number }) {
    const { started, finished, validation } = validateResumeEvidence(summary,raw,flights,plan);
    const c=await connectDedicatedChrome(); let sessionId: string | undefined;
    let identity: { targetId: string; loaderId: string; timeOrigin: number }, state: any;
    try {
        const tabs=(await c.send('Target.getTargets')).targetInfos.filter((t:any)=>t.type==='page'&&matches(t.url));
        if(tabs.length!==1) throw Error('resume_exact_tab_required');
        sessionId=(await c.send('Target.attachToTarget',{targetId:tabs[0].targetId,flatten:true})).sessionId;
        const frame=(await c.send('Page.getFrameTree',{},sessionId)).frameTree.frame;
        if(!matches(frame.url)) throw Error('resume_target_changed');
        const r=await c.send('Runtime.evaluate',{expression:READ_CHECKPOINT,returnByValue:true},sessionId);
        if(r.exceptionDetails) throw Error('resume_read_failed');
        state=r.result?.value; assertLiveCheckpoint(state,raw,started,finished);
        identity={targetId:tabs[0].targetId,loaderId:frame.loaderId,timeOrigin:state.timeOrigin};
        if(!identity.loaderId) throw Error('resume_document_identity_missing');
        if(expectedIdentity) assert.deepEqual(identity,expectedIdentity);
    } finally {try {if(sessionId) await c.send('Target.detachFromTarget',{sessionId});} finally {await c.close();}}
    const region=await createOnlineTourRegionDiscovery(await connectDedicatedChrome(),{maxNavigations:0,maxProductRequests:0});
    let snapshot;
    try {snapshot=await region.inspect();} finally {await region.close();}
    const scope=snapshot.currentScope;
    if(snapshot.restricted) throw Error('access_restriction');
    if(!scope || snapshot.restricted || snapshot.region!==plan.regions[0]
        || validation.flights.some(f=>f.departure.airport!==scope.departure||f.arrival.airport!==scope.city||f.departure.date.replace(/-/g,'').slice(0,6)!==scope.month)
        || !snapshot.cities.some(city=>city.code===scope.city&&city.firstDepartureDate.slice(0,6)===scope.month)) throw Error('resume_scope_changed');
    const resume:CatalogueResume={parentRunId:summary.runId,productRequests:summary.productRequests,regionalNavigations:summary.regionalNavigations,
        snapshot,initialEvidence:{scope,rawProducts:raw,nextPageAvailable:state.more}};
    return {resume,identity};
}
