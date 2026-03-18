const path = require('path');
const fs = require('fs');

const CARDS_DIR = path.join(__dirname, '..', 'public', 'blog-cards');

async function main() {
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const localUrl = 'http://localhost:3000';

    // Mock flight data for Saipan
    const saipanFlight = {
        departure: { city: '인천', date: '2026-03-23', time: '10:10' },
        arrival: { city: '사이판', date: '2026-03-26', time: '15:30' },
        airline: '제주항공',
        price: 199000,
        source: 'hanatour',
        discountRate: 49,
    };

    console.log('📸 icn_2: 인천 → 사이판 (수동)');

    const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
    try {
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

        await page.goto(localUrl, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(1500);

        // Remove date filter
        try {
            const dateTag = page.locator('span:has-text("~") button');
            if (await dateTag.first().isVisible({ timeout: 2000 }).catch(() => false)) {
                await dateTag.first().click();
                await page.waitForTimeout(500);
            }
        } catch (e) { }

        // Select '전체' departure filter
        try {
            const allChip = page.locator('button').filter({ hasText: '전체' }).first();
            if (await allChip.isVisible({ timeout: 2000 }).catch(() => false)) {
                await allChip.click();
                await page.waitForTimeout(1000);
            }
        } catch (e) { }

        const cardLocator = page.locator('.card').first();
        await cardLocator.waitFor({ state: 'visible', timeout: 10000 });

        const savePath = path.join(CARDS_DIR, 'icn_2.png');
        await cardLocator.screenshot({ path: savePath });
        console.log('✅ icn_2.png 저장 완료');
    } catch (e) {
        console.error('❌ 캡처 실패:', e.message?.split('\n')[0]);
    } finally {
        await page.close();
    }

    await browser.close();
}

main().catch(err => { console.error('❌', err); process.exit(1); });
