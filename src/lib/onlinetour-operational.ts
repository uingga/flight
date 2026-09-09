import assert from 'node:assert/strict';
import { createDepartureWindow, eligibleDepartures } from './onlinetour-departure-window';
import { validatePilotResponse } from './onlinetour-browser-collector';
import { classifySourceResponseDrop } from './source-circuit';
import { SourceResponseError } from './scrapers/source-response';
import type { CataloguePlan } from './onlinetour-catalogue';
import type { Flight } from '../types/flight';
import { followingMonth } from './onlinetour-month-navigation';
import { crawlOrder } from './crawl-order.mjs';

export const ONLINE_REMOTE_PROTOCOL = '20260907.1';
export const ONLINE_REGIONS = ['AS', 'JA', 'CH', 'EU', 'HN', 'US', 'GS'];
// One explicitly approved post-fix check; never an automatic retry or a reusable budget reset.
export const STATUS_FIX_PARENT = '8403a4bd-ee75-4270-8808-fdf9677d20e5';
export function statusFixValidationSlot(parent: any, now = Date.now()): string {
    assert.equal(new Date(now + 9*3600000).toISOString().slice(0,10),'2026-09-07');
    assert.equal(parent?.runId,STATUS_FIX_PARENT);
    assert.equal(parent.status,'failed'); assert.equal(parent.failure,'list_traversal_failed');
    assert.equal(parent.cleanupConfirmed,true); assert.equal(parent.offlineOnly,false);
    assert.equal(parent.productRequests,11); assert.equal(parent.regionalNavigations,2);
    const last=parent.scopeResults.at(-1);
    assert.equal(last.failedRowCount,9);
    assert.equal(last.scopes[0].scope.city,'DYG');
    return 'validation-after-status-fix-'+STATUS_FIX_PARENT;
}
export const ONLINE_LIST_SAFETY_LIMIT = 100;
export function operationalPlan(currentRegion: string, now = Date.now(), orderSeed?: string): CataloguePlan {
    if (!ONLINE_REGIONS.includes(currentRegion)) throw Error('unknown_initial_region');
    const departureWindow = createDepartureWindow(now);
    return {schemaVersion:1, regions:[currentRegion,...crawlOrder(ONLINE_REGIONS.filter(r=>r!==currentRegion), orderSeed)],
        departureWindow, throughMonth:departureWindow.through.slice(0,7).replace('-',''),
        maxProductRequests:ONLINE_LIST_SAFETY_LIMIT, maxRegionalNavigations:6, maxPagesPerScope:20, maxMonthsPerCity:3, maxRetries:0,
        ...(orderSeed ? {orderSeed} : {})};
}
export function isOnlineAccessFailure(reason: unknown): boolean {
    return ['access_restriction','http_access_status','access_body','restricted_dom',
        'empty_or_invalid_first_page','empty_catalogue'].includes(String(reason));
}
/** Full planned inventory only. A sampled/failed run can never become operational input. */
export function validateOperationalCatalogue(summary: any, raw: any[], saved: Flight[], now = Date.now(), baseline?: number, validationLimit:20|30|40|100=100): Flight[] {
    if (isOnlineAccessFailure(summary?.failure)) throw new SourceResponseError('soft-block','온라인투어 PC 접근 제한 또는 빈 응답');
    assert.ok(summary && summary.offlineOnly === false && ['review_ready','review_ready_with_changes'].includes(summary.status));
    assert.equal(summary.failure,null); assert.equal(summary.cleanupConfirmed,true); assert.equal(summary.plannedCoverageCompleted,true);
    const plan = summary.plan;
    assert.ok([20,30,40,100].includes(validationLimit));
    assert.deepEqual(plan,{...operationalPlan(plan?.regions?.[0],now,plan?.orderSeed),maxProductRequests:validationLimit});
    assert.ok(Date.parse(summary.startedAt) <= Date.parse(summary.finishedAt));
    assert.ok(Date.parse(summary.finishedAt) <= now && now-Date.parse(summary.startedAt) <= 60*60_000);
    assert.equal(summary.incompletePageCount,0);
    assert.ok(Number.isSafeInteger(summary.productRequests) && summary.productRequests >= 0 && summary.productRequests <= plan.maxProductRequests);
    assert.ok(summary.regionalNavigations <= plan.maxRegionalNavigations);
    assert.deepEqual(summary.regions.map((r:any)=>r.region),plan.regions);
    assert.ok(summary.regions.every((r:any)=>r.completed === true));
    assert.ok(summary.regions.every((r:any)=>r.cities.length > 0 || r.emptyInventoryVerified === true));
    assert.ok(summary.deferred.every((d:any)=>d.reason === 'after_plan_month'));
    const scopes = summary.scopeResults.flatMap((t:any)=> {
        assert.ok(['review_ready','review_ready_with_changes'].includes(t.status));
        assert.equal(t.failedRowCount,0); assert.equal(t.failedRequestCount,0); assert.equal(t.failedPageCount,0);
        assert.equal(t.retryCount,0);
        assert.ok(t.scopes.every((s:any)=>s.terminalVerified === true && s.pagesRead > 0));
        return t.scopes;
    });
    for (const region of summary.regions) {
      if (!region.cities.length) {
        const expected:string[]=[];
        for (let m=plan.departureWindow!.from.slice(0,7).replace('-','');m<=plan.throughMonth;m=followingMonth(m)) expected.push(m);
        assert.deepEqual(region.checkedEmptyMonths,expected,'every empty regional month must be verified');
      }
      for (const city of region.cities) {
        if(city.firstDepartureDate.slice(0,6) > plan.throughMonth) continue;
        for (let m=city.firstDepartureDate.slice(0,6);m<=plan.throughMonth;m=followingMonth(m))
            assert.ok(scopes.some((s:any)=>s.scope.city === city.code && s.scope.month === m),'missing city month '+city.code+'|'+m);
      }
    }
    assert.ok(Array.isArray(raw) && raw.length <= validationLimit*20);
    const verifiedEmpty = raw.length === 0 && summary.regions.every((r:any) => r.cities.length === 0 && r.emptyInventoryVerified === true);
    assert.ok(raw.length > 0 || verifiedEmpty);
    assert.ok(summary.productRequests > 0 || verifiedEmpty);
    const mapped: Flight[] = [];
    for(let offset=0;offset<raw.length;offset+=20) {
        const checked=validatePilotResponse('verify('+JSON.stringify({status:200,data:{list:raw.slice(offset,offset+20)}})+');','verify');
        assert.equal(checked.status,'pilot_ready_for_review'); mapped.push(...checked.flights);
    }
    assert.equal(new Set(mapped.map(f=>f.id)).size,mapped.length);
    assert.deepEqual(saved,mapped); assert.equal(summary.uniqueCount,mapped.length);
    const drop=verifiedEmpty ? null : classifySourceResponseDrop(mapped.length,baseline);
    if(drop) throw new SourceResponseError('soft-block',drop.detail);
    const eligible=eligibleDepartures(mapped,plan.departureWindow!);
    assert.ok(eligible.length > 0 || verifiedEmpty); assert.equal(summary.eligibleCount,eligible.length);
    assert.equal(summary.outsideDepartureWindowCount,mapped.length-eligible.length);
    return eligible;
}
