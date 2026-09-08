import test from 'node:test';
import assert from 'node:assert/strict';
import {carryTtangTimes} from '../src/lib/ttang-time-carry.mjs';
const old=()=>({id:'ttang-master-2026-09-10',source:'ttang',airline:'제주항공',price:100000,
 departure:{airport:'ICN',date:'2026-09-10',time:'09:00',arrivalTime:'11:00'},
 arrival:{airport:'BKK',date:'2026-09-14',time:'12:00',arrivalTime:'18:00'},availableSeats:9,seats:'9석'});
const fresh=()=>{const f=old();f.departure.time='';delete f.departure.arrivalTime;f.arrival.time='';delete f.arrival.arrivalTime;
delete f.availableSeats;delete f.seats;f.ttangProduct={masterId:'master',fareId:'123'};return f;};
test('legacy exact identity carries times only, without new checked time or availability',()=>{
const f=fresh();assert.equal(carryTtangTimes([f],[old()]),1);assert.equal(f.departure.time,'09:00');
assert.equal(f.ttangTimeProvenance.kind,'legacy-cache');for(const k of ['availableSeats','seats','detailCheckedAt'])assert.equal(f[k],undefined);
assert.equal(carryTtangTimes([f],[old()]),0);
});
for(const [name,change] of Object.entries({id:f=>f.id+='x',airline:f=>f.airline='진에어',dep:f=>f.departure.airport='PUS',
arr:f=>f.arrival.airport='CEB',outDate:f=>f.departure.date='2026-09-11',returnDate:f=>f.arrival.date='2026-09-15',
partial:f=>f.departure.time='10:00',otherSource:f=>f.source='modetour'}))test('rejects '+name,()=>{const f=fresh();change(f);assert.equal(carryTtangTimes([f],[old()]),0);});
test('rejects conflicting historic times and ambiguous current fare products',()=>{
const p=old();p.departure.time='10:00';assert.equal(carryTtangTimes([fresh()],[old(),p]),0);
const a=fresh(),b=fresh();b.ttangProduct.fareId='456';assert.equal(carryTtangTimes([a,b],[old()]),0);
});
test('known distinct fare IDs never cross; same fare retains old provenance timestamp',()=>{
const p=old();p.ttangProduct={masterId:'master',fareId:'456'};assert.equal(carryTtangTimes([fresh()],[p]),0);
p.ttangProduct.fareId='123';p.detailCheckedAt='2026-09-01T00:00:00Z';const f=fresh();assert.equal(carryTtangTimes([f],[p]),1);
assert.equal(f.detailCheckedAt,p.detailCheckedAt);assert.equal(f.availableSeats,undefined);
});
