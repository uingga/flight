const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = 'C:\\Users\\ynal\\.gemini\\antigravity\\brain\\c575a476-1438-4c27-8c9b-a0f33849dc8c';

const allCards = [
    { name: '1_nagasaki', id: 'm1', source: 'ttang', airline: '에어부산', departure: { airport: 'PUS', city: '부산', date: '2026-02-22' }, arrival: { airport: 'NGS', city: '나가사키', date: '2026-02-24' }, price: 120000, bookingLink: '#', currency: 'KRW', seatStatus: '2석' },
    { name: '2_cebu', id: 'm2', source: 'ttang', airline: '제주항공', departure: { airport: 'PUS', city: '부산', date: '2026-03-02' }, arrival: { airport: 'CEB', city: '세부', date: '2026-03-06' }, price: 151500, bookingLink: '#', currency: 'KRW', seatStatus: '4석' },
    { name: '3_manila', id: 'm3', source: 'modetour', airline: '필리핀항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-04' }, arrival: { airport: 'MNL', city: '마닐라', date: '2026-03-08' }, price: 155000, bookingLink: '#', currency: 'KRW' },
    { name: '4_bangkok', id: 'm4', source: 'ybtour', airline: '이스타항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-04' }, arrival: { airport: 'BKK', city: '방콕', date: '2026-03-08' }, price: 249000, bookingLink: '#', currency: 'KRW' },
    { name: '5_fukuoka', id: 'm5', source: 'ybtour', airline: '진에어', departure: { airport: 'PUS', city: '부산', date: '2026-03-03' }, arrival: { airport: 'FUK', city: '후쿠오카', date: '2026-03-06' }, price: 182900, bookingLink: '#', currency: 'KRW', seatStatus: '3석' },
];

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });

    // Step 1: Capture each card tightly
    const cardImages = [];
    for (const c of allCards) {
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

    // Step 2: Arrange in 3+2 grid
    const page2 = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const srcs = cardImages.map(b => 'data:image/png;base64,' + b);

    await page2.setContent(`
    <html>
    <body style="margin:0; padding:16px; background:#f3f4f6; display:inline-block;">
      <div style="display:flex; gap:6px; margin-bottom:6px;">
        <img src="${srcs[0]}" style="display:block; flex:1;">
        <img src="${srcs[1]}" style="display:block; flex:1;">
        <img src="${srcs[2]}" style="display:block; flex:1;">
      </div>
      <div style="display:flex; gap:6px; justify-content:center;">
        <img src="${srcs[3]}" style="display:block; flex:1; max-width:calc(33.33% - 2px);">
        <img src="${srcs[4]}" style="display:block; flex:1; max-width:calc(33.33% - 2px);">
      </div>
    </body>
    </html>
  `);
    await page2.waitForTimeout(500);

    const dims = await page2.evaluate(() => {
        const body = document.body;
        const r = body.getBoundingClientRect();
        return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
    });

    await page2.screenshot({
        path: path.join(base, 'ui_card_top5_grid.png'),
        clip: { x: 0, y: 0, width: dims.w, height: dims.h }
    });
    console.log(`Saved top5 grid (${dims.w}x${dims.h})`);
    await browser.close();
})();
