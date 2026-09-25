import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLocalNaverRun,buildLocalNaverState} from './local-naver-run-policy.mjs';
import {roundBarrier,performRound,bridgeFailureCode} from './run-naver-round-bridge.mjs';
import {latestAgencyRound,evaluateRoundContinuation} from '../src/lib/naver-round-handoff.mjs';
const round='2026-09-17T01:12:00.000Z',now=Date.parse('2026-09-17T01:40:00Z');
const sources=['ybtour','hanatour','modetour','onlinetour','ttang','myrealtrip','lottetour'];
const cache={fullCrawlUpdatedAt:'2026-09-17T01:35:00Z',sourceUpdatedAt:Object.fromEntries(sources.map(s=>[s,'2026-09-17T01:30:00Z']))};
const state={kstDate:'2026-09-17',phase:'success',navigationsUsed:71,completedSources:sources};
const evaluate=(extra={})=>evaluateLocalNaverRun({now,cache,state,completedRound:round,...extra});
test('Naver follows five general slots and the separate 20:30 PC slot',()=>{
 const on=(time)=>latestAgencyRound(Date.parse(`2026-09-24T${time}:00+09:00`));
 assert.equal(on('06:17'),'2026-09-23T21:17:00.000Z');
 assert.equal(on('19:30'),'2026-09-24T07:31:00.000Z');
 assert.equal(on('19:31'),'2026-09-24T10:31:00.000Z');
 assert.equal(on('20:30'),'2026-09-24T11:30:00.000Z');
});
test('20:30 requires a published evening source and spends only the remaining budget',()=>{
 const evening='2026-09-24T11:30:00.000Z';
 const ready={...cache,fullCrawlUpdatedAt:'2026-09-24T10:00:00.000Z',
  sourceUpdatedAt:{...cache.sourceUpdatedAt,ybtour:'2026-09-24T11:50:00.000Z'},
  eveningPrimary:{ybtour:{status:'success',lastAttemptAt:'2026-09-24T11:31:00.000Z'}}};
 const when=Date.parse('2026-09-24T12:30:00.000Z');
 const spent={kstDate:'2026-09-24',phase:'success',navigationsUsed:440,completedSources:[]};
 const decision=evaluateRoundContinuation({now:when,cache:ready,state:spent,round:evening,totalBudget:450});
 assert.equal(decision.shouldRun,true);assert.equal(decision.navigationBudget,10);
 assert.equal(evaluateRoundContinuation({now:when,cache:ready,state:{...spent,navigationsUsed:450},round:evening,totalBudget:450}).reason,'daily_budget_exhausted');
 assert.equal(evaluateRoundContinuation({now:when,cache:{...ready,eveningPrimary:{}},state:spent,round:evening,totalBudget:450}).reason,'recovery_upstream_pending');
 assert.equal(roundBarrier({round:evening,cache:ready,pc:{state:'Ready',result:0,startedAt:evening},mrtDone:true}),true);
 assert.equal(roundBarrier({round:evening,cache:ready,pc:{state:'Ready',result:1,startedAt:evening},mrtDone:true}),true);
 assert.equal(roundBarrier({round:evening,cache:{...ready,eveningPrimary:{}},pc:{state:'Ready',result:0,startedAt:evening},mrtDone:true}),false);
});
test('actual existing policy continues a new round without resetting spent 71',()=>{
 const p=evaluate();assert.equal(p.shouldRun,true);assert.equal(p.navigationBudget,129);assert.equal(p.skipTodayPick,true);
 const running=buildLocalNaverState('running',{now,previousState:state,runningSources:p.sources,completedRound:round});
 assert.equal(running.navigationsUsed,71);assert.deepEqual(running.runningSources,sources);assert.equal(running.roundPublished,false);
 const finished=buildLocalNaverState('success',{now,previousState:running,navigationIncrement:5,completedRound:round});
 assert.equal(finished.navigationsUsed,76);assert.equal(evaluate({state:finished}).reason,'previous_round_unpublished');
 assert.equal(evaluate({state:{...finished,roundPublished:true}}).reason,'round_already_handled');
});
test('running blocked degraded unknown usage and exhausted days cannot continue',()=>{
 for(const phase of ['running','blocked','degraded'])assert.equal(evaluate({state:{...state,phase}}).shouldRun,false);
 for(const used of [undefined,200,201,NaN])assert.equal(evaluate({state:{...state,navigationsUsed:used}}).shouldRun,false);
 assert.equal(evaluate({pcCollectionPending:true}).shouldRun,false);
});
test('actual barrier requires MRT completion and published agency evidence, not optional PC exit zero',()=>{
 const pc={state:'Ready',result:0,startedAt:round};assert.equal(roundBarrier({round,cache,pc,mrtDone:true}),true);
 assert.equal(roundBarrier({round,cache,pc:{...pc,result:1},mrtDone:true}),true);
 for(const item of [{mrtDone:false},{pc:{...pc,state:'Running'}},
  {pc:{...pc,startedAt:'2026-09-16T21:17:00Z'}},{cache:{...cache,fullCrawlUpdatedAt:'2026-09-16T21:30:00Z'}}])
  assert.equal(roundBarrier({round,cache,pc,mrtDone:true,...item}),false);
});
test('bridge error reporting uses safe codes',()=>{
 assert.equal(bridgeFailureCode(Error('source task status unavailable')),'source_task_status_unavailable');
 assert.equal(bridgeFailureCode(Object.assign(Error('MRT evidence unavailable'),{httpStatus:429})),'http_429');
 assert.equal(bridgeFailureCode(Error('unexpected secret-bearing text')),'unclassified_failure');
});
test('performRound records completion only after actual runner and readback succeed',async()=>{
 const calls=[];await performRound({round,run:async()=>{calls.push('run');return 0;},verify:async()=>{calls.push('verify');},publishReceipt:async()=>{calls.push('receipt');}});
 assert.deepEqual(calls,['run','verify','receipt']);
 for(const where of ['run','verify']){let recorded=false;await assert.rejects(performRound({round,run:async()=>where==='run'?1:0,verify:async()=>{throw Error('not reflected');},publishReceipt:async()=>{recorded=true;}}));assert.equal(recorded,false);}
});
test('next KST day clears only previous-day round accounting',()=>{
 const next=evaluate({state:{...state,kstDate:'2026-09-16',phase:'blocked',navigationsUsed:200}});assert.equal(next.navigationBudget,200);
});
test('10:12 continuation does not bring forward deferred today pick',()=>{
 const result=evaluate({state:{...state,phase:'partial_waiting'}});
 assert.equal(result.deferTodayPick,true);
 assert.equal(result.navigationBudget,129);
});
