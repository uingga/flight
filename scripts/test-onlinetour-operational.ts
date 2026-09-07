import test from 'node:test';
import assert from 'node:assert/strict';
import { validRow } from './test-onlinetour-browser-adapter';
import { validatePilotResponse } from '../src/lib/onlinetour-browser-collector';
import { operationalPlan,validateOperationalCatalogue,ONLINE_REGIONS,statusFixValidationSlot,STATUS_FIX_PARENT } from '../src/lib/onlinetour-operational';
import { evaluatePcCollection } from './pc-collection-policy.mjs';

const now=Date.parse('2026-09-07T06:30:00Z');
test('post-fix approval is tied to the exact internal failure, not a cooldown or daily reset',()=>{
    const parent={runId:STATUS_FIX_PARENT,status:'failed',failure:'list_traversal_failed',cleanupConfirmed:true,offlineOnly:false,
        productRequests:11,regionalNavigations:2,scopeResults:[{failedRowCount:9,scopes:[{scope:{city:'DYG'}}]}]};
    assert.equal(statusFixValidationSlot(parent,now),'validation-after-status-fix-'+STATUS_FIX_PARENT);
    for(const delta of [{runId:'other'},{failure:'access_restriction'},{cleanupConfirmed:false},{productRequests:20},{offlineOnly:true}])
        assert.throws(()=>statusFixValidationSlot({...parent,...delta},now));
    assert.throws(()=>statusFixValidationSlot(parent,now+86400000));
});
function fixture() {
    const raw=[validRow('operational')];
    const flights=validatePilotResponse('v('+JSON.stringify({status:200,data:{list:raw}})+');','v').flights;
    const summary:any={offlineOnly:false,status:'review_ready',failure:null,cleanupConfirmed:true,plannedCoverageCompleted:true,
        plan:operationalPlan('AS',now),startedAt:'2026-09-07T06:20:00Z',finishedAt:'2026-09-07T06:21:00Z',
        incompletePageCount:0,productRequests:1,regionalNavigations:6,deferred:[],
        regions:ONLINE_REGIONS.map(region=>({region,completed:true,cities:region==='AS'?[{code:'PQC',firstDepartureDate:'20260907'}]:[],
            ...(region==='AS'?{}:{emptyInventoryVerified:true,checkedEmptyMonths:['202609','202610','202611']})})),
        scopeResults:[{status:'review_ready',failedRowCount:0,failedRequestCount:0,failedPageCount:0,retryCount:0,
            scopes:['202609','202610','202611'].map(month=>({scope:{departure:'ICN',city:'PQC',month},terminalVerified:true,pagesRead:1}))}],
        uniqueCount:1,eligibleCount:1,outsideDepartureWindowCount:0};
    return {raw,flights,summary};
}
test('complete bounded evidence validates without mutating source evidence',()=>{
    const f=fixture(), before=JSON.stringify(f);assert.equal(validateOperationalCatalogue(f.summary,f.raw,f.flights,now).length,1);
    assert.equal(JSON.stringify(f),before);
});
for(const [name,change] of Object.entries({
    sampled:(s:any)=>{s.plan.maxCitiesPerRegion=1;},excluded:(s:any)=>{s.plan.excludeCities=['PQC'];},
    failed:(s:any)=>{s.failure='validation';},cleanup:(s:any)=>{s.cleanupConfirmed=false;},
    missingRegion:(s:any)=>{s.regions.pop();},unvisitedCity:(s:any)=>{s.regions[0].cities.push({code:'BKK',firstDepartureDate:'20260907'});},
    partialPage:(s:any)=>{s.scopeResults[0].scopes[0].terminalVerified=false;},retry:(s:any)=>{s.scopeResults[0].retryCount=1;},
    future:(s:any)=>{s.finishedAt='2026-09-08T00:00:00Z';},stale:(s:any)=>{s.startedAt='2026-09-07T00:00:00Z';},
    expanded:(s:any)=>{s.plan.maxProductRequests=21;},count:(s:any)=>{s.eligibleCount=0;},
    unprovenEmpty:(s:any)=>{delete s.regions[1].emptyInventoryVerified;},
    onlySeptemberEmpty:(s:any)=>{s.regions[1].checkedEmptyMonths=['202609'];},
    missingOctober:(s:any)=>{s.scopeResults[0].scopes.splice(1,1);},
}))test('refuses '+name,()=>{const f=fixture();change(f.summary);assert.throws(()=>validateOperationalCatalogue(f.summary,f.raw,f.flights,now));});
test('refuses tampered flight fields and raw collapse',()=>{
    const f=fixture();assert.throws(()=>validateOperationalCatalogue(f.summary,f.raw,f.flights,now,95));
    f.flights[0].price++;assert.throws(()=>validateOperationalCatalogue(f.summary,f.raw,f.flights,now));
});
test('primary PC collects without a GitHub failure, only at chosen slots',()=>{
    const cache={fullCrawlUpdatedAt:'2026-09-07T05:40:00Z',sourceCircuits:{}};
    const config={enabled:true,slotsPerDay:2};
    assert.deepEqual(evaluatePcCollection({cache,now:new Date(now),config}).sources,['onlinetour','modetour']);
    assert.deepEqual(evaluatePcCollection({cache:{...cache,fullCrawlUpdatedAt:'2026-09-07T08:40:00Z'},now:new Date('2026-09-07T08:50:00Z'),config}).sources,['modetour']);
    assert.equal(evaluatePcCollection({cache:{...cache,fullCrawlUpdatedAt:'2026-09-07T08:40:00Z'},now:new Date('2026-09-07T08:50:00Z'),config:{...config,slotsPerDay:4}}).shouldRun,true);
});
test('primary PC waits upstream and honors both cooldowns and already attempted slot',()=>{
    const config={enabled:true,slotsPerDay:2};
    for(const cache of [
        {fullCrawlUpdatedAt:'2026-09-07T04:00:00Z'},
        {fullCrawlUpdatedAt:'2026-09-07T05:40:00Z',onlinePrimary:{lastAttemptAt:'2026-09-07T06:00:00Z'}},
        ...[{nextProbeAt:'2026-09-08T00:00:00Z'},{localFallback:{nextProbeAt:'2026-09-08T00:00:00Z'}},{nextProbeAt:'bad'}]
            .map(circuit=>({fullCrawlUpdatedAt:'2026-09-07T05:40:00Z',onlinePrimary:{circuit}})),
    ])assert.equal(evaluatePcCollection({cache,now:new Date(now),config}).sources.includes('onlinetour'),false);
});
