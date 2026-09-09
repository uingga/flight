import test from 'node:test';
import assert from 'node:assert/strict';
import { followingMonth,nativeMonthUrl } from '../src/lib/onlinetour-month-navigation';
import { collectOnlineTourCatalogue, type CatalogueBackend } from '../src/lib/onlinetour-catalogue';
const vars={TabGubun:'GS',airSect:'ICN',SelectedCityCd:'',nowYear:'2026',nowMonth:'09'};
const source=`function nextMonth(year, month){var TabGubun = 'GS';var airSect = 'ICN';var SelectedCityCd = '';location.href="/flight/w/international/dcair/dcairList?TabGubun="+TabGubun+"&nowMonth="+month+"&nowYear="+year+"&SelectedCityCd="+SelectedCityCd+"&airSect="+airSect;}`;
test('native month fallback is adjacent only and rejects altered function/scope',()=>{
    assert.equal(followingMonth('202612'),'202701');
    assert.equal(new URL(nativeMonthUrl(source,vars,'202610')!).searchParams.get('nowMonth'),'10');
    for(const candidate of [source+';',source.replace('/flight/','https://evil.test/'),source.replace("'GS'","'AS'")])
        assert.equal(nativeMonthUrl(candidate,vars,'202610'),null);
    assert.equal(nativeMonthUrl(source,vars,'202611'),null);
    assert.equal(nativeMonthUrl(undefined,vars,'202610'),null);
});
function fixture(mode:'empty'|'october-city'|'wrong-month'|'restriction'|'no-adapter'='empty') {
    let month='202609',open=false;
    const requested:string[]=[];
    const snapshot=()=>({region:'GS',cities:mode==='october-city'&&month==='202610'?[{code:'PQC',firstDepartureDate:'20261001'}]:[],
        currentScope:null,inventoryMonth:month,emptyInventoryVerified:true as const,restricted:mode==='restriction'&&month==='202610',availableRegions:['GS'],monthCandidates:[]});
    const backend:CatalogueBackend={wait:async()=>{},async openRegion(n,p){
        assert.equal(open,false);open=true;
        const diagnostics={actions:0,documentRequests:0,permittedDocumentRequests:0,productRequests:0,permittedProductRequests:0,blockedRequests:0};
        return {diagnostics,failure:null,inspect:async()=>snapshot(),visitRegion:async()=>{throw Error('must_not_change_region');},close:async()=>{open=false;},
            ...(mode==='no-adapter'?{}:{visitEmptyMonth:async(region:string,next:string)=>{
                assert.equal(n,1);assert.equal(p,1);assert.equal(region,'GS');requested.push(next);
                month=mode==='wrong-month'?'202609':next;diagnostics.permittedDocumentRequests++;diagnostics.permittedProductRequests++;
                return {snapshot:snapshot(),firstPage:null};
            }})};
    },async openLists(){requested.push('city_collection');throw Error('test_city_collection_reached');}};
    return {backend,requested};
}
const plan={schemaVersion:1 as const,regions:['GS'],throughMonth:'202611',maxProductRequests:3,maxRegionalNavigations:0,maxPagesPerScope:2,maxMonthsPerCity:3,maxRetries:0 as const};
test('September empty checks October AND November without visible month buttons',async()=>{
    const f=fixture(),r=await collectOnlineTourCatalogue(plan,f.backend);
    assert.deepEqual(f.requested,['202610','202611']);
    assert.equal(r.failure,null); // Complete empty-month evidence is normal; operational validation still requires all seven regions.
    assert.equal(r.plannedCoverageCompleted,true);
    assert.deepEqual(r.regions[0].checkedEmptyMonths,['202609','202610','202611']);
    assert.equal(r.productRequests,2);assert.equal(r.regionalNavigations,0);assert.equal(r.listDocumentRequests,2);
});
test('October inventory after empty September enters city collection',async()=>{
    const f=fixture('october-city'),r=await collectOnlineTourCatalogue(plan,f.backend);
    assert.deepEqual(f.requested,['202610','city_collection']);
    assert.equal(r.regions[0].completed,false);assert.equal(r.failure,'test_city_collection_reached');
});
for(const mode of ['wrong-month','restriction','no-adapter'] as const)test('incomplete empty range fails closed: '+mode,async()=>{
    const f=fixture(mode),r=await collectOnlineTourCatalogue(plan,f.backend);
    assert.equal(r.status,'failed');assert.equal(r.plannedCoverageCompleted,false);assert.ok(!r.regions.some(x=>x.completed));
    assert.ok(f.requested.length<=1);
});
test('shared product budget stops before unapproved next month request',async()=>{
    const f=fixture(),r=await collectOnlineTourCatalogue({...plan,maxProductRequests:1},f.backend);
    assert.deepEqual(f.requested,['202610']);assert.equal(r.failure,'product_budget_exhausted');assert.equal(r.productRequests,1);
});
