import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch();
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:31862/preview/acquisition');
 await page.getByRole('heading',{name:'방문 흐름 요약'}).waitFor();
 const source=page.locator('#visitor-acquisition article').first();
 assert.equal(await source.locator('table').first().locator('tbody tr').count(),12);
 for(const label of ['네이버 검색','네이버 Keep','네이버 블로그','항공권 공유 링크','ChatGPT','Gemini','직접 방문','출처 미확인','데이터 제공 불가']) assert.equal(await source.getByRole('rowheader',{name:label,exact:true}).count(),1,label);
 assert.equal(await source.locator('table').first().locator('tbody tr').first().locator('td').first().innerText(),'8회');
 assert.equal(await source.getByLabel('인원 미확인').innerText(),'—');
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:1000});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),String(width));
  await source.screenshot({path:`output/acquisition-all-sources-${width}.png`});
 }
 const issues=source.locator('details').filter({hasText:'출처 확인이 필요한 기록'});
 assert.equal(await issues.getAttribute('open'),null);assert.equal(await source.locator('table').first().getByRole('rowheader',{name:/hanatour/}).count(),0);
 await issues.locator('summary').click();assert.equal(await issues.getByRole('rowheader',{name:/hanatour/}).count(),1);await issues.locator('summary').click();
 await source.getByRole('combobox').selectOption('AI 서비스');assert.equal(await source.locator('table').first().locator('tbody tr').count(),2);
 await source.getByRole('combobox').selectOption('전체');assert.equal(await source.locator('table').first().locator('tbody tr').count(),12);
 await source.getByRole('button',{name:/출처 검색/}).click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 await dialog.getByRole('searchbox').fill('Gemini');assert.equal(await dialog.locator('tbody tr').count(),1);
 await dialog.getByRole('searchbox').fill('m.search.naver.com');assert.equal(await dialog.locator('tbody tr').count(),1);assert.equal(await dialog.getByRole('rowheader').innerText(),'네이버 검색');
 await dialog.getByRole('button',{name:'유입 출처 닫기'}).click();await dialog.waitFor({state:'hidden'});
 for(const state of ['empty','unavailable']) {await page.goto('http://127.0.0.1:31862/preview/acquisition?state='+state);assert.equal(await source.locator('table').first().locator('tbody tr').count(),0);assert.equal(await source.getByRole('status').count(),1);}
 assert.deepEqual(errors,[]);console.log('PASS: all 12 sources visible, service labels, AI filter, search dialog, unknown users, mobile widths and empty/error states');
}finally{await browser.close()}
