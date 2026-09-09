import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/lib/analytics.ts'],bundle:true,write:false,format:'iife',globalName:'testAnalytics',platform:'browser',define:{'process.env.NEXT_PUBLIC_GA_ID':'"G-LOCALTEST"','process.env.NEXT_PUBLIC_VISIT_ANALYTICS_ENABLED':'"false"'}});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>History analytics isolation</title>'}));
 await page.goto('http://127.0.0.1/');
 await page.evaluate(()=>{window.captured=[];window.gtag=(...args)=>window.captured.push(args)});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{history.replaceState({},'','/?utm_source=te31');history.pushState({source:'hanatour'},'','/?source=hanatour');window.testAnalytics.trackDetailOpen('부산-괌',200000,'hanatour','card_body');});
 await page.goBack();
 assert.equal(new URL(page.url()).searchParams.get('utm_source'),'te31');
 await page.evaluate(()=>window.testAnalytics.trackBookingClick('hanatour','부산-괌',200000));
 const events=await page.evaluate(()=>window.captured);
 assert.deepEqual(events.map(e=>e[1]),['detail_open','booking_click']);
 for(const e of events){assert.equal(e[2].travel_agency,'hanatour');assert.equal(e[2].source,undefined);assert.equal(e[2].campaign_source,undefined);}
 console.log('PASS: history back retains its URL and does not emit agency traffic-source fields; detail/booking events remain separate');
}finally{await browser.close()}
