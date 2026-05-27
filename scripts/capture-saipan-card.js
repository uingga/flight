const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 800, height: 1000 } });
    const page = await context.newPage();

    const saipanFlight = {
        id: 'saipan-test',
        source: 'ybtour',
        airline: '제주항공',
        departure: { city: '인천', airport: 'ICN', date: '2026-05-10' },
        arrival: { city: '사이판', airport: 'SPN', date: '2026-05-14' },
        price: 279000,
        currency: 'KRW',
        link: 'https://fly.ybtour.co.kr',
        seats: '20석',
        region: '남태평양',
        discountRate: 1
    };

    await page.route('**/api/flights*', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                flights: [saipanFlight],
                lastUpdated: new Date().toISOString()
            })
        });
    });

    try {
        await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
        console.log('networkidle timeout, continuing anyway...');
    }
    
    await new Promise(r => setTimeout(r, 3000));

    // Remove date filter
    try {
        const dateTag = page.locator('span:has-text("~") button');
        if (await dateTag.first().isVisible({ timeout: 2000 }).catch(() => false)) {
            await dateTag.first().click();
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (e) {}

    // Click "전체" chip
    try {
        const allChip = page.locator('button').filter({ hasText: '전체' }).first();
        if (await allChip.isVisible({ timeout: 2000 }).catch(() => false)) {
            await allChip.click();
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) {}

    const card = page.locator('.card').first();
    await card.waitFor({ state: 'visible', timeout: 10000 });
    await card.screenshot({ path: 'public/blog-cards/icn_3.png' });
    console.log('✅ icn_3.png (사이판) 저장 완료');

    await browser.close();
})();
