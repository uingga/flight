import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:3002';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local fixture only');
const direct = { status: 'direct', stopCount: 0, durationMinutes: 125, arrivalDate: '2026-10-08' };
const connection = { status: 'connecting', stopCount: 1, durationMinutes: 1690, arrivalDate: '2026-10-09' };
const make = (id, outbound, inbound) => ({
    id, source: 'tripcom', airline: '테스트항공', price: 250000, currency: 'KRW', link: 'https://kr.trip.com/',
    departure: { city: '서울', airport: 'ICN', date: '2026-10-08', time: '07:15', arrivalTime: '12:25' },
    arrival: { city: '장가계', airport: 'DYG', date: '2026-10-11', time: '14:00', arrivalTime: '17:05' },
    priceCheckedAt: new Date().toISOString(),
    tripcomDetail: { paymentCondition: { kind: 'unverified' }, paymentNotice: null,
        paymentNoticePlacement: 'detail_only', legs: { outbound, inbound: { ...inbound, arrivalDate: '2026-10-11' } } },
});
const unknown = { status: 'unknown', stopCount: null };
const flights = [make('tripcom-connected', connection, direct), make('tripcom-direct', direct, direct),
    make('tripcom-unknown', unknown, unknown)];
await mkdir('output/connection-ui', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
    for (const width of [390, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
            ? route.continue() : route.abort());
        await page.route('**/api/preview-flights?*', route => route.fulfill({
            json: { success: true, flights, count: flights.length, lastUpdated: new Date().toISOString() },
        }));
        await page.goto(`${base}/preview/mobile-redesign`, { waitUntil: 'domcontentloaded' });
        const card = page.locator('article[data-flight-id="tripcom-connected"]');
        await card.waitFor({ timeout: 60000 });
        assert.match(await card.innerText(), /가는편 경유 1회/);
        assert.doesNotMatch(await card.innerText(), /직항|확인 필요/);
        for (const id of ['tripcom-unknown', 'tripcom-direct']) {
            const quietCard = page.locator(`article[data-flight-id="${id}"]`);
            assert.doesNotMatch(await quietCard.innerText(), /경유|직항|확인 필요/);
            assert.equal(await quietCard.locator('[class*="connectionSummary"]').count(), 0);
        }
        await card.screenshot({ path: `output/connection-ui/card-${width}.png` });
        await card.locator('button').first().click();
        const detail = page.locator('[role="dialog"][aria-labelledby="flight-detail-title"]');
        await detail.waitFor();
        await page.waitForFunction(() => {
            const panel = document.querySelector('[role="dialog"][aria-labelledby="flight-detail-title"]');
            return panel && getComputedStyle(panel).opacity === '1';
        });
        assert.match(await detail.innerText(), /경유 1회 · 총 28시간 10분/);
        assert.match(await detail.innerText(), /10[./]\s*9/);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, 'No horizontal page overflow');
        await page.screenshot({ path: `output/connection-ui/detail-${width}.png`, animations: 'disabled' });
        await detail.getByRole('button', { name: '닫기', exact: true }).click();
        await page.locator('article[data-flight-id="tripcom-unknown"] button').first().click();
        await detail.waitFor();
        assert.doesNotMatch(await detail.innerText(), /경유|직항|소요시간 확인 필요/);
        assert.deepEqual(errors, []);
        console.log(`Connection labels, duration, date and layout passed at ${width}px`);
        await page.close();
    }
} finally {
    await browser.close();
}
