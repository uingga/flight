import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCityComparison, hasCityComparison, representativeCityFlights} from '../src/lib/city-flight-comparison';
import {isIndexableCity, FEATURED_TRAVEL_CITIES} from '../src/lib/city-search-policy';
import type {Flight} from '../src/types/flight';

const flight=(id:string,airport:string,price:number,source='modetour',date='2030-10-01')=>({
 id,source,price,airline:'에어부산',departure:{airport,city:airport==='PUS'?'부산':'서울',date,time:'10:00'},
 arrival:{airport:'TAK',city:'다카마쓰',date:'2030-10-10',time:'14:00'},
} as Flight);
test('only reviewed additions become searchable; inventory threshold and homepage list retained',()=>{
 for(const city of ['다카마쓰','다카마츠','마나도','타이페이']) {
  assert.equal(isIndexableCity(city,3),true);assert.equal(isIndexableCity(city,2),false);
 }
 assert.equal(isIndexableCity('기타큐슈',20),false);assert.equal(FEATURED_TRAVEL_CITIES.length,12);
});
test('comparison is scoped to three cities and their normalized aliases',()=>{
 assert.equal(hasCityComparison('타이페이'),true);assert.equal(hasCityComparison('다카마츠'),true);
 assert.equal(hasCityComparison('도쿄'),false);
});
test('fee-inclusive cheapest schedule is selected without mutating source ordering',()=>{
 const input=[flight('ttang','ICN',190000,'ttang'),flight('mode','ICN',200000)];
 const before=JSON.stringify(input),rows=buildCityComparison(input);
 assert.equal(rows[0].minPrice,200000);assert.equal(rows[0].cheapest.id,'mode');
 assert.equal(rows[0].dateCount,1);assert.equal(rows[0].count,2);assert.equal(JSON.stringify(input),before);
});
test('departure groups retain dates, airports, airlines and exact linked itinerary',()=>{
 const rows=buildCityComparison([flight('b','PUS',220000),flight('i','ICN',200000),flight('i2','ICN',240000,'ttang','2030-10-03')]);
 assert.deepEqual(rows.map(r=>r.departure),['인천','부산']);assert.equal(rows[0].lastDate,'2030-10-03');
 assert.equal(rows[0].dateCount,2);assert.deepEqual(rows[0].airports,['TAK']);
 assert.deepEqual(rows[0].sources,['modetour','ttang']);assert.equal(rows[0].cheapest.id,'i');
});
test('representatives include another departure rather than only five cheapest same-origin dates',()=>{
 const input=[...Array.from({length:6},(_,i)=>flight('i'+i,'ICN',200000+i)),flight('b','PUS',300000)];
 const shown=representativeCityFlights(input,5);assert.equal(shown.length,5);assert.equal(shown[1].id,'b');
 assert.equal(new Set(shown.map(f=>f.id)).size,5);assert.deepEqual(buildCityComparison([]),[]);
});
