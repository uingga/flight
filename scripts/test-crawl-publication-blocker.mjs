import test from 'node:test';
import assert from 'node:assert/strict';
import {getCrawlPublicationBlocker,planCrawlFallback} from '../src/lib/crawl-watchdog-dispatch.mjs';
const slot='2026-09-20T04:23:00.000Z', now='2026-09-20T12:00:00Z';
const run={id:1,status:'completed',conclusion:'failure',event:'workflow_dispatch',created_at:'2026-09-20T04:30:00Z',display_title:`Daily Flight Crawl · watchdog · ${slot}`};
const steps=(crawl,publish)=>[{steps:[{name:'Run crawler',conclusion:crawl},...(publish?[{name:'Commit and push changes',conclusion:publish}]:[])]}];
const inspect=(runs,getJobs)=>getCrawlPublicationBlocker(runs,slot,{now,expectedCron:'23 4 * * *',getJobs});
test('publication failure blocks repeated crawl even after 45-minute cooldown',async()=>assert.equal((await inspect([run],async()=>steps('success','failure'))).reason,'publication_recovery_required'));
test('cancelled publication after successful collection also needs recovery',async()=>assert.equal((await inspect([{...run,conclusion:'cancelled'}],async()=>steps('success',null))).reason,'publication_recovery_required'));
test('crawler failure can use existing recovery policy',async()=>assert.equal(await inspect([run],async()=>steps('failure','skipped')),null));
test('failure after successful publication does not count as publication loss',async()=>assert.equal(await inspect([run],async()=>steps('success','success')),null));
test('prior and different slots cannot block this slot',async()=>assert.equal(await inspect([{...run,created_at:'2026-09-19T04:30:00Z'},{...run,display_title:'different-slot'}],async()=>{throw Error('must not inspect')}),null));
test('delayed scheduled event is matched by original cron',async()=>assert.equal((await inspect([{...run,event:'schedule',display_title:'Daily Flight Crawl · 23 4 * * * · scheduled'}],async()=>steps('success','failure'))).reason,'publication_recovery_required'));
test('unavailable and empty job lists fail closed',async()=>{for(const getJobs of [async()=>{throw Error('network')},async()=>[]])assert.equal((await inspect([run],getJobs)).reason,'publication_status_unknown')});
test('bounded job inspection cannot silently allow unresolved older failures',async()=>{let calls=0;assert.equal((await inspect(Array.from({length:6},(_,i)=>({...run,id:i+1})),async()=>{calls++;return steps('failure','skipped')})).reason,'publication_status_unknown');assert.equal(calls,5)});

const olderSlot='2026-09-23T01:12:00.000Z',laterSlot='2026-09-23T04:23:00.000Z';
const olderRun={...run,id:42,created_at:'2026-09-23T01:20:00Z',display_title:`Daily Flight Crawl · watchdog · ${olderSlot}`};
const plan=(runs,getJobs)=>planCrawlFallback(runs,'2026-09-22T21:38:00Z',{now:'2026-09-23T04:31:00Z',getJobs});
test('failed publication holds its own slot while a later regular slot remains eligible',async()=>{
 const result=await plan([olderRun],async()=>steps('success','failure'));
 assert.equal(result.action,'dispatch');
 assert.equal(result.health.expectedAt,laterSlot);
 assert.deepEqual(result.skippedPublication.map(x=>x.expectedAt),[olderSlot]);
});
test('unknown publication evidence still prevents another site collection',async()=>{
 const result=await plan([olderRun],async()=>{throw Error('job lookup failed')});
 assert.equal(result.action,'recovery_required');
 assert.equal(result.health.expectedAt,olderSlot);
});
test('crawler failure does not silently skip the original missing slot',async()=>{
 const result=await plan([olderRun],async()=>steps('failure','skipped'));
 assert.equal(result.action,'dispatch');
 assert.equal(result.health.expectedAt,olderSlot);
});
