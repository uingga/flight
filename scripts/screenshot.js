const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PADDING = 24; // px of whitespace around the card

const allFlights = [
    {
        id: "mock-1", source: "ttang", airline: "에어로케이",
        departure: { airport: "CJJ", city: "청주", date: "2026-03-03" },
        arrival: { airport: "TAO", city: "칭다오", date: "2026-03-05" },
        price: 143000, bookingLink: "#", seatStatus: "5석"
    },
    {
        id: "mock-2", source: "ttang", airline: "제주항공",
        departure: { airport: "PUS", city: "부산", date: "2026-03-02" },
        arrival: { airport: "CEB", city: "세부", date: "2026-03-06" },
        price: 151500, bookingLink: "#", seatStatus: "4석"
    },
    {
        id: "mock-3", source: "ybtour", airline: "에어부산",
        departure: { airport: "PUS", city: "부산", date: "2026-02-27" },
        arrival: { airport: "TAK", city: "다카마쓰", date: "2026-03-02" },
        price: 179000, bookingLink: "#", seatStatus: "3석"
    },
    {
        id: "mock-4", source: "ybtour", airline: "진에어",
        departure: { airport: "ICN", city: "인천", date: "2026-03-02" },
        arrival: { airport: "GUM", city: "괌", date: "2026-03-06" },
        price: 189000, bookingLink: "#", seatStatus: "2석"
    },
    {
        id: "mock-5", source: "ybtour", airline: "제주항공",
        departure: { airport: "ICN", city: "인천", date: "2026-02-27" },
        arrival: { airport: "MYJ", city: "마츠야마", date: "2026-03-01" },
        price: 189000, bookingLink: "#", seatStatus: "2석"
    }
];

const flightsFileNames = ['1_qingdao', '2_cebu', '3_takamatsu', '4_guam', '5_matsuyama'];

(async () => {
    try {
        const browser = await chromium.launch();
        const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });

        for (let i = 0; i < allFlights.length; i++) {
            const f = allFlights[i];
            const name = flightsFileNames[i];
            console.log(`Taking screenshot for ${name}`);

            // Mock API to return ONLY this single flight — no other cards will render
            await page.route('**/api/flights*', async route => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        flights: [f],
                        lastUpdated: new Date().toISOString()
                    })
                });
            });

            await page.goto(`http://localhost:3000`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(1000);

            const cardLocator = page.locator('.card').first();

            try {
                await cardLocator.waitFor({ state: 'visible', timeout: 5000 });

                const box = await cardLocator.boundingBox();
                if (!box) { console.error(`No bounding box for ${name}`); continue; }

                const savePath = `C:\\Users\\ynal\\.gemini\\antigravity\\brain\\c575a476-1438-4c27-8c9b-a0f33849dc8c\\ui_card_${name}.png`;
                await page.screenshot({
                    path: savePath,
                    clip: {
                        x: Math.max(0, box.x - PADDING),
                        y: Math.max(0, box.y - PADDING),
                        width: box.width + PADDING * 2,
                        height: box.height + PADDING * 2,
                    }
                });
                console.log(`Saved ui_card_${name}.png (${Math.round(box.width + PADDING * 2)}x${Math.round(box.height + PADDING * 2)})`);
            } catch (e) {
                console.error(`Failed for ${name}`);
            }

            // Unroute so the next iteration can set a new route
            await page.unroute('**/api/flights*');
        }

        await browser.close();
        console.log('All screenshots completed.');
    } catch (err) {
        console.error('Script error:', err);
    }
})();
