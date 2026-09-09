import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:31861';
const ids = ['ttang-VJ0835ICNCXR-G110-2026-09-13', 'ttang-7C1501ICNCTS-G3-2026-09-18', 'modetour-ASIA-20135807'];
const browser = await chromium.launch({ headless: true });
try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2', 'dismissed'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/c/te31-icn-260909`);
    const cards = page.locator('article[data-flight-id]');
    await cards.first().waitFor();
    assert.deepEqual(await cards.evaluateAll(items => items.map(item => item.dataset.flightId)), ids);
    for (const city of ['나트랑', '삿포로', '하노이']) {
        assert.equal(await page.getByRole('heading', { name: `인천 → ${city}`, exact: true }).count(), 1);
    }
    // Preserve the site's current base-fare display; ttang fees are explained in details.
    for (const [index, price] of ['150,000', '249,000', '210,000'].entries()) {
        assert.ok((await cards.nth(index).innerText()).includes(price));
    }
    const tracked = new URL(page.url());
    assert.equal(tracked.searchParams.get('utm_content'), 'share_group_icn-260909');
    assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'), '인천 출발 항공권 3개 | 티키티킷');
    for (const width of [1200, 390]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        for (const id of ids) {
            await page.locator(`article[data-flight-id="${id}"]`).getByRole('button').first().click();
            const link = page.getByRole('link', { name: /에서 확인하기/ });
            await link.waitFor();
            if (id.startsWith('ttang-')) {
                assert.ok((await page.locator('body').innerText()).includes('발권수수료'));
                assert.ok((await page.locator('body').innerText()).includes('20,000'));
            }
            assert.match(await link.getAttribute('href'), /^https?:\/\//);
            const detail = new URL(page.url());
            assert.equal(detail.searchParams.get('flight'), id);
            for (const [key, value] of tracked.searchParams) assert.equal(detail.searchParams.get(key), value);
            await page.goBack();
            await cards.first().waitFor();
            assert.equal(await cards.count(), 3);
        }
    }
    const og = await page.request.get(`${base}/api/og?group=icn-260909`);
    assert.equal(og.status(), 200);
    assert.match(og.headers()['content-type'], /image/);
    assert.deepEqual(errors, []);
    console.log('ICN collection: exact 3 flights, base fares and fee notice, desktop/mobile details, back navigation, UTM and OG passed.');
} finally {
    await browser.close();
}
