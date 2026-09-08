import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:31862/preview/acquisition');
 await page.getByRole('heading',{name:'유입 유형과 출처'}).waitFor();
 assert.equal(await page.locator('ul > li > div').count(),6);
 const search=page.locator('li').filter({has:page.getByText('검색',{exact:true})}).first();
 assert.match(await search.locator('div').first().innerText(),/5회\s*3명/);
 assert.match(await search.innerText(),/네이버 검색/);assert.match(await search.innerText(),/구글/);
 const keep=page.locator('li').filter({has:page.getByText('기타 외부 링크',{exact:true})}).first();
 assert.match(await keep.innerText(),/네이버 Keep/);
 assert.equal(await page.getByText('TE31',{exact:false}).count(),1);
 for(const width of [1200,390,320]) {
  await page.setViewportSize({width,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`tmp/acquisition-${width}.png`,fullPage:true});
 }
 for(const state of ['empty','unavailable']) {
  await page.goto('http://127.0.0.1:31862/preview/acquisition?state='+state);
  assert.equal(await page.locator('ul').count(),0);
  assert.equal(await page.getByRole('status').count(),1);
 }
 assert.deepEqual(errors,[]);console.log('PASS: nested sources, deduplicated total display, Keep separation, empty/error states, desktop and 390/320px mobile');
} finally {await browser.close()}

