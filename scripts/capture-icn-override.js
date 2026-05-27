const { chromium } = require('playwright');
const path = require('path');

const flights = [
    {
        label: 'icn_2',
        data: {
            id: 'override-toy', source: 'ttang', airline: '티웨이항공',
            departure: { city: '인천', airport: 'ICN', date: '2026-04-19', time: '' },
            arrival: { city: '도야마', airport: 'TOY', date: '2026-04-22', time: '' },
            price: 199000, currency: 'KRW', link: '', seats: ''
        }
    },
    {
        label: 'icn_3',
        data: {
            id: 'override-klo', source: 'ttang', airline: '티웨이항공',
            departure: { city: '인천', airport: 'ICN', date: '2026-04-15', time: '08:30' },
            arrival: { city: '보라카이', airport: 'KLO', date: '2026-04-18', time: '13:00' },
            price: 300000, currency: 'KRW', link: '', seats: '2석',
            discountRate: 53
        }
    }
];

(async () => {
    const browser = await chromium.launch();
    const CARDS_DIR = path.join(__dirname, '..', 'public', 'blog-cards');

    for (const { label, data } of flights) {
        console.log(`📸 ${label}: ${data.departure.city} → ${data.arrival.city}`);
        const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
        try {
            await page.route('**/api/flights*', async route => {
                await route.fulfill({
                    status: 200, contentType: 'application/json',
                    body: JSON.stringify({ flights: [data], lastUpdated: new Date().toISOString() })
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
            await card.screenshot({ path: path.join(CARDS_DIR, `${label}.png`) });
            console.log(`  ✅ ${label}.png 저장`);
        } catch (e) {
            console.error(`  ❌ ${label} 실패:`, e.message?.split('\n')[0]);
        } finally {
            await page.close();
        }
    }
    await browser.close();
    console.log('Done!');
})();
