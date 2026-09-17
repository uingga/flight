import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectNaverMrtCompletion} from '../src/lib/naver-mrt-completion.mjs';
const round='2026-09-17T04:23:00.000Z',now=Date.parse('2026-09-17T05:00:00Z');
const prefix='git/ref/tags/',owner='a'.repeat(40);
const exact=prefix+'mrt-done/20260917T030500000Z';
const previous=prefix+'mrt-done/20260916T235500000Z';
const cache={sourceUpdatedAt:{myrealtrip:'2026-09-17T04:10:28Z'},flights:[{source:'myrealtrip'}]};
function fixture(){return {
 [previous]:{object:{sha:owner}},
 [prefix+'mrt-slot/20260916T235500000Z']:{object:{sha:owner}},
 ['git/commits/'+owner]:{message:JSON.stringify({kind:'mrt-owner-v1',slot:'2026-09-16T23:55:00.000Z',host:'C'}),committer:{date:'2026-09-17T02:54:00Z'}},
 'actions/workflows/myrealtrip-scrape.yml/runs?branch=main&per_page=100':{workflow_runs:[{id:123,display_title:'watchdog 2026-09-17T03:05:00.000Z',status:'completed',conclusion:'success',created_at:'2026-09-17T03:10:00Z',updated_at:'2026-09-17T03:10:24Z'}]},
 'actions/runs/123/jobs?filter=latest&per_page=100':{total_count:1,jobs:[{conclusion:'success',steps:[{name:'Reserve MyRealTrip slot',conclusion:'success'},{name:'Run MyRealTrip price scraping',conclusion:'skipped'},{name:'Commit cache or circuit changes',conclusion:'skipped'}]}]},
};}
const check=(data=fixture(),extra={})=>inspectNaverMrtCompletion({round,now,cache,api:async(route,method)=>{assert.equal(method,undefined,'read only');return route in data?{status:200,data:data[route]}:{status:404};},...extra});
test('exact receipt retains existing path',async()=>assert.equal((await check({[exact]:{}})).reason,'exact_round_done'));
test('published older slot can cover skipped overlap without writing a done tag',async()=>{const r=await check();assert.equal(r.ready,true);assert.equal(r.skippedRunId,123);assert.equal(r.completedSlot,'2026-09-16T23:55:00.000Z');});
test('fresh cache alone never admits',async()=>assert.equal((await check({})).ready,false));
for(const [name,modify] of [
 ['active collector',d=>d[prefix+'mrt-active-v1']={}],
 ['claimed expected slot',d=>d[prefix+'mrt-slot/20260917T030500000Z']={}],
 ['missing completion',d=>delete d[previous]],
 ['wrong owner',d=>d[prefix+'mrt-slot/20260916T235500000Z'].object.sha='b'.repeat(40)],
 ['owner created after skipped run',d=>d['git/commits/'+owner].committer.date='2026-09-17T03:30:00Z'],
 ['invalid owner identity',d=>d['git/commits/'+owner].message='{}'],
 ['unfinished workflow',d=>d['actions/workflows/myrealtrip-scrape.yml/runs?branch=main&per_page=100'].workflow_runs[0].status='in_progress'],
 ['failed workflow',d=>d['actions/workflows/myrealtrip-scrape.yml/runs?branch=main&per_page=100'].workflow_runs[0].conclusion='failure'],
 ['collector ran',d=>d['actions/runs/123/jobs?filter=latest&per_page=100'].jobs[0].steps[1].conclusion='success'],
 ['incomplete jobs page',d=>d['actions/runs/123/jobs?filter=latest&per_page=100'].total_count=2],
])test(name+' holds',async()=>{const d=fixture();modify(d);assert.equal((await check(d)).ready,false);});
for(const value of ['2026-09-17T02:00:00Z','2026-09-17T03:10:01Z','2026-09-17T06:00:00Z',undefined])test('invalid/stale publication '+value,async()=>assert.equal((await check(fixture(),{cache:{...cache,sourceUpdatedAt:{myrealtrip:value}}})).ready,false));
test('empty source and open circuit hold',async()=>{for(const c of [{...cache,flights:[]},{...cache,sourceCircuits:{myrealtrip:{nextProbeAt:'2026-09-18T00:00:00Z'}}}])assert.equal((await check(fixture(),{cache:c})).ready,false);});
test('API uncertainty fails closed',async()=>assert.rejects(check(fixture(),{api:async()=>({status:403})})));
test('new active collector during inspection holds',async()=>{let activeReads=0;const d=fixture();const r=await check(d,{api:async route=>{if(route===prefix+'mrt-active-v1'&&++activeReads===2)return {status:200,data:{}};return route in d?{status:200,data:d[route]}:{status:404};}});assert.equal(r.ready,false);});
