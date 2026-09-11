import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const baseUrl = process.env.PREVIEW_BASE_URL || 'http://127.0.0.1:31860';
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${baseUrl}/preview/te31-posts`);
        assert.ok(await page.getByText('TE31 반응은 수동 기록입니다.', { exact: true }).isVisible());
        assert.ok(await page.getByText('실시간 통계가 아닙니다.', { exact: true }).isVisible());
        const rows = page.locator('tbody > tr');
        assert.equal(await rows.count(), 6);
        assert.match(await rows.nth(0).locator('[data-label="방문"]').innerText(), /3명/);
        assert.match(await rows.nth(0).locator('[data-label="예약 이동"]').innerText(), /0명/);
        assert.equal(await rows.nth(2).locator('[data-label="상세"]').innerText(), '—');
        assert.equal(await rows.nth(3).locator('[data-label="추천"]').innerText(), '—');
        assert.equal(await page.getByText('글별 추적 불가', { exact: true }).count(), 3);
        await rows.nth(0).getByText('추적 기준', { exact: true }).click();
        assert.equal(await rows.nth(0).locator('details').getAttribute('open'), '');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        fs.mkdirSync('tmp/te31-verification', { recursive: true });
        await page.screenshot({ path: `tmp/te31-verification/${width}.png`, fullPage: true });
    }
    await page.goto(`${baseUrl}/preview/te31-posts?state=unavailable`);
    assert.equal(await page.getByText('사이트 통계 확인 불가', { exact: true }).count(), 3);
    assert.equal(await page.locator('tbody tr').first().locator('[data-label="방문"]').innerText(), '—');
    await page.goto(`${baseUrl}/preview/te31-posts?state=empty`);
    assert.equal(await page.getByText('집계 기록 없음', { exact: true }).count(), 3);
    assert.deepEqual(errors, []);
    console.log('TE31 UI: desktop/mobile, unknown vs zero, empty/unavailable passed');
} finally { await browser.close(); }
