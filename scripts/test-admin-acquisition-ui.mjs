import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch();
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:31862/preview/acquisition');
 await page.getByRole('heading',{name:'방문 흐름 요약'}).waitFor();
 const source=page.locator('#visitor-acquisition article').first();const routes=page.locator('#visitor-acquisition article').nth(1);
 assert.equal(await source.locator('tbody tr').count(),5);
 assert.match(await source.locator('tbody tr').first().innerText(),/TE31.*커뮤니티/s);
 assert.equal(await source.locator('tbody tr').first().locator('td').nth(1).innerText(),'8회');
 assert.match(await source.innerText(),/출처 확인 불가/);
 assert.equal(await source.locator('tbody tr').filter({hasText:'출처 확인 불가'}).count(),0);
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:1000});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),String(width));
  const a=await source.boundingBox(),b=await routes.boundingBox();
  if(width===1440)assert.ok(Math.abs(a.y-b.y)<2);else assert.ok(b.y>=a.y+a.height);
  const order=await page.locator('#visitor-flow,#visitor-acquisition,#visitor-promotion,#visitor-cities').evaluateAll(nodes=>nodes.map(n=>n.id));
  assert.deepEqual(order,['visitor-flow','visitor-acquisition','visitor-promotion','visitor-cities']);
  await page.screenshot({path:`tmp/acquisition-layout-${width}.png`,fullPage:true});
 }
 await source.getByRole('button',{name:'유입처 1개 더 보기'}).click();assert.equal(await source.locator('tbody tr').count(),6);
 await source.getByRole('button',{name:'접기',exact:true}).click();assert.equal(await source.locator('tbody tr').count(),5);
 assert.equal(await page.locator('#visitor-secondary').getAttribute('open'),null);
 for(const state of ['empty','unavailable']) {await page.goto('http://127.0.0.1:31862/preview/acquisition?state='+state);assert.equal(await source.locator('tbody tr').count(),0);assert.equal(await source.getByRole('status').count(),1);}
 assert.deepEqual(errors,[]);console.log('PASS: source-first table, unknown summary, wider overview composition, mobile stacking, section order and collapsed logs');
}finally{await browser.close()}
