const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const cache = require('../data/all-flights-cache.json');
const key = f => [f.source,f.id,f.departure.date,f.departure.time,f.arrival.date,f.arrival.time].join('|');
(async()=>{
 const browser=await chromium.launch();
 try { for(const width of [390,1440]) {
  const page=await browser.newPage({viewport:{width,height:1000}});
  const flights=cache.flights;
  const candidates=[...new Map(flights.map(f=>[key(f),f])).values()].slice(0,3);
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const records=candidates.map((f,i)=>({key:key(f),currentPrice:f.price,previousPrice:f.price+12300+i*1000,amount:12300+i*1000,daysAgo:i+1,previousDate:'2026-09-13'}));
  let available=true;
  await page.route('**/api/price-drop-flights',r=>r.fulfill({json:{available,asOf:today,records:available?records:[]}}));
  await page.route('**/api/preview-flights?**',r=>r.fulfill({json:{success:true,flights,lastUpdated:new Date().toISOString()}}));
  await page.goto((process.env.PRICE_DROP_TEST_URL||'http://127.0.0.1:3504')+'/preview/mobile-redesign');
  if(width<960) await page.getByRole('button',{name:'특가 더 보기',exact:true}).click();
  const bar=page.locator('#price-drop-flights-insight');await bar.waitFor();
  assert.match(await bar.innerText(),/기다린 보람이 있네요/);
  assert.match(await bar.innerText(),/총 3개/);
  assert.doesNotMatch(await bar.innerText(),/예시/);
  const label=bar.locator('small[class*="priceDropAmount"]').first();
  assert.equal(await label.evaluate(e=>getComputedStyle(e).fontSize),'10px');
  assert.notEqual(await label.evaluate(e=>getComputedStyle(e).color),await label.locator('[class*="priceDropDelta"]').evaluate(e=>getComputedStyle(e).color));
  const ticket=bar.locator(width<960?'button[class*="freshFlightsMobileTicket"]':'button[class*="freshFlightsTicket"]').filter({visible:true});
  // Click a rendered ticket without waiting for the rolling animation to settle.
  await ticket.first().evaluate(e=>e.click());
  await page.locator('[role="dialog"][aria-label="항공권 상세"]').waitFor();
  available=false;await page.reload();
  await page.locator('article[data-flight-id]').first().waitFor();
  assert.equal(await bar.count(),0);
  console.log('PASS',width,'real amounts/count, typography, detail click, unavailable hides bar');await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
