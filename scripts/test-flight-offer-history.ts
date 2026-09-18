import test from 'node:test';import assert from 'node:assert/strict';
import {rememberFlightOffers,flightOfferKey,recordFlightOfferNews,restoreFlightOffers,OFFER_HISTORY_SOURCES} from '../src/lib/flight-offer-history.mjs';
import {mergeCacheSource} from '../src/lib/merge-cache-source.mjs';
import {applyNaverFilter} from './filter-by-naver';
import {restoreFlightHistory} from '../src/lib/flight-history';
const oldAt='2026-09-10T03:00:00Z',at='2026-09-18T04:00:00Z',later='2026-09-19T04:00:00Z';
const flight=(source:string,price=300000):any=>({source,id:source+'-fixture',price,airline:'진에어',flightNumber:'LJ1/LJ2',firstSeen:'2026-09-10',priceCheckedAt:oldAt,currency:'KRW',link:'https://example.invalid',departure:{airport:'PUS',city:'부산',date:'2026-11-01'},arrival:{airport:'CTS',city:'삿포로',date:'2026-11-05'}});
for(const source of OFFER_HISTORY_SOURCES){
 test(source+': hidden offer returns at same price without discovery or drop bonus',()=>{
  const original=flight(source),cache:any={flights:[original],timestamp:at,sourceUpdatedAt:{[source]:at}};
  applyNaverFilter(cache,{'PUS-CTS_2026-11-01_2026-11-05':{naverLowest:100000,crawledAt:new Date().toISOString(),lastAttemptStatus:'success'}});
  if(['onlinetour','myrealtrip'].includes(source))cache.flights=[]; // Listing removal; comparison exclusion has extra source-specific evidence guards.
  assert.equal(cache.flights.length,0);assert.ok(cache.flightOfferHistory[flightOfferKey(original)!]);
  const incoming={...original,firstSeen:'2026-09-18'};if(['ybtour','hanatour','myrealtrip'].includes(source))incoming.id+='-new-price-hash';
  mergeCacheSource(cache,{flights:[incoming],timestamp:at,sourceUpdatedAt:{[source]:at}},source);
  const actual=restoreFlightHistory(cache)[0];assert.equal(actual.firstSeen,'2026-09-10');assert.equal(actual.recommendationNews?.drop,undefined);assert.equal(actual.price,300000);
 });
 test(source+': disappearance, real new low, rise and return retain historical minimum',()=>{
  const f=flight(source),history=rememberFlightOffers({},[f],oldAt),drop=recordFlightOfferNews([],[{...f,price:270000}],at,history)[0];
  const fee=source==='ttang'?20000:0;assert.deepEqual(drop.recommendationNews.drop,{at,from:300000+fee,to:270000+fee});
  const afterDrop=rememberFlightOffers(history,[drop],at),up=recordFlightOfferNews([],[{...f,price:310000}],later,afterDrop);
  const afterUp=rememberFlightOffers(afterDrop,up,later),returned=recordFlightOfferNews([],[{...f,price:270000}],'2026-09-20T04:00:00Z',afterUp)[0];
  assert.equal(returned.recommendationNews.drop,undefined);assert.equal(returned.recommendationNews.lowestPrice,270000+fee);
  assert.equal(recordFlightOfferNews([],[{...f,price:299500}],at,history)[0].recommendationNews.drop,undefined);
 });
}
test('source, round-trip dates and flight numbers distinguish different offers',()=>{
 const f=flight('hanatour'),h=rememberFlightOffers({},[f],oldAt);
 for(const changed of [{...f,source:'ybtour'},{...f,flightNumber:'LJ3/LJ4'},{...f,departure:{...f.departure,date:'2026-11-02'}},{...f,arrival:{...f.arrival,date:'2026-11-06'}}])assert.equal(h[flightOfferKey(changed)!],undefined);
 const unidentified={...f,departure:{}};assert.equal(flightOfferKey(unidentified),null);assert.equal(restoreFlightOffers([unidentified],h)[0],unidentified);
});
test('partial merge preserves other sources, rejects foreign overlay history and expired history is pruned',()=>{
 const a=flight('ybtour'),b=flight('hanatour');const h=rememberFlightOffers({},[a,b],oldAt),target:any={flights:[b],flightOfferHistory:h,timestamp:at};
 const forged=rememberFlightOffers({},[{...b,firstSeen:'2020-01-01'}],oldAt);
 mergeCacheSource(target,{flights:[a],flightOfferHistory:forged,timestamp:at},'ybtour');assert.deepEqual(target.flightOfferHistory[flightOfferKey(b)!],h[flightOfferKey(b)!]);
 assert.equal(Object.keys(rememberFlightOffers(target.flightOfferHistory,[],'2026-11-02T04:00:00Z')).length,0);
});
test('old overlay cannot replace a newer observation or mutate booking/card data',()=>{
 const f=flight('myrealtrip'),recorded=recordFlightOfferNews([],[f],oldAt),history=rememberFlightOffers({},recorded,oldAt);
 const newer=recordFlightOfferNews([],[{...f,price:270000}],at,history),target:any={flights:newer,flightOfferHistory:rememberFlightOffers(history,newer,at),timestamp:at};
 mergeCacheSource(target,{flights:[f],timestamp:oldAt},'myrealtrip');
 assert.equal(target.flights[0].recommendationNews.observedAt,at);assert.equal(target.flights[0].recommendationNews.lowestPrice,270000);
 assert.equal(target.flights[0].link,f.link);
});
