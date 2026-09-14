import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.TEST_BASE_URL || 'http://localhost:31914';
const ids = ['modetour-ASIA-20136581', 'modetour-ASIA-20136580', 'modetour-ASIA-20135786'];
const browser = await chromium.launch({headless:true});
try {
 const page = await browser.newPage({viewport:{width:1200,height:900}});
 await page.route('**/*', r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
 await page.addInitScript(()=>localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2','dismissed'));
 await page.goto(`${base}/c/te31-vietnam-260914`);
 const cards = page.locator('article[data-flight-id]');
 await cards.first().waitFor();
 assert.deepEqual(await cards.evaluateAll(es=>es.map(e=>e.dataset.flightId)),ids);
 assert.equal(new URL(page.url()).pathname,'/share-group/vietnam-260914');
 assert.equal(new URL(page.url()).searchParams.get('utm_source'),'te31');
 assert.equal(new URL(page.url()).searchParams.has('flight'),false);
 assert.equal(await page.getByRole('link',{name:/에서 확인하기/}).count(),0);
 const more = page.getByRole('button',{name:'안 살 거지만 더 보기',exact:true});
 await more.waitFor();
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await more.click();
 await page.waitForTimeout(700);
 assert.equal(await more.count(),0);
 assert.ok(await cards.count()>0);
 assert.equal(new URL(page.url()).searchParams.get('utm_source'),'te31');
 console.log('PASS: exact 3 tickets, list-only landing, TE31 tracking, mobile layout and more button click.');
} finally {await browser.close();}
