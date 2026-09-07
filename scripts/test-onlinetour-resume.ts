import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResumeEvidence, assertLiveCheckpoint } from '../src/lib/onlinetour-resume';
import { validatePilotResponse } from '../src/lib/onlinetour-browser-collector';
import { traverseOnlineTourLists, ListReadError } from '../src/lib/onlinetour-list-traversal';
import { collectOnlineTourCatalogue, type CataloguePlan, type CatalogueBackend } from '../src/lib/onlinetour-catalogue';
import { validRow } from './test-onlinetour-browser-adapter';

const scope={departure:'ICN',city:'PQC',month:'202609'};
const plan:CataloguePlan={schemaVersion:1,regions:['AS'],throughMonth:'202609',maxProductRequests:20,maxRegionalNavigations:1,
    maxPagesPerScope:6,maxMonthsPerCity:2,reloadStart:true,maxCitiesPerRegion:1,maxRetries:0};
const rows=Array.from({length:20},(_,i)=>({...validRow(String(260908907139+i)),dep_pyun_name:'비엣젯항공',dep_end_date:'09-07(월)',arr_end_date:'20260911'}));
const flights=validatePilotResponse('c('+JSON.stringify({status:200,data:{list:rows}})+');','c').flights;
const now=Date.parse('2026-09-07T05:00:00Z'),start=now-120000,finish=now-110000;
const summary={runId:'545740b7-f7bc-4d2f-9899-99952a8423d0',status:'failed',cleanupConfirmed:true,productionReady:false,
    productRequests:1,regionalNavigations:1,listDocumentRequests:0,readAttempts:0,scopeResults:[],incompletePageCount:1,plan,uniqueCount:20,
    failure:'invalid_paused_request',startedAt:new Date(start).toISOString(),finishedAt:new Date(finish).toISOString(),
    lastRejectedRequest:{reason:'invalid_paused_request',mainFrame:false,redirected:false,responseStage:false,resourceKind:'document',origin:'https://www.facebook.com',path:'/tr/',method:'POST'}};
const state={ready:true,loading:false,restricted:false,pageNo:'2',pageSize:'20',timeOrigin:start+1000,more:true,
    cards:rows.map(r=>({id:r.event_code,airline:r.dep_pyun_name,price:'469,000',seats:'8석',times:['09-07(월)02:10','09-07(월)05:35','09-10(목)17:45','09-11(금)01:10']}))};
test('only saved validated first-page internal failure is resumable; restriction, missing counters and stale files fail closed',()=>{
    assert.doesNotThrow(()=>validateResumeEvidence(summary,rows,flights,plan,now));
    for(const change of [{failure:'http_access_status'},{cleanupConfirmed:false},{productRequests:0},{productRequests:21},
        {scopeResults:[{}]},{parentRunId:summary.runId},{readAttempts:1},{finishedAt:new Date(now-3600001).toISOString()},
        {lastRejectedRequest:{...summary.lastRejectedRequest,mainFrame:true}},
        {lastRejectedRequest:{...summary.lastRejectedRequest,origin:'https://api.onlinetour.co.kr'}}])
        assert.throws(()=>validateResumeEvidence({...summary,...change},rows,flights,plan,now));
    assert.throws(()=>validateResumeEvidence(summary,rows.slice(1),flights,plan,now));
    assert.throws(()=>validateResumeEvidence(summary,rows,[],plan,now));
});
test('same page counter alone is insufficient: document origin, every ordered card, prices, seats, dates and four times must match',()=>{
    assert.doesNotThrow(()=>assertLiveCheckpoint(state,rows,start,finish));
    assert.throws(()=>assertLiveCheckpoint({...state,restricted:true},rows,start,finish),/access_restriction/);
    for(const change of [{timeOrigin:finish+1},{timeOrigin:start-1},{pageNo:'3'},{ready:false},{loading:true},{restricted:true},
        {cards:state.cards.slice(1)}, {cards:[...state.cards].reverse()},
        ...['id','price','seats','airline'].map(field=>({cards:[{...state.cards[0],[field]:'CHANGED'},...state.cards.slice(1)]})),
        {cards:[{...state.cards[0],times:['09-08(화)02:10',...state.cards[0].times.slice(1)]},...state.cards.slice(1)]}])
        assert.throws(()=>assertLiveCheckpoint({...state,...change},rows,start,finish));
});
test('restored twenty rows require only page two; unknown first totals remain null and count loss cannot become success',async()=>{
    const initialEvidence={scope,rawProducts:rows,nextPageAvailable:true};
    let requests=0;
    const result=await traverseOnlineTourLists([scope],async(_,p)=>{requests++;assert.equal(p,2);return{pageNo:2,totalCount:21,lastPage:2,nextPageAvailable:false,rawProducts:[validRow('last')]};},
        {initialEvidence,maxRetries:0,maxRequests:19,wait:async()=>{}});
    assert.equal(requests,1);assert.equal(result.requestCount,1);assert.equal(result.uniqueCount,21);
    assert.equal(result.status,'review_ready_with_changes');assert.equal(result.scopes[0].firstTotalCount,null);
    assert.equal(result.scopes[0].terminalVerified,true);
    const missing=await traverseOnlineTourLists([scope],async()=>({pageNo:2,totalCount:22,lastPage:2,nextPageAvailable:false,rawProducts:[validRow('last')]}),{initialEvidence,maxRetries:0,wait:async()=>{}});
    assert.equal(missing.status,'failed');assert.ok(missing.issues.some(i=>i.reason==='restored_count_mismatch'));
    const blocked=await traverseOnlineTourLists([scope],async()=>{throw new ListReadError('access','403');},{initialEvidence,maxRetries:0,wait:async()=>{}});
    assert.equal(blocked.status,'failed');assert.equal(blocked.uniqueCount,20);assert.equal(blocked.requestCount,1);
});
test('catalogue carries used requests, never reloads page one, and keeps parent failure separate',async()=>{
    let cap=0,calls=0;
    const snapshot={region:'AS',currentScope:scope,restricted:false,cities:[{code:'PQC',firstDepartureDate:'20260907'}],monthCandidates:['202609'],availableRegions:['AS']};
    const backend:CatalogueBackend={wait:async()=>{},openRegion:async()=>{throw Error('must_not_reload');},openLists:async(n)=>{
        cap=n; const diagnostics={permittedProductRequests:0,documentRequests:0,actions:0};
        return {diagnostics,failureKind:null,close:async()=>{},inspect:async()=>({region:'AS',currentScope:scope,restricted:false,availableScopes:[scope],nextPageNo:2,nextPageAvailable:true,
            preflight:{existingListTabPresent:true,evidence:'existing_list_tab_only_not_authentication_guarantee'}}),
            readPage:async(_,p)=>{assert.equal(p,2);calls++;diagnostics.permittedProductRequests++;return{pageNo:2,totalCount:21,lastPage:2,nextPageAvailable:false,rawProducts:[validRow('last')]};}};
    }};
    const r=await collectOnlineTourCatalogue(plan,backend,async()=>{},()=>{}, {parentRunId:summary.runId,productRequests:1,regionalNavigations:1,snapshot,
        initialEvidence:{scope,rawProducts:rows,nextPageAvailable:true}});
    assert.equal(cap,19);assert.equal(calls,1);assert.equal(r.productRequests,2);assert.equal(r.regionalNavigations,1);
    assert.equal(r.status,'review_ready_with_changes');assert.equal(r.flights.length,21);assert.equal(r.plannedCoverageCompleted,true);
    assert.equal(r.parentRunId,summary.runId);assert.equal(summary.status,'failed');assert.equal(r.productionReady,false);
});
