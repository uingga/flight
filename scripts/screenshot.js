const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PADDING = 24; // px of whitespace around the card

const allFlights = [
    {
        id: "mock-1", source: "ttang", airline: "에어부산",
        departure: { airport: "PUS", city: "부산", date: "2026-02-22" },
        arrival: { airport: "NGS", city: "나가사키", date: "2026-02-24" },
        price: 120000, bookingLink: "#", seatStatus: "2석"
    },
    {
        id: "mock-2", source: "ttang", airline: "제주항공",
        departure: { airport: "PUS", city: "부산", date: "2026-03-02" },
        arrival: { airport: "CEB", city: "세부", date: "2026-03-06" },
        price: 151500, bookingLink: "#", seatStatus: "4석"
    },
    {
        id: "mock-3", source: "modetour", airline: "필리핀항공",
        departure: { airport: "ICN", city: "인천", date: "2026-03-04" },
        arrival: { airport: "MNL", city: "마닐라", date: "2026-03-08" },
        price: 155000, bookingLink: "#"
    },
    {
        id: "mock-4", source: "ybtour", airline: "이스타항공",
        departure: { airport: "ICN", city: "인천", date: "2026-03-24" },
        arrival: { airport: "BKK", city: "방콕", date: "2026-03-28" },
        price: 249000, bookingLink: "#"
    },
    {
        id: "mock-5", source: "ybtour", airline: "진에어",
        departure: { airport: "PUS", city: "부산", date: "2026-03-03" },
        arrival: { airport: "FUK", city: "후쿠오카", date: "2026-03-06" },
        price: 182900, bookingLink: "#", seatStatus: "3석"
    }
];

const flightsFileNames = ['1_nagasaki', '2_cebu', '3_manila', '4_bangkok', '5_fukuoka'];

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

            await page.goto(`https://tikitikit.kr`, { waitUntil: 'networkidle' });
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
