import assert from 'node:assert/strict';
import { dropSelectionKey, resolveDropSelection, dropHeroAlternatives } from '../src/lib/drop-hero-schedules';
import { buildManualTodayPick } from '../src/lib/manual-today-pick';
import { publishAdminPick } from '../src/lib/writer-admin-pick.mjs';
import type { Flight } from '../src/types/flight';

async function run() {
 const flights = [20, 23, 26, 29].map(day => ({ id: `shanghai-${day}`, source: 'myrealtrip', airline: '테스트항공', price: 150100,
  departure: { airport: 'CJJ', city: '청주', date: `2026-10-${day}`, time: '10:00' },
  arrival: { airport: 'PVG', city: '상하이', date: `2026-11-01`, time: '12:00' },
 } as Flight));
 const keys = flights.slice(0,3).map(dropSelectionKey);
 const selected = resolveDropSelection(flights, keys, f=>f.price, '2026-09-17');
 assert.equal(selected[0].id, 'shanghai-26');
 assert.equal(dropHeroAlternatives(flights, selected[0], f=>f.price, keys).length, 2);
 assert.equal(dropHeroAlternatives(flights, selected[0], f=>f.price, [dropSelectionKey(selected[0])]).length, 0);
 for(const bad of [[], [keys[0], keys[0]], ['missing']]) assert.throws(()=>resolveDropSelection(flights,bad,f=>f.price,'2026-09-17'));
 assert.throws(()=>resolveDropSelection(flights.map((f,i)=>i===0?{...f,price:160000}:f),keys,f=>f.price,'2026-09-17'));
 assert.throws(()=>resolveDropSelection(flights,keys,f=>f.price,'2027-01-01'));
 for (const change of [{source:'ybtour'}, {airline:'다른항공'}, {departure:{...flights[0].departure,airport:'ICN'}}]) {
  const changed=flights.map((f,i)=>i===0?{...f,...change} as Flight:f);
  assert.throws(()=>resolveDropSelection(changed,changed.slice(0,3).map(dropSelectionKey),f=>f.price,'2026-09-17'));
 }
 const base=buildManualTodayPick({},selected[0]);
 let writes=0;
 const buildPick=(stored:any,f:Flight)=>({...buildManualTodayPick(stored,f),selectedFlightKeys:selected.map(dropSelectionKey)});
 const result=await publishAdminPick({flight:selected[0],buildPick,resolveSelection:(current:Flight[])=>resolveDropSelection(current,keys,f=>f.price,'2026-09-17'),
  env:{NAVER_COORDINATION:'1'},invoke:async(method:string,payload:any)=>{
   if(method==='readInputs')return {ref:'a'.repeat(40),cache:{flights},pick:base};
   writes++;assert.equal(payload.entries[0][1].selectedFlightKeys.length,3);return {commitSha:'b'.repeat(40)};
  }});
 assert.equal(writes,1,'same representative but changed membership must save');
 assert.equal(result.alreadySelected,false);
 const unchanged=await publishAdminPick({flight:selected[0],buildPick,
  resolveSelection:(current:Flight[])=>resolveDropSelection(current,keys,f=>f.price,'2026-09-17'),env:{NAVER_COORDINATION:'1'},
  invoke:async(method:string)=>{assert.equal(method,'readInputs');return {ref:'a'.repeat(40),cache:{flights},pick:result.pick};}});
 assert.equal(unchanged.alreadySelected,true);
 await assert.rejects(()=>publishAdminPick({flight:selected[0],buildPick,
  resolveSelection:(current:Flight[])=>resolveDropSelection(current,keys,f=>f.price,'2026-09-17'),env:{NAVER_COORDINATION:'1'},
  invoke:async(method:string)=>{assert.equal(method,'readInputs');return {ref:'a'.repeat(40),cache:{flights:flights.slice(1)},pick:base};}}));
 console.log('PASS multi selection: exact schedules, latest representative, only selected alternatives, invalid selections rejected, broker membership update');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
