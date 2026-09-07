const assert=require('node:assert/strict');
const http=require('node:http');
const {build}=require('esbuild');
const {chromium}=require('playwright');
const path=require('node:path');
(async()=>{
  const bundle=await build({entryPoints:['src/lib/visit-analytics-client.ts'],bundle:true,platform:'browser',format:'iife',globalName:'VisitTest',write:false,
    define:{'process.env.NEXT_PUBLIC_VISIT_ANALYTICS_ENABLED':'"true"','process.env.NODE_ENV':'"development"'}});
  const received=[]; let fail=false;
  const server=http.createServer((req,res)=>{
    if(req.url==='/api/visit-events'){
      let data='';req.on('data',chunk=>data+=chunk);req.on('end',()=>{
        received.push(JSON.parse(data));res.writeHead(fail?503:204);res.end();
      });return;
    }
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><title>Visit tests</title><script>'+bundle.outputFiles[0].text+'</script><button id="detail" onclick="VisitTest.trackVisitAction(\'detail\')">detail</button><button id="booking" onclick="VisitTest.trackVisitAction(\'booking\')">booking</button>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext();
    // Test-only override in an isolated loopback harness; production detects automation normally.
    await context.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false}));
    const page=await context.newPage();
    await page.goto(origin+'/?utm_source=naver_blog&utm_medium=social');
    await page.evaluate(()=>window.VisitTest.startVisitAnalytics(location.href,''));
    await page.waitForFunction(()=>!!localStorage.getItem('tikitikit_visit_v1'));
    await page.waitForTimeout(100);
    const first=received[0];assert.equal(first.channel,'social');
    await page.click('#detail'); await page.click('#booking');await page.waitForTimeout(100);
    assert.equal(new Set(received.map(row=>row.visitId)).size,1);
    assert(received.some(row=>row.action==='detail'));assert(received.some(row=>row.action==='booking'));
    const tab=await context.newPage();await tab.goto(origin+'/?source=myrealtrip');
    await tab.evaluate(()=>window.VisitTest.startVisitAnalytics(location.href,''));await tab.waitForTimeout(100);
    assert.equal(received.at(-1).visitId,first.visitId);assert.equal(received.at(-1).channel,'social');
    await tab.reload();await tab.evaluate(()=>window.VisitTest.startVisitAnalytics(location.href,''));await tab.waitForTimeout(100);
    assert.equal(received.at(-1).visitId,first.visitId);
    await tab.evaluate(()=>{
      const s=JSON.parse(localStorage.getItem('tikitikit_visit_v1'));
      s.startedAt=Date.now()-31*60_000;s.lastActivityAt=s.startedAt;localStorage.setItem('tikitikit_visit_v1',JSON.stringify(s));
      window.VisitTest.trackVisitAction('booking');
    });await tab.waitForTimeout(100);
    assert.notEqual(received.at(-1).visitId,first.visitId);
    assert.equal(received.at(-1).visitorId,first.visitorId);
    assert.equal(received.at(-1).channel,'unknown');
    const count=received.length;
    await tab.evaluate(()=>{localStorage.setItem('tikitikit_analytics_excluded','true');window.VisitTest.clearVisitAnalytics();window.VisitTest.trackVisitAction('booking')});
    await tab.waitForTimeout(100);assert.equal(received.length,count);
    assert.equal(await tab.evaluate(()=>localStorage.getItem('tikitikit_visit_v1')),null);
    for (const signal of ['doNotTrack','globalPrivacyControl']) {
      const c=await browser.newContext();await c.addInitScript(signal=>{
        Object.defineProperty(navigator,'webdriver',{get:()=>false});
        Object.defineProperty(navigator,signal,{get:()=>signal==='doNotTrack'?'1':true});
      },signal);
      const p=await c.newPage();await p.goto(origin+'/');await p.evaluate(()=>window.VisitTest.startVisitAnalytics(location.href,''));
      await p.waitForTimeout(100);assert.equal(received.length,count);await c.close();
    }
    const blocked=await browser.newContext();const bp=await blocked.newPage();await bp.goto(origin+'/');
    await bp.evaluate(()=>window.VisitTest.startVisitAnalytics(location.href,''));await bp.waitForTimeout(100);
    assert.equal(received.length,count);await blocked.close();
    const failure=await browser.newContext();await failure.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false}));
    const fp=await failure.newPage();await fp.goto(origin+'/');fail=true;
    await fp.evaluate(()=>window.VisitTest.trackVisitAction('booking'));await fp.waitForTimeout(1200);
    assert.equal(received.length,count+2);
    await fp.evaluate(()=>{for(let i=0;i<10;i++)window.VisitTest.trackVisitAction('booking')});await fp.waitForTimeout(100);
    assert.equal(received.length,count+2); // bounded across repeated actions, not only per call
    await context.close();await failure.close();
    console.log('Browser: shared tabs, refresh, activity timeout, fixed attribution, owner exclusion, DNT/GPC, bot exclusion and bounded retry passed');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
