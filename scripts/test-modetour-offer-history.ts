import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordRecommendationNews} from './lib/recommendation-news';
import {rememberModetourOffers,restoreModetourOffers,modetourOfferKey} from '../src/lib/modetour-offer-history.mjs';
import {recommendationNewsTimestamp} from '../src/lib/recommendation-news';
import {applyNaverFilter} from './filter-by-naver';
import {mergeCacheSource} from '../src/lib/merge-cache-source.mjs';
import {restoreModetourHistory} from '../src/lib/modetour-history';
import type {Flight} from '../src/types/flight';
const at='2026-09-18T04:00:00Z';
const f=(price=300000):Flight=>({id:'modetour-test-retention',source:'modetour',price,currency:'KRW',airline:'진에어',flightNumber:'LJ1/LJ2',link:'https://example.invalid',
 departure:{airport:'PUS',city:'부산',date:'2026-11-01'},arrival:{airport:'CTS',city:'삿포로',date:'2026-11-05'},firstSeen:'2026-09-10',priceCheckedAt:'2026-09-10T03:00:00Z'});
test('same-price return after filter removal preserves discovery through source publication',()=>{
 const cache:any={flights:[f()],timestamp:at,sourceUpdatedAt:{modetour:at}};
 applyNaverFilter(cache,{'PUS-CTS_2026-11-01_2026-11-05':{naverLowest:100000,crawledAt:new Date().toISOString(),lastAttemptStatus:'success'}});
 assert.equal(cache.flights.length,0);
 const [returned]=recordRecommendationNews([], [{...f(),firstSeen:'2026-09-18'}],at,cache.modetourOfferHistory);
 assert.equal(returned.firstSeen,'2026-09-10');assert.equal(returned.recommendationNews?.drop,undefined);
 const merged=mergeCacheSource(cache,{flights:[returned],timestamp:at,sourceUpdatedAt:{modetour:at}},'modetour');
 assert.equal(merged.flights[0].firstSeen,'2026-09-10');assert.equal(recommendationNewsTimestamp(merged.flights[0]),Date.parse('2026-09-09T15:00:00Z'));
});
test('genuine new low after absence earns original threshold drop; small changes do not',()=>{
 const history=rememberModetourOffers({},[f()],at);
 const [drop]=recordRecommendationNews([], [f(270000)],at,history);
 assert.equal(drop.recommendationNews?.drop?.from,300000);assert.equal(drop.firstSeen,'2026-09-10');
 for(const price of [299500,290000,320000])assert.equal(recordRecommendationNews([], [f(price)],at,history)[0].recommendationNews?.drop,undefined);
});
test('price rise, disappearance and return to old low never reset the price-drop event',()=>{
 let history=rememberModetourOffers({},[f()],at);
 const down=recordRecommendationNews([], [f(270000)],at,history);
 history=rememberModetourOffers(history,down,at);
 const up=recordRecommendationNews([], [f(300000)],'2026-09-19T04:00:00Z',history);
 history=rememberModetourOffers(history,up,'2026-09-19T04:00:00Z');
 const again=recordRecommendationNews([], [f(270000)],'2026-09-20T04:00:00Z',history);
 assert.equal(again[0].recommendationNews?.drop,undefined);assert.equal(again[0].recommendationNews?.lowestPrice,270000);
});
test('product/date/flight identity changes are new, other agencies stay unchanged',()=>{
 const history=rememberModetourOffers({},[f()],at);
 for(const changed of [{...f(),id:'modetour-new'},{...f(),departure:{...f().departure,date:'2026-11-02'}},{...f(),flightNumber:'LJ3/LJ4'}]){
  assert.equal(history[modetourOfferKey(changed)!],undefined);
  assert.equal(recordRecommendationNews([], [{...changed,firstSeen:'2026-09-18'}],at,history)[0].firstSeen,'2026-09-18');
 }
 const other={...f(),source:'ybtour' as const};assert.equal(restoreModetourOffers([other],history)[0],other);
});
test('old overlays cannot forget an earlier discovery or historical minimum',()=>{
 const history=rememberModetourOffers({},[f(270000)],at);
 const overwritten={...f(),firstSeen:'2026-09-18',recommendationNews:{firstSeenAt:at,observedAt:at,price:300000,lowestPrice:300000}};
 const out=restoreModetourOffers([overwritten],history)[0];
 assert.equal(out.firstSeen,'2026-09-10');assert.equal(out.recommendationNews.lowestPrice,270000);
 const target={flights:[f()],modetourOfferHistory:history,timestamp:at};
 const kept=mergeCacheSource(target,{flights:[{...f(),source:'ybtour'}],timestamp:at},'ybtour');
 assert.deepEqual(kept.modetourOfferHistory,history);
});
test('historically verified existing sample restores 9/16 instead of false 9/18',()=>{
 const sample:Flight={...f(358000),id:'modetour-JPN-19901735',flightNumber:'LJ311 / LJ312',departure:{airport:'PUS',city:'부산',date:'2026-10-06'},arrival:{airport:'CTS',city:'삿포로',date:'2026-10-09'},firstSeen:'2026-09-18'};
 // Exact identity from committed ccbcfdce cache; independent of live listing removals.
 const restored=restoreModetourHistory({flights:[sample]})[0];
 assert.equal(restored.firstSeen,'2026-09-16');assert.equal(restored.price,sample.price);
});
test('departed offers are pruned without removing future hidden offers',()=>{
 const history=rememberModetourOffers({},[f()],at);
 assert.equal(Object.keys(rememberModetourOffers(history,[],'2026-10-31T04:00:00Z')).length,1);
 assert.equal(Object.keys(rememberModetourOffers(history,[],'2026-11-02T04:00:00Z')).length,0);
});

test('refused empty source publication leaves the whole target unchanged',()=>{
 const target={flights:[f()],timestamp:at};const before=structuredClone(target);
 assert.throws(()=>mergeCacheSource(target,{flights:[],timestamp:at},'modetour'),/empty source/);
 assert.deepEqual(target,before);
});
