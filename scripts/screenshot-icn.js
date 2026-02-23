const { chromium } = require('playwright');

const PADDING = 24;

// 인천/서울 출발 최저가 TOP — 도시별 중복 제거, 블로그 표지용
const flights = [
    { name: 'icn_manila', id: 'icn-1', source: 'modetour', airline: '필리핀항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-04' }, arrival: { airport: 'MNL', city: '마닐라', date: '2026-03-08' }, price: 155000, bookingLink: '#', currency: 'KRW' },
    { name: 'icn_kota', id: 'icn-2', source: 'hanatour', airline: '제주항공', departure: { airport: 'ICN', city: '인천', date: '2026-02-21' }, arrival: { airport: 'BKI', city: '코타키나발루', date: '2026-02-25' }, price: 199000, bookingLink: '#', currency: 'KRW' },
    { name: 'icn_taipei', id: 'icn-3', source: 'ttang', airline: '스쿠트항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-06' }, arrival: { airport: 'TPE', city: '타이페이', date: '2026-03-09' }, price: 239000, bookingLink: '#', currency: 'KRW' },
    { name: 'icn_saipan', id: 'icn-4', source: 'hanatour', airline: '제주항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-03' }, arrival: { airport: 'SPN', city: '사이판', date: '2026-03-06' }, price: 239000, bookingLink: '#', currency: 'KRW' },
    { name: 'icn_phuquoc', id: 'icn-5', source: 'ttang', airline: '비엣젯항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-09' }, arrival: { airport: 'PQC', city: '푸꾸옥', date: '2026-03-13' }, price: 240000, bookingLink: '#', currency: 'KRW' },
    { name: 'icn_bangkok', id: 'icn-6', source: 'ybtour', airline: '이스타항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-09' }, arrival: { airport: 'BKK', city: '방콕', date: '2026-03-13' }, price: 249000, bookingLink: '#', currency: 'KRW' },
    { name: 'icn_cebu', id: 'icn-7', source: 'hanatour', airline: '제주항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-04' }, arrival: { airport: 'CEB', city: '세부', date: '2026-03-08' }, price: 249000, bookingLink: '#', currency: 'KRW' },
    { name: 'icn_hakodate', id: 'icn-8', source: 'ttang', airline: '제주항공', departure: { airport: 'ICN', city: '인천', date: '2026-03-01' }, arrival: { airport: 'HKD', city: '하코다테', date: '2026-03-05' }, price: 250000, bookingLink: '#', currency: 'KRW' },
];

(async () => {
    try {
        const browser = await chromium.launch();
        const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });

        for (const f of flights) {
            console.log(`Taking screenshot for ${f.name}`);

            await page.route('**/api/flights*', async route => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ flights: [f], lastUpdated: new Date().toISOString() })
                });
            });

            await page.goto('https://tikitikit.kr', { waitUntil: 'networkidle', timeout: 15000 });
            await page.waitForTimeout(1500);

            const card = page.locator('.card').first();
            try {
                await card.waitFor({ state: 'visible', timeout: 8000 });
                const box = await card.boundingBox();
                if (!box) { console.error(`No box for ${f.name}`); continue; }

                await page.screenshot({
                    path: `C:\\Users\\ynal\\.gemini\\antigravity\\brain\\c575a476-1438-4c27-8c9b-a0f33849dc8c\\ui_card_${f.name}.png`,
                    clip: { x: Math.max(0, box.x - PADDING), y: Math.max(0, box.y - PADDING), width: box.width + PADDING * 2, height: box.height + PADDING * 2 }
                });
                console.log(`Saved ui_card_${f.name}.png`);
            } catch (e) {
                console.error(`Failed for ${f.name}`, e.message);
            }

            await page.unroute('**/api/flights*');
        }

        await browser.close();
        console.log('All Incheon screenshots completed.');
    } catch (err) {
        console.error('Script error:', err);
    }
})();
