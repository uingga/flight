import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.TEST_BASE_URL || 'http://localhost:31866';
const browser = await chromium.launch({headless:true});
try {
 for (const [path, source, content] of [['/c/te31-vietnam-260914','te31','share_group_vietnam-260914'], ['/t/m20136580','threads','share_m20136580']]) {
  const context = await browser.newContext({viewport:{width:1200,height:900}});
  await context.route('**/*',r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
  await context.addInitScript(()=>localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2','dismissed'));
  const page = await context.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto(base+path);
  const cards = page.locator('article[data-flight-id]'); await cards.first().waitFor();
  const ids = await cards.evaluateAll(es=>es.map(e=>e.dataset.flightId));
  const state = () => page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('tikitikit-share-funnel-v1:')).map(k=>JSON.parse(sessionStorage.getItem(k)))[0]);
  assert.equal(new URL(page.url()).searchParams.get('utm_source'), source);
  assert.equal(new URL(page.url()).searchParams.get('utm_content'), content);
  assert.deepEqual((await state()).done, ['shared_collection_view']);
  await page.getByRole('button',{name:'안 살 거지만 더 보기',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('article[data-flight-id]').length > 3);
  const outside = cards.filter({has:page.locator('button')});
  const outsideId = (await outside.evaluateAll(es=>es.map(e=>e.dataset.flightId))).find(id=>!ids.includes(id));
  assert.ok(outsideId);
  await page.locator(`article[data-flight-id="${outsideId}"]`).getByRole('button').first().click();
  const booking = page.getByRole('link',{name:/에서 확인하기/}); await booking.waitFor();
  assert.deepEqual((await state()).done, ['shared_collection_view','shared_collection_more','shared_outside_detail']);
  await booking.click();
  assert.equal((await state()).done.at(-1),'shared_outside_booking');
  await page.goBack(); await cards.first().waitFor();
  await page.locator(`article[data-flight-id="${outsideId}"]`).getByRole('button').first().click();
  assert.equal((await state()).done.length,4);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  await context.close();
 }
 console.log('PASS: both short links, preserved UTMs, real more/detail/booking handlers, back dedup and mobile layout; external requests blocked.');
} finally { await browser.close(); }
