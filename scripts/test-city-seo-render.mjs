import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {renderToStaticMarkup} from 'react-dom/server';

const root=process.cwd(), out=fs.mkdtempSync(path.join(root,'.city-seo-test-'));
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'tikitikit-city-fixture-'));
const stamp=new Date().toISOString();
const flights=['다카마쓰','마나도','타이베이','도쿄','기타큐슈'].flatMap((city,c)=>Array.from({length:3},(_,i)=>({
 id:`fixture-${c}-${i}`,source:'modetour',airline:'제주항공',price:200000+i*10000,currency:'KRW',
 departure:{city:i===2?'부산':'인천',airport:i===2?'PUS':'ICN',date:`2035-10-0${i+1}`,time:'10:00'},
 arrival:{city,airport:city==='타이베이'?'TPE':'TAK',date:`2035-10-0${i+5}`,time:'15:00'},
 link:'https://example.invalid/booking',region:'아시아',availableSeats:5,
})));
fs.mkdirSync(path.join(fixture,'data'));
const save=items=>fs.writeFileSync(path.join(fixture,'data/all-flights-cache.json'),JSON.stringify({flights:items,timestamp:stamp,lastUpdated:stamp,sourceUpdatedAt:{modetour:stamp}}));
save(flights);
await build({stdin:{contents:"export {default as Page,generateMetadata} from './src/app/flights/[city]/page';export {default as sitemap} from './src/app/sitemap';",resolveDir:root,loader:'ts'},
 bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},outfile:path.join(out,'page.cjs')});
const {Page,generateMetadata,sitemap}=createRequire(import.meta.url)(path.join(out,'page.cjs'));
process.chdir(fixture);
try {
 for(const city of ['다카마쓰','마나도','타이베이']){
  const metadata=generateMetadata({params:{city}});
  assert.equal(metadata.robots.index,true);
  assert.equal(metadata.alternates.canonical,`/flights/${encodeURIComponent(city)}`);
  const html=renderToStaticMarkup(Page({params:{city}}));
  assert.ok(html.includes('출발지별 가격과 일정 비교'));
  assert.ok(html.includes('평소 시세나 다른 예약 사이트보다 저렴하다는 의미는 아닙니다'));
  assert.ok(html.includes('부산'));assert.ok(html.includes('/share/fixture-'));
  assert.ok(sitemap().some(row=>row.url.endsWith('/flights/'+encodeURIComponent(city))));
 }
 assert.ok(!renderToStaticMarkup(Page({params:{city:'도쿄'}})).includes('출발지별 가격과 일정 비교'));
 assert.equal(generateMetadata({params:{city:'기타큐슈'}}).robots.index,false);
 save(flights.filter(f=>f.arrival.city!=='마나도'||f.id==='fixture-1-0'));
 assert.equal(generateMetadata({params:{city:'마나도'}}).robots.index,false);
 assert.ok(!sitemap().some(row=>row.url.endsWith('/flights/'+encodeURIComponent('마나도'))));
 save(flights.filter(f=>f.arrival.city!=='마나도'));
 assert.equal(generateMetadata({params:{city:'마나도'}}).robots.index,false);
 assert.ok(renderToStaticMarkup(Page({params:{city:'마나도'}})).includes('지금은 마나도 항공권이 없어요'));
 console.log('PASS: real page render, metadata, sitemap, scoped content, 1/0 inventory and empty-state integration');
} finally {process.chdir(root);}
