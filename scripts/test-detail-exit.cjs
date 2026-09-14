const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    try {
        for (const width of [390, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 960 } });
            await page.goto((process.env.DETAIL_TEST_URL || 'http://127.0.0.1:3503') + '/preview/mobile-redesign');
            const card = page.locator('article[data-flight-id] button[class*="cardBody"]').first();
            const dialog = page.locator('[role="dialog"][aria-label="항공권 상세"]');
            await card.waitFor();
            for (const method of ['button', 'escape', 'back', 'outside']) {
                await card.click();
                await dialog.waitFor();
                await page.waitForTimeout(260);
                // Observe the exit even if automation returns after its short duration.
                await dialog.evaluate(panel => {
                    window.__detailExit = [];
                    const original = panel.animate.bind(panel);
                    panel.animate = (frames, options) => {
                        window.__detailExit.push({ frames, duration: options.duration, connected: panel.isConnected });
                        return original(frames, options);
                    };
                });
                if (method === 'button') await dialog.getByRole('button', { name: '닫기', exact: true }).click();
                if (method === 'escape') await page.keyboard.press('Escape');
                if (method === 'back') await page.goBack();
                if (method === 'outside') {
                    if (width < 960) await page.locator('[role="presentation"]').filter({ has: dialog }).click({ position: { x: 3, y: 3 } });
                    else await page.locator('h1').click();
                }
                await dialog.waitFor({ state: 'hidden' });
                const exits = await page.evaluate(() => window.__detailExit);
                assert.equal(exits.length, 1, method);
                assert.equal(exits[0].duration, 180);
                assert.equal(exits[0].connected, true);
                assert.equal(exits[0].frames[1].opacity, 0);
                assert.ok(!new URL(page.url()).searchParams.has('flight'));
            }
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await card.click();
            await dialog.waitFor();
            await dialog.evaluate(panel => {
                window.__detailExit = [];
                const original = panel.animate.bind(panel);
                panel.animate = (...args) => { window.__detailExit.push(true); return original(...args); };
            });
            await dialog.getByRole('button', { name: '닫기', exact: true }).click();
            await dialog.waitFor({ state: 'hidden' });
            assert.deepEqual(await page.evaluate(() => window.__detailExit), []);
            console.log('PASS', width, 'button, ESC, browser back, outside, reduced motion');
            await page.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
