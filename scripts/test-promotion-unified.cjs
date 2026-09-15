const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch();
 try {
  for (const width of [320,390,1440]) {
   const page = await browser.newPage({viewport:{width,height:960}});
   const errors=[]; page.on('pageerror', e=>errors.push(e.message));
   await page.goto((process.env.PREVIEW_BASE_URL || 'http://127.0.0.1:3510') + '/preview/promotion-daily');
   assert.equal(await page.getByLabel('성과 채널 선택').count(),0);
   assert.equal(await page.getByLabel('이 글의 일별 변화').count(),0);
   const row = page.getByRole('button',{name:/주말 하루를/});
   await row.click();
   const history=page.getByLabel('이 글의 일별 변화');
   assert.ok(await history.isVisible());
   assert.ok(await history.getByText('(+20)',{exact:true}).isVisible());
   assert.ok(await history.getByText('사이트 행동 · 해당 날짜의 인원',{exact:true}).isVisible());
   assert.equal(await history.locator('table').count(),2);
   assert.equal(await history.locator('tbody').first().evaluate(e=>getComputedStyle(e).display),'table-row-group');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await row.click(); assert.equal(await history.count(),0);
   await page.getByRole('button',{name:/낯선 도시에서/}).click();
   assert.equal(await page.getByText('이 글에 연결된 일별 기록이 없습니다. 0으로 추정하지 않습니다.',{exact:true}).count(),2);
   await page.getByRole('button',{name:'TE31',exact:true}).click();
   await page.getByRole('button',{name:/호치민·하노이/}).click();
   assert.ok(await page.getByLabel('이 글의 일별 변화').isVisible());
   assert.ok(await page.getByLabel('이 글의 일별 변화').getByText('(+20)',{exact:true}).isVisible());
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual(errors,[]);
   console.log('PASS',width,'unified rows, exact post history, delta, missing, mobile table');
   await page.close();
  }
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
