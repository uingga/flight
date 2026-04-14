const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
    const data = {
        id: 'override-toy', source: 'ttang', airline: '티웨이항공',
        departure: { city: '인천', airport: 'ICN', date: '2026-04-19', time: '' },
        arrival: { city: '도야마', airport: 'TOY', date: '2026-04-22', time: '' },
        price: 199000, currency: 'KRW', link: '', seats: ''
    };
    await page.route('**/api/flights*', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ flights: [data], lastUpdated: new Date().toISOString() }) });
    });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    try { const dt = page.locator('span:has-text("~") button'); if (await dt.first().isVisible({timeout:2000}).catch(()=>false)) { await dt.first().click(); await page.waitForTimeout(500); } } catch(e){}
    try { const a = page.locator('button').filter({hasText:'전체'}).first(); if (await a.isVisible({timeout:2000}).catch(()=>false)) { await a.click(); await page.waitForTimeout(1000); } } catch(e){}
    const card = page.locator('.card').first();
    await card.waitFor({ state: 'visible', timeout: 10000 });
    await card.screenshot({ path: path.join(__dirname, '..', 'public', 'blog-cards', 'rank_toyama.png') });
    console.log('✅ rank_toyama.png saved');
    await browser.close();
})();
