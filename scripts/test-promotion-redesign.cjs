const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch();
    try {
        for (const width of [320, 390, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto((process.env.PREVIEW_BASE_URL || 'http://127.0.0.1:3509') + '/preview/promotion-daily');
            const channels = page.getByLabel('성과 채널 선택');
            for (const name of ['Threads', 'TE31', '사이트 행동']) {
                await channels.getByRole('button', { name: new RegExp(name) }).click();
                assert.equal(await page.locator('section[aria-label$="일별 성과"]').count(), 1);
                const content = page.locator('details[class*="postContent"]').first();
                assert.equal(await content.getAttribute('open'), null);
                const excerpt = content.locator('[class*="postExcerpt"]');
                assert.equal(await excerpt.evaluate(el => getComputedStyle(el).webkitLineClamp), '2');
                const metrics = page.locator('article > dl').first();
                assert.equal(await metrics.locator('dt').count(), 3);
                const before = await metrics.innerText();
                await content.locator('summary').click();
                assert.equal(await excerpt.evaluate(el => getComputedStyle(el).display), 'block');
                await content.locator('summary').press('Enter');
                assert.equal(await content.getAttribute('open'), null);
                assert.equal(await metrics.innerText(), before);
                const extra = page.locator('details[class*="metricDetails"]').first();
                await extra.locator('summary').click();
                assert.ok(await extra.locator('time').count() > 0);
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            }
            assert.deepEqual(errors, []);
            console.log('PASS', width, 'channels, excerpt, keyboard, metrics, timestamps, overflow');
            await page.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
