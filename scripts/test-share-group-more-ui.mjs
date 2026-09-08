import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser=await chromium.launch();
try {
 const page=await browser.newPage();
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(()=>localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2','dismissed'));
 const response=await page.request.get('http://127.0.0.1:31862/api/flights');const data=await response.json();
 const byId=new Map(data.flights.map(f=>[f.id,f]));
 await page.goto('http://127.0.0.1:31862/share-group/pus-260908?utm_source=te31&utm_content=share_group_pus-260908');
 const cta=page.getByRole('button',{name:'안 살 거지만 더 보기'});await cta.waitFor();await cta.click();
 await page.waitForTimeout(500);
 const ids=await page.locator('article[data-flight-id]').evaluateAll(cards=>cards.map(c=>c.getAttribute('data-flight-id')));
 assert.ok(ids.length>0);
 for(const id of ids){const f=byId.get(id);assert.ok(f);assert.ok(f.departure.airport==='PUS'||/부산|김해/.test(f.departure.city),JSON.stringify(f.departure));}
 assert.equal(new URL(page.url()).searchParams.get('utm_source'),'te31');
 assert.equal(await cta.count(),0);
 console.log('PASS: more button shows only Busan departures and preserves UTM ('+ids.length+' cards)');
} finally {await browser.close();}
