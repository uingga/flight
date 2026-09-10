const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const output = path.resolve('output/mobile-advanced-filters-20260910');
    fs.mkdirSync(output, { recursive: true });
    try {
        for (const width of [390, 320, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 1000 } });
            const fixture = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf8'));
            await page.route('**/api/preview-flights?*', route => route.fulfill({ json: { success: true, flights: fixture.flights, lastUpdated: new Date().toISOString() } }));
            await page.goto('http://127.0.0.1:3499/preview/mobile-redesign', { waitUntil: 'networkidle' });
            await page.getByRole('button', { name: width < 960 ? '필터' : '상세 조건', exact: true }).click();
            const dialog = page.locator('[role="dialog"][aria-label="항공권 필터"]');
            const toggle = dialog.locator('button[aria-controls="advanced-filter-options"]');
            const sourceHeading = dialog.getByRole('heading', { name: '여행사', exact: true });
            if (width >= 960) {
                assert.equal(await toggle.isVisible(), false);
                assert.equal(await sourceHeading.isVisible(), true);
                assert.equal(await dialog.getByRole('button', { name: '항공사 선택: 전체 항공사' }).isVisible(), true);
                console.log('PASS PC: original advanced controls remain visible');
                await page.close();
                continue;
            }
            assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
            assert.equal(await sourceHeading.isVisible(), false);
            await toggle.screenshot({ path: path.join(output, `collapsed-${width}.png`) });
            await toggle.click();
            assert.equal(await sourceHeading.isVisible(), true);
            await dialog.getByRole('button', { name: '노랑풍선', exact: true }).click();
            assert.match(await toggle.innerText(), /1개 선택/);
            const airlines = dialog.locator('label[class*="mobileAirlineSelect"] select');
            const option = await airlines.locator('option').nth(1).textContent();
            await airlines.selectOption(option);
            assert.match(await toggle.innerText(), /2개 선택/);
            await toggle.click();
            assert.equal(await sourceHeading.isVisible(), false);
            assert.equal(await airlines.isVisible(), false);
            assert.match(await toggle.innerText(), /2개 선택/);
            await dialog.screenshot({ path: path.join(output, `selected-collapsed-${width}.png`) });
            await dialog.getByRole('button', { name: /개 항공권 보기/ }).click();
            await dialog.waitFor({ state: 'hidden' });
            await page.getByRole('button', { name: '필터', exact: true }).click();
            assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
            assert.match(await toggle.innerText(), /2개 선택/);
            await toggle.click();
            assert.equal(await airlines.inputValue(), option);
            await dialog.getByRole('button', { name: '초기화', exact: true }).click();
            assert.doesNotMatch(await toggle.innerText(), /개 선택/);
            await toggle.click();
            await dialog.screenshot({ path: path.join(output, `default-${width}.png`) });
            assert.ok(await dialog.getByRole('button', { name: /개 항공권 보기/ }).isVisible());
            console.log(`PASS ${width}px: default collapsed, expand, 1/2 selection counts, preserve, reopen, reset, CTA`);
            await page.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
