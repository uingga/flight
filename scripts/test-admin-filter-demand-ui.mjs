import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = 'http://127.0.0.1:31858';
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/preview/filter-demand`);
    await page.getByRole('heading', { name: '사람들이 어떤 조건으로 찾았나' }).waitFor();
    assert.match(await page.locator('main').innerText(), /운영 통계가 아닙니다/);
    assert.match(await page.locator('article').first().innerText(), /30회 · 1명/);
    const cities = page.locator('article').filter({ has: page.getByRole('heading', { name: '검색한 도착 도시', exact: true }) });
    assert.equal(await cities.locator('li').count(), 6);
    await page.getByRole('button', { name: '1개 더 보기' }).click();
    assert.equal(await cities.locator('li').count(), 7);
    await page.getByRole('button', { name: '가격·항공사·여행사', exact: true }).click();
    assert.match(await page.locator('main').innerText(), /200,000원 이하/);
    await page.getByRole('button', { name: '출발 날짜', exact: true }).click();
    assert.equal(await page.getByRole('heading', { name: '출발일 선택 폭', exact: true }).count(), 1);
    assert.equal(await page.locator('article svg').count(), 0);
    assert.equal(await page.getByRole('heading', { name: '고른 여행 기간', exact: true }).count(), 0);
    for (const width of [1200, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const view of ['출발·도착', '가격·항공사·여행사', '출발 날짜']) {
            await page.getByRole('button', { name: view, exact: true }).click();
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${view} overflow at ${width}`);
        }
    }
    for (const state of ['empty', 'unavailable', 'partial']) {
        await page.goto(`${base}/preview/filter-demand?state=${state}`);
        assert.equal(await page.getByRole('status').count(), state === 'partial' ? 2 : 3);
        assert.equal(await page.locator('article').first().locator('li').count(), 0);
        if (state === 'partial') assert.equal(await cities.locator('li').count(), 6);
    }
    assert.deepEqual(errors, []);
    await page.setViewportSize({ width: 1200, height: 1050 });
    await page.goto(`${base}/preview/filter-demand`);
    fs.mkdirSync('tmp/filter-demand-verification', { recursive: true });
    await page.screenshot({ path: 'tmp/filter-demand-verification/desktop.png', fullPage: true });
    assert.equal((await page.request.get(`${base}/api/ga-stats`)).status(), 401);
    assert.equal((await page.request.get(`${base}/preview/filter-demand`, { headers: { host: 'www.tikitikit.kr' } })).status(), 404);
    console.log('Filter demand UI: tabs, counts/users, expansion, missing data, responsive widths and auth passed.');
} finally { await browser.close(); }
