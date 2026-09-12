import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { YbtourInteractionGuard } from '../src/lib/scrapers/ybtour-interaction';
import { IncompleteScrapeError } from '../src/lib/scrapers/scrape-errors';
import { classifySourceAccessRestriction } from '../src/lib/source-circuit';

test('offline Chromium: normal, temporary, multiple and stuck masks; CAPTCHA stays protected', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        let externalRequests = 0;
        await context.route('**/*', route => { externalRequests++; return route.abort(); });
        const page = await context.newPage();
        const html = (masks: string, text = '항공권 목록') => `
            <style>.dimBox { position:fixed; inset:0; z-index:10; background:#ddd; }</style>
            <body data-clicks="0">${text}<button onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks)+1)">조회</button>${masks}</body>`;
        const clicks = () => page.locator('body').getAttribute('data-clicks');
        const action = () => page.getByRole('button', { name: '조회' }).click({ timeout: 500 });

        await page.setContent(html(''));
        await new YbtourInteractionGuard(page).click('정상', action);
        assert.equal(await clicks(), '1');

        await page.setContent(html('<div class="dimBox bg" style="display:none"></div><div class="dimBox bg"></div>'));
        await page.evaluate("setTimeout(() => document.querySelectorAll('.dimBox').forEach(el => el.remove()), 150)");
        await new YbtourInteractionGuard(page, 1000).click('일시 덮개', action);
        assert.equal(await clicks(), '1');

        await page.setContent(html('<div class="dimBox bg"></div>'));
        await assert.rejects(new YbtourInteractionGuard(page, 100).click('지속 덮개', action), error => {
            assert.ok(error instanceof IncompleteScrapeError);
            assert.equal(classifySourceAccessRestriction(error), null);
            return true;
        });
        assert.equal(await clicks(), '0');
        assert.equal(await page.locator('.dimBox').count(), 1, 'guard must never remove the mask');

        await page.setContent(html('<div class="dimBox bg"></div>', 'CAPTCHA'));
        await assert.rejects(new YbtourInteractionGuard(page, 100).click('접근 제한', action), error => {
            assert.equal(classifySourceAccessRestriction(error)?.reason, 'blocked'); return true;
        });
        assert.equal(await clicks(), '0');
        assert.equal(externalRequests, 0, 'tests must not contact any travel agency');
    } finally {
        await browser.close();
    }
});
