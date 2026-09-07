import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:31848';
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    // This test uses local fixture data only; never send simulated activity to analytics.
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const count = () => page.locator('tbody tr').count();
    await page.goto(`${base}/preview/flight-interest`);
    await page.getByRole('heading', { name: '어떤 항공권을 눌렀나' }).waitFor();
    assert.equal(await count(), 10);
    assert.equal(await page.getByRole('button', { name: '7일', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('tbody tr').first().innerText(), /demo-7days-1/);
    assert.match(await page.locator('tbody tr').first().innerText(), /39회/);
    assert.equal(await page.locator('tbody tr').first().locator('td').nth(1).innerText(), '30회 · 1명');
    assert.equal(await page.locator('tbody tr').first().locator('td').nth(2).innerText(), '39회 · 1명');
    await page.getByRole('button', { name: '10개 더 보기' }).click();
    assert.equal(await count(), 12);
    assert.equal(await page.getByRole('button', { name: '10개 더 보기' }).count(), 0);
    await page.getByRole('button', { name: '오늘', exact: true }).click();
    assert.equal(await count(), 10);
    assert.match(await page.locator('tbody tr').first().innerText(), /demo-today-1/);
    await page.getByRole('button', { name: '30일', exact: true }).click();
    assert.match(await page.locator('tbody tr').first().innerText(), /demo-30days-1/);
    await page.getByRole('button', { name: '도시별 집계' }).click();
    assert.equal(await count(), 2);
    assert.equal(await page.getByRole('button', { name: '30일', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('tbody tr').first().innerText(), /도쿄/);
    assert.equal(await page.getByText('노출만 있는 도시', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('columnheader', { name: '실제 노출' }).count(), 0);
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        for (const view of ['항공권별', '도시별 집계']) {
            await page.getByRole('button', { name: view, exact: true }).click();
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${view} must not overflow viewport at ${width}px`);
        }
    }
    for (const state of ['empty', 'unavailable']) {
        await page.goto(`${base}/preview/flight-interest?state=${state}`);
        assert.equal(await count(), 0);
        assert.equal(await page.getByRole('button', { name: '10개 더 보기' }).count(), 0);
        assert.match(await page.getByRole('status').innerText(), state === 'empty' ? /미수집 기록은 0회로 추정하지 않습니다/ : /GA4 항공권 ID 측정기준/);
    }
    await page.goto(`${base}/preview/flight-interest?state=users-unavailable`);
    assert.equal(await count(), 10);
    assert.equal(await page.locator('tbody tr').first().locator('td').nth(1).innerText(), '30회 · 인원 미확인');
    assert.match(await page.getByRole('status').innerText(), /횟수로 인원수를 추정하지 않습니다/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    console.log('PASS: default 10, show more, all periods, booking order, city fallback, missing states, 390px/320px layouts, no browser errors');
} finally { await browser.close(); }
