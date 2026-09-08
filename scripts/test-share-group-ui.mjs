import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
try {
    const context=await browser.newContext({viewport:{width:1200,height:900}});
    await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    await context.addInitScript(()=>localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2','dismissed'));
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:31860/c/te31-pus-260908');
    const cards=page.locator('article[data-flight-id]');
    await cards.first().waitFor();
    assert.equal(await cards.count(),12);
    for(const city of ['장가계','오사카','타이중','시즈오카','광저우']) assert.equal(await page.getByRole('heading',{name:`부산 → ${city}`,exact:true}).count(),1);
    const tracked=new URL(page.url());
    assert.equal(tracked.searchParams.get('utm_content'),'share_group_pus-260908');
    assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'),'부산 출발 특가 5개 | 티키티킷');
    assert.match(await page.locator('meta[property="og:image"]').getAttribute('content'),/group=pus-260908/);
    fs.mkdirSync('tmp/share-group-verification',{recursive:true});
    await page.getByRole('heading',{name:'부산 출발 특가 5개',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:'tmp/share-group-verification/desktop.png'});
    for(const id of ['ttang-7C8253PUSDYG-G11-2026-09-15','modetour-JPN-20178714','modetour-CHI-20107438','modetour-JPN-19972825','modetour-CHI-20081236']) {
        await page.locator(`article[data-flight-id="${id}"]`).getByRole('button').first().click();
        const link=page.getByRole('link',{name:/에서 확인하기/});
        await link.waitFor();
        assert.match(await link.getAttribute('href'),/^https?:\/\//);
        const detail=new URL(page.url());
        for(const [key,value] of tracked.searchParams) assert.equal(detail.searchParams.get(key),value);
        assert.equal(detail.searchParams.get('flight'),id);
        await page.goBack();
        await cards.first().waitFor();
    }
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('heading',{name:'부산 출발 특가 5개',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:'tmp/share-group-verification/mobile.png'});
    const og=await page.request.get('http://127.0.0.1:31860/api/og?group=pus-260908');
    assert.equal(og.status(),200);assert.match(og.headers()['content-type'],/image/);
    fs.writeFileSync('tmp/share-group-verification/og.png',await og.body());
    assert.deepEqual(errors,[]);
    console.log('5 routes, 12 cards, detail/booking links, preserved UTM, responsive layout and OG passed.');
} finally { await browser.close(); }
