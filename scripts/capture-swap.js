const { chromium } = require('playwright');
const path = require('path');

const flights = [
    {
        label: 'rank_hakodate',
        data: {
            id: 'override-hkd', source: 'ttang', airline: '제주항공',
            departure: { city: '인천', airport: 'ICN', date: '2026-04-16', time: '' },
            arrival: { city: '하코다테', airport: 'HKD', date: '2026-04-19', time: '' },
            price: 350000, currency: 'KRW', link: '', seats: ''
        }
    },
    {
        label: 'icn_qingdao',
        data: {
            id: 'override-tao', source: 'hanatour', airline: '산동항공',
            departure: { city: '인천', airport: 'ICN', date: '2026-05-06', time: '' },
            arrival: { city: '칭다오', airport: 'TAO', date: '2026-05-08', time: '' },
            price: 227300, currency: 'KRW', link: '', seats: ''
        }
    }
];

(async () => {
    const browser = await chromium.launch();
    for (const { label, data } of flights) {
        console.log(`📸 ${label}: ${data.departure.city} → ${data.arrival.city}`);
        const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
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
        await card.screenshot({ path: path.join(__dirname, '..', 'public', 'blog-cards', `${label}.png`) });
        console.log(`  ✅ ${label}.png`);
        await page.close();
    }
    await browser.close();
    console.log('Done!');
})();
