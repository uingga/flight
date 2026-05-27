const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = 'C:\\Users\\ynal\\.gemini\\antigravity\\brain\\c575a476-1438-4c27-8c9b-a0f33849dc8c';

const cards = [
    { name: 'manila', id: 'c-1', source: 'modetour', airline: '필리핀항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-04' }, arrival: { airport: 'MNL', city: '마닐라', date: '2026-03-08' }, price: 155000, bookingLink: '#', currency: 'KRW' },
    { name: 'bangkok', id: 'c-2', source: 'ybtour', airline: '이스타항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-04' }, arrival: { airport: 'BKK', city: '방콕', date: '2026-03-08' }, price: 249000, bookingLink: '#', currency: 'KRW' },
    { name: 'saipan', id: 'c-3', source: 'ybtour', airline: '티웨이항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-02' }, arrival: { airport: 'SPN', city: '사이판', date: '2026-03-06' }, price: 259000, bookingLink: '#', currency: 'KRW' },
];

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });

    // Step 1: Capture each card with NO padding (tight element screenshot)
    const cardImages = [];
    for (const c of cards) {
        await page.route('**/api/flights*', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ flights: [c], lastUpdated: new Date().toISOString() })
            });
        });
        await page.goto('https://tikitikit.kr', { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(1500);
        const card = page.locator('.card').first();
        await card.waitFor({ state: 'visible', timeout: 8000 });
        const buf = await card.screenshot();
        cardImages.push(buf.toString('base64'));
        console.log(`Captured ${c.name}`);
        await page.unroute('**/api/flights*');
    }

    // Step 2: Combine horizontally — tight fit, minimal gap, no extra whitespace
    const page2 = await browser.newPage({ viewport: { width: 1200, height: 400 } });
    const srcs = cardImages.map(b => 'data:image/png;base64,' + b);

    await page2.setContent(`
    <html>
    <body style="margin:0; padding:16px; background:#f3f4f6; display:inline-flex; gap:6px; align-items:start;">
      <img src="${srcs[0]}" style="display:block;">
      <img src="${srcs[1]}" style="display:block;">
      <img src="${srcs[2]}" style="display:block;">
    </body>
    </html>
  `);
    await page2.waitForTimeout(500);

    // Measure exact content bounds from rendered images
    const dims = await page2.evaluate(() => {
        const imgs = document.querySelectorAll('img');
        let maxBottom = 0;
        let maxRight = 0;
        imgs.forEach(img => {
            const r = img.getBoundingClientRect();
            if (r.bottom > maxBottom) maxBottom = r.bottom;
            if (r.right > maxRight) maxRight = r.right;
        });
        return { w: Math.ceil(maxRight) + 16, h: Math.ceil(maxBottom) + 16 };
    });

    await page2.screenshot({
        path: path.join(base, 'ui_card_icn_combined.png'),
        clip: { x: 0, y: 0, width: dims.w, height: dims.h }
    });
    console.log(`Saved combined (${dims.w}x${dims.h})`);
    await browser.close();
})();
