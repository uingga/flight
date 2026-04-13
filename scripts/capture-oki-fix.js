const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
    
    const flight = {
        id: 'oki-249k', source: 'ttang', airline: '이스타항공',
        departure: { city: '인천', airport: 'ICN', date: '2026-04-22', time: '11:30' },
        arrival: { city: '오키나와', airport: 'OKA', date: '2026-04-24', time: '15:00' },
        price: 249000, currency: 'KRW', link: '', seats: '',
        discountRate: 49
    };

    await page.route('**/api/flights*', async route => {
        await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ flights: [flight], lastUpdated: new Date().toISOString() })
        });
    });

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    try {
        const dateTag = page.locator('span:has-text("~") button');
        if (await dateTag.first().isVisible({ timeout: 2000 }).catch(() => false)) {
            await dateTag.first().click();
            await page.waitForTimeout(500);
        }
    } catch (e) {}
    try {
        const allChip = page.locator('button').filter({ hasText: '전체' }).first();
        if (await allChip.isVisible({ timeout: 2000 }).catch(() => false)) {
            await allChip.click();
            await page.waitForTimeout(1000);
        }
    } catch (e) {}

    const card = page.locator('.card').first();
    await card.waitFor({ state: 'visible', timeout: 10000 });
    await card.screenshot({ path: path.join(__dirname, '..', 'public', 'blog-cards', 'icn_1.png') });
    console.log('✅ icn_1.png (오키나와 249,000원) 저장 완료');

    await browser.close();
})();
