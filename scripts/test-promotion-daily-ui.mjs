import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const base = process.env.PREVIEW_BASE_URL || 'http://127.0.0.1:31861';
const browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
try {
    const page = await browser.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue() : route.abort());
    assert.equal((await page.request.get(`${base}/api/admin/promotion-daily?key=flight-order-local-preview`)).status(),401);
    assert.equal((await page.request.post(`${base}/api/admin/promotion-daily`)).status(),405);
    assert.equal((await page.request.get(`${base}/api/internal/promotion-daily`)).status(),405);
    assert.equal((await page.request.post(`${base}/api/internal/promotion-daily`)).status(),401);
    assert.equal((await page.request.get(`${base}/api/admin/promotion-daily`, {headers:{Authorization:'Bearer flight-order-local-preview'}})).status(),503);
    for (const width of [1440,390,320]) {
        await page.setViewportSize({width,height:900}); await page.goto(`${base}/preview/promotion-daily`);
        assert.ok(await page.getByText('합성 예시 데이터 · 실시간 통계가 아닙니다.',{exact:true}).isVisible());
        assert.ok(await page.getByText('TE31 · 일부 확인 · 최신 확인 필요',{exact:true}).isVisible());
        assert.ok(await page.getByText('전날 대비 +2',{exact:true}).isVisible());
        assert.ok(await page.getByText('확인값 없음',{exact:true}).count()>0);
        assert.ok(await page.getByText('전날 비교 없음',{exact:true}).count()>0);
        assert.ok(await page.getByText('3',{exact:true}).count()>0);
        assert.ok(await page.getByText('0',{exact:true}).count()>0);
        assert.equal(await page.getByText('조회(수동)',{exact:true}).count(),0);
        assert.equal(await page.getByText('114',{exact:true}).count(),0);
        assert.equal(await page.getByText('TE31 반응은 수동 기록입니다.',{exact:true}).count(),0);
        await page.getByText('최근 실행 기록 · 1일',{exact:true}).click();
        assert.ok(await page.getByText('2026-09-11 · 미완료',{exact:true}).isVisible());
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        fs.mkdirSync('.local-crawler/promotion-ui',{recursive:true});
        await page.screenshot({path:`.local-crawler/promotion-ui/${width}.png`,fullPage:true});
    }
    await page.goto(`${base}/preview/promotion-daily?state=empty`);
    assert.ok(await page.getByText('아직 저장된 일별 성과가 없습니다.',{exact:true}).isVisible());
    assert.deepEqual(errors,[]);
    console.log('PASS promotion daily UI: 1440/390/320, sparse values, true zero, delta, stale, incomplete, empty, no duplicate manual TE31 counts, no page overflow');
} finally { await browser.close(); }
