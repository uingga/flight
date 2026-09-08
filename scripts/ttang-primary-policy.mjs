import { evaluatePcCollection } from './pc-collection-policy.mjs';
import { countFreshTtangDetails } from './ttang-staging-validation.mjs';
import { TTANG_BROWSER_PRIMARY } from '../src/lib/browser-primary-config.mjs';
import { crawlOrder, finiteListBudget } from '../src/lib/crawl-order.mjs';

export const TTANG_PROTOCOL = 'ttang-20260907.1';
export const TTANG_INPUT_FILES = ['all-flights-cache.json', 'interpark-prices.json', 'naver-prices.json',
    'naver-crawl-history.json', 'gid-map.json', 'today-pick.json', 'booking-link-health.json'];

/** @param {any} cache @param {{now?:number,manual?:boolean,cooldown?:any}} options */
export function assertTtangAllowed(cache, { now = Date.now(), manual = false, cooldown } = {}) {
    if (!TTANG_BROWSER_PRIMARY.enabled) throw Error('primary_not_enabled');
    if (!cache || !Array.isArray(cache.flights)) throw Error('invalid_source_cache');
    for (const value of [cache.sourceCircuits?.ttang?.nextProbeAt,
        cache.sourceCircuits?.ttang?.localFallback?.nextProbeAt, cache.ttangPrimary?.nextProbeAt, cooldown?.nextProbeAt]) {
        if (value != null && (!Number.isFinite(Date.parse(value)) || Date.parse(value) > now)) throw Error('source_cooldown');
    }
    const last = Date.parse(cache.ttangPrimary?.lastSuccessAt || cache.sourceUpdatedAt?.ttang || '');
    if (Number.isFinite(last) && now-last < 5*3600000) throw Error('minimum_interval');
    // Manual primary collection is independent of the general crawl's age.
    // Scheduled runs still use their existing slot eligibility below.
    const policy = evaluatePcCollection({cache,now:new Date(now)});
    if (!manual && !policy.sources.includes('ttang')) throw Error('source_not_due');
    return policy.expectedAt;
}

export function ttangDatePlan(now = new Date()) {
    const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    const start = new Date(day+'T00:00:00Z'), end = new Date(start);
    const date = end.getUTCDate(); end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth()+1);
    const last = new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();
    end.setUTCDate(Math.min(date,last));
    const dates = [];
    for (let ms=start.getTime();ms<=end.getTime();ms+=86400000) dates.push(new Date(ms).toISOString().slice(0,10).replaceAll('-',''));
    return dates;
}

export function validateTtangEvidence(bundle, id, now = Date.now()) {
    const { startedAt, completedAt, cache, partial, manifest } = bundle || {};
    const start=Date.parse(startedAt), finish=Date.parse(completedAt);
    if (bundle?.protocol!==TTANG_PROTOCOL || bundle.id!==id || !Number.isFinite(start) || !Number.isFinite(finish)
        || start>finish || finish>now || now-start>40*60000 || bundle.cleanupConfirmed!==true) throw Error('invalid_run_evidence');
    const expected=ttangDatePlan(new Date(start));
    if (manifest?.orderSeed !== undefined && manifest.orderSeed !== id) throw Error('invalid_order_seed');
    const ordered = crawlOrder(expected, manifest?.orderSeed);
    if (manifest?.orderSeed !== undefined && (JSON.stringify(manifest.plannedDates) !== JSON.stringify(ordered)
        || manifest.plannedRequests !== expected.length || manifest.maxListRequests !== finiteListBudget(expected.length, 2, 64)))
        throw Error('invalid_list_plan');
    if (manifest?.coverage!=='verified') throw Error('unverified_list_coverage');
    if (!Array.isArray(manifest.pages) || manifest.pages.length!==expected.length
        || manifest.pages.some((p,i)=>p.date!==ordered[i] || p.coverage!=='verified'
            || p.reason!=='client_array_pagination_20260907' || p.page!==1 || p.requestedScale!==200
            || !Number.isSafeInteger(p.returnedCount) || p.returnedCount<0
            || !Number.isSafeInteger(p.attempt) || p.attempt<1 || p.attempt>2)
        || !Number.isSafeInteger(manifest.attempts)
        || manifest.attempts!==manifest.pages.reduce((n,p)=>n+p.attempt,0)) throw Error('incomplete_date_response_evidence');
    if (manifest?.status!=='completed' || JSON.stringify(manifest.dates)!==JSON.stringify(ordered)
        || !Number.isSafeInteger(manifest.rawCount) || manifest.rawCount<=0
        || cache?.scrapedCounts?.ttang!==manifest.rawCount || Date.parse(cache?.sourceUpdatedAt?.ttang)<start
        || !Number.isFinite(Date.parse(cache?.sourceUpdatedAt?.ttang)) || cache.sourceUpdatedAt.ttang>completedAt
        || cache.staleStreak?.ttang!==0) throw Error('incomplete_list_evidence');
    const c=partial?.counts;
    if (partial?.status!=='completed' || partial.runId!==id || partial.startedAt!==startedAt
        || !c || !['selected','succeeded','empty','failed','unqueried','excludedLegacy','deferred'].every(k=>Number.isSafeInteger(c[k]) && c[k]>=0)
        || c.selected>20 || c.failed!==0 || c.unqueried!==0 || c.excludedLegacy!==0
        || c.selected!==c.succeeded+c.empty || partial.successes?.length!==c.succeeded
        || partial.outcomes?.length!==c.selected || new Set(partial.outcomes.map(o=>o.key)).size!==c.selected
        || partial.outcomes.filter(o=>o.status==='empty').length!==c.empty
        || partial.outcomes.filter(o=>o.status==='success').length!==c.succeeded) throw Error('incomplete_detail_evidence');
    if (!Array.isArray(cache.flights)) throw Error('invalid_flights');
    const flights=cache.flights.filter(f=>f.source==='ttang');
    if (!flights.length || flights.some(f=>!Number.isFinite(f.price) || f.price<=0 || !f.ttangProduct?.fareId
        || !expected.includes(String(f.departure?.date).replaceAll('-','')))) throw Error('invalid_flights');
    const fresh=countFreshTtangDetails(flights,startedAt,{runId:id,partialDetails:partial,now});
    // A round with no new detail candidates is valid; stale values are not counted as new successes.
    if (fresh.timeVerified!==c.succeeded) throw Error('unverified_detail_patch');
    return { flights, rawCount:manifest.rawCount, dates:expected.length, ...fresh, detailCounts:c };
}

// Independent PCs can differ by milliseconds. Wait locally until the timestamp is no longer
// in the future; never relax evidence validation or issue another site/worker request.
export async function validateTtangReceivedEvidence(bundle, id, {clock=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
    const ahead=Date.parse(bundle?.completedAt)-clock();
    if(ahead>5000)throw Error('remote_clock_skew');
    if(ahead>0)await wait(ahead+20);
    return validateTtangEvidence(bundle,id,clock());
}
