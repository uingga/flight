import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch();
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:31862/preview/acquisition');
 const card=page.getByRole('article',{name:'접속 기기',exact:true});await card.waitFor();
 assert.equal(await card.getByRole('button',{name:'30일',exact:true}).getAttribute('aria-pressed'),'true');
 const mobile=card.getByRole('row',{name:/모바일/});assert.match(await mobile.innerText(),/78%.*156회.*100명/s);
 await card.getByRole('button',{name:'오늘',exact:true}).click();assert.match(await mobile.innerText(),/80%.*8회.*6명/s);
 await card.getByRole('button',{name:'7일',exact:true}).click();assert.match(await card.getByRole('row',{name:/기기 미확인/}).innerText(),/5%.*5회.*3명/s);
 await card.getByRole('button',{name:'30일',exact:true}).click();
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:1100});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),String(width));
  await page.locator('#visitor-acquisition').screenshot({path:'output/device-traffic-'+width+'.png'});
 }
 for(const [state,message] of [['empty','이 기간에 집계된 방문이 없습니다.'],['unavailable','기기별 접속 통계를 불러오지 못했습니다.']]) {
  await page.goto('http://127.0.0.1:31862/preview/acquisition?state='+state);
  assert.equal(await card.getByRole('status').innerText(),message);assert.equal(await card.locator('table').count(),0);
 }
 assert.deepEqual(errors,[]);console.log('PASS: device ratios and period switching, unknown-device share, mobile layouts, empty/failure states');
} finally {await browser.close();}
