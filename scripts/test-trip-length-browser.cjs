const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:3578/preview/mobile-redesign';
const make = (id, returnDate, returnTime, arrivalTime) => ({
    id, source: 'ttang', airline: '테스트항공', price: 150000, currency: 'KRW', link: 'https://example.invalid',
    departure: { city: '인천', airport: 'ICN', date: '2026-10-02', time: '18:00' },
    arrival: { city: '방콕', airport: 'BKK', date: returnDate, time: returnTime, arrivalTime },
});
const flights = [make('three', '2026-10-04', '10:00', '17:00'), make('four', '2026-10-04', '23:00', '06:00'),
    make('long', '2026-10-07', '23:00', '06:00'), make('unknown', '2026-10-04', '10:00', undefined)];
(async () => {
    const browser = await chromium.launch({ headless: true });
    fs.mkdirSync('output/trip-length', { recursive: true });
    try {
        for (const width of [320, 390, 1440]) {
            const context = await browser.newContext({ viewport: { width, height: 950 } });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await context.route('**/*', route => {
                const url = new URL(route.request().url());
                if (url.hostname !== '127.0.0.1') return route.abort();
                if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname.includes('flights')
                    ? { success: true, flights, lastUpdated: '2026-09-21T00:00:00Z' }
                    : { success: false, items: [] } });
                return route.continue();
            });
            await page.clock.setFixedTime(new Date('2026-09-21T00:00:00Z'));
            await page.goto(base, { waitUntil: 'networkidle', timeout: 180000 });
            await page.locator('article').first().waitFor({ timeout: 60000 });
            const open = () => page.getByRole('button', { name: width < 960 ? '필터' : '상세 조건', exact: true }).filter({ visible: true }).click();
            await open();
            const dialog = page.getByRole('dialog');
            const group = dialog.getByRole('group', { name: '여행 기간', exact: true });
            await group.getByRole('button', { name: '4일', exact: true }).click();
            await dialog.getByRole('button', { name: '1개 항공권 보기', exact: true }).waitFor();
            assert.equal(await group.getByRole('button', { name: '4일', exact: true }).getAttribute('aria-pressed'), 'true');
            assert.equal(await group.locator('p').count(), 0, 'no explanatory text');
            const box = await group.boundingBox();
            assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'filter must fit viewport');
            await group.screenshot({ path: `output/trip-length/filter-${width}.png` });
            await dialog.getByRole('button', { name: '1개 항공권 보기', exact: true }).click();
            await dialog.waitFor({ state: 'hidden' });
            assert.equal(await page.locator('article').count(), 1);
            assert.match(await page.locator('article').innerText(), /4일/);
            assert.equal(new URL(page.url()).searchParams.get('duration'), '4');
            // Opening/closing a detail keeps the active period filter and corrected card/detail labels.
            await page.locator('article').getByRole('button').first().click();
            await page.getByRole('dialog', { name: '인천 ↔ 방콕' }).waitFor();
            assert.match(await page.getByRole('dialog', { name: '인천 ↔ 방콕' }).innerText(), /4일/);
            await page.getByRole('button', { name: '닫기', exact: true }).click();
            await page.getByRole('dialog').waitFor({ state: 'hidden' });
            await page.reload({ waitUntil: 'networkidle' });
            await open();
            assert.equal(await group.getByRole('button', { name: '4일', exact: true }).getAttribute('aria-pressed'), 'true');
            await group.getByRole('button', { name: '3일 이하', exact: true }).click();
            await dialog.getByRole('button', { name: '2개 항공권 보기', exact: true }).waitFor();
            await group.getByRole('button', { name: '전체', exact: true }).click();
            await dialog.getByRole('button', { name: '4개 항공권 보기', exact: true }).waitFor();
            await group.getByRole('button', { name: '5일', exact: true }).click();
            await dialog.getByRole('button', { name: '0개 항공권 보기', exact: true }).click();
            await dialog.waitFor({ state: 'hidden' });
            const recovery = page.getByRole('button', { name: /^여행 기간 ·/ });
            await recovery.waitFor();
            await recovery.click();
            await page.locator('article').first().waitFor();
            await open();
            await group.getByRole('button', { name: '7일 이상', exact: true }).click();
            await dialog.getByRole('button', { name: '1개 항공권 보기', exact: true }).waitFor();
            await dialog.getByRole('button', { name: '초기화', exact: true }).click();
            assert.equal(await group.getByRole('button', { name: '전체', exact: true }).getAttribute('aria-pressed'), 'true');
            assert.equal(new URL(page.url()).searchParams.has('duration'), false);
            assert.deepEqual(errors, []);
            console.log(`PASS ${width}px: layout, overnight label, multi-select, all/unknown, URL reload, detail, empty recovery, reset, no runtime errors`);
            await context.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
