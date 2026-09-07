import assert from 'node:assert/strict';
import { operationalPlan, validateOperationalCatalogue } from './onlinetour-operational';
import { validatePilotResponse } from './onlinetour-browser-collector';
import { eligibleDepartures } from './onlinetour-departure-window';
import type { Flight } from '../types/flight';

export const CONTINUATION_PARENT='e81bdc67-f024-4347-b3f7-7568e3d0907a';
/** Explicit one-off continuation with historical 19 requests carried into the 30-total limit. */
export function continuationPlan(parent:any, raw:any[], flights:Flight[], now=Date.now()) {
    assert.equal(parent.runId,CONTINUATION_PARENT);
    assert.equal(parent.status,'failed');assert.equal(parent.failure,'invalid_api_scope');
    assert.equal(parent.offlineOnly,false);assert.equal(parent.cleanupConfirmed,true);
    assert.equal(parent.productRequests,19);assert.equal(parent.regionalNavigations,4);
    assert.equal(parent.incompletePageCount,0);assert.equal(parent.duplicateCount,0);
    assert.ok(now-Date.parse(parent.startedAt)>=0 && now-Date.parse(parent.startedAt)<3600000,'stale_parent');
    assert.deepEqual(parent.plan,{...operationalPlan('CH',now),maxProductRequests:20});
    assert.deepEqual(parent.regions.map((r:any)=>r.region),['CH','AS','JA','EU']);
    assert.ok(parent.regions.every((r:any)=>r.completed && r.cities.length));
    assert.equal(parent.scopeResults.length,14);
    assert.ok(parent.scopeResults.every((s:any)=>s.status==='review_ready' && !s.failedRowCount && !s.failedPageCount
        && !s.failedRequestCount && !s.retryCount && s.scopes.every((p:any)=>p.terminalVerified)));
    assert.equal(raw.length,199);assert.equal(parent.uniqueCount,199);
    const mapped=raw.flatMap(row=>{const v=validatePilotResponse('v('+JSON.stringify({status:200,data:{list:[row]}})+');','v');
        assert.equal(v.status,'pilot_ready_for_review');return v.flights;});
    assert.deepEqual(flights,mapped);assert.equal(new Set(flights.map(f=>f.id)).size,199);
    return {...parent.plan,regions:['HN','US','GS'],maxProductRequests:11,maxRegionalNavigations:2};
}
export function combineContinuation(parent:any,parentRaw:any[],parentFlights:Flight[],suffix:any,raw:any[],flights:Flight[],now=Date.now(),baseline?:number) {
    const expected=continuationPlan(parent,parentRaw,parentFlights,now);
    assert.deepEqual(suffix.plan,expected);assert.equal(suffix.offlineOnly,false);
    // An independently verified empty suffix is not an empty full source. Preserve its original
    // failed report; only the new composite (which includes 199 earlier rows) may be accepted.
    const emptySuffix=suffix.status==='failed' && suffix.failure==='empty_catalogue' && raw.length===0 && flights.length===0
        && suffix.uniqueCount===0 && suffix.scopeResults.length===0 && suffix.checkpoints.length===0
        && suffix.incompletePageCount===0 && suffix.duplicateCount===0 && suffix.lastRejectedRequest===null
        && JSON.stringify(suffix.regions.map((r:any)=>r.region))===JSON.stringify(expected.regions)
        && suffix.regions.every((r:any)=>r.completed===true && r.cities.length===0 && r.emptyInventoryVerified===true);
    assert.ok(emptySuffix || ['review_ready','review_ready_with_changes'].includes(suffix.status));
    if(!emptySuffix){assert.equal(suffix.failure,null);assert.equal(suffix.plannedCoverageCompleted,true);}
    assert.equal(suffix.cleanupConfirmed,true);
    assert.ok(Date.parse(suffix.startedAt)>=Date.parse(parent.finishedAt));
    const allRaw=[...parentRaw,...raw],allFlights=[...parentFlights,...flights];
    const eligible=eligibleDepartures(allFlights,parent.plan.departureWindow);
    const summary={...suffix,status:emptySuffix?'review_ready':suffix.status,failure:null,plannedCoverageCompleted:true,
        plan:{...parent.plan,maxProductRequests:30},startedAt:parent.startedAt,
        evidenceKind:'completed_regions_plus_bounded_continuation',parentRunId:parent.runId,
        regions:[...parent.regions,...suffix.regions],scopeResults:[...parent.scopeResults,...suffix.scopeResults],
        checkpoints:[...parent.checkpoints,...suffix.checkpoints],
        productRequests:parent.productRequests+suffix.productRequests,
        regionalNavigations:parent.regionalNavigations+suffix.regionalNavigations,
        listDocumentRequests:parent.listDocumentRequests+suffix.listDocumentRequests,
        readAttempts:parent.readAttempts+suffix.readAttempts,
        uniqueCount:allFlights.length,eligibleCount:eligible.length,outsideDepartureWindowCount:allFlights.length-eligible.length};
    validateOperationalCatalogue(summary,allRaw,allFlights,now,baseline,30);
    return {summary,raw:allRaw,flights:allFlights};
}
