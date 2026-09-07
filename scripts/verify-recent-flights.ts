import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.argv[2] || 'http://127.0.0.1:3114/';
const key = 'tikitikit_recent_flights_v1';
async function main() {
    const browser = await chromium.launch({ headless: true });
    await mkdir('output/recent-flights', { recursive: true });
    try {
        for (const width of [1440, 390, 320]) {
            const context = await browser.newContext({ viewport: { width, height: 900 } });
            await context.addInitScript(() => localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2', 'dismissed'));
            await context.route('**/*', route => {
                const request = route.request(), url = new URL(request.url());
                if (url.origin !== new URL(base).origin || !['GET', 'HEAD'].includes(request.method())) {
                    return route.fulfill({ contentType: request.resourceType() === 'script' ? 'application/javascript' : 'application/json', body: request.resourceType() === 'script' ? '' : '{}' });
                }
                return route.continue();
            });
            const page = await context.newPage();
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(base, { waitUntil: 'networkidle' });
            const trigger = page.getByRole('button', { name: /^최근 본 표 \d+/ });
            assert.equal(await trigger.count(), 0);
            const card = page.locator('article[data-flight-id]').first();
            await card.waitFor();
            const firstId = await card.getAttribute('data-flight-id');
            await card.locator('button').first().click();
            const detail = page.locator('[role="dialog"][aria-label="항공권 상세"]');
            await detail.waitFor();
            if (width >= 960) {
                await trigger.waitFor();
                // The right panel covers this control visually, but the non-modal page remains keyboard-accessible.
                await trigger.focus();
                await page.keyboard.press('Enter');
                const stacked = page.getByRole('dialog', { name: '최근 본 표', exact: true });
                await stacked.waitFor();
                await page.keyboard.press('Escape');
                await stacked.waitFor({ state: 'hidden' });
                await detail.waitFor();
            }
            await page.keyboard.press('Escape');
            await detail.waitFor({ state: 'hidden' });
            await trigger.waitFor();
            assert.match(await trigger.innerText(), /1/);
            const heading = page.getByRole('heading', { name: '전체 항공권', exact: true });
            await heading.scrollIntoViewIfNeeded();
            const metadata = heading.locator('..').locator('span').first();
            assert.match(await metadata.innerText(), /개 · .+기준/);
            const recentBox = (await trigger.boundingBox())!;
            const sortBox = (await page.getByRole('button', { name: '항공권 정렬', exact: true }).boundingBox())!;
            assert.ok(Math.abs(recentBox.y - sortBox.y) < 3);
            assert.ok(recentBox.x + recentBox.width <= sortBox.x + 1);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            await page.screenshot({ path: 'output/recent-flights/heading-' + width + '.png' });
            await trigger.click();
            const recent = page.getByRole('dialog', { name: '최근 본 표', exact: true });
            await recent.waitFor();
            await page.keyboard.press('Tab');
            assert.equal(await recent.evaluate(el => el.contains(document.activeElement)), true);
            await page.screenshot({ path: 'output/recent-flights/dialog-' + width + '.png' });
            await recent.getByRole('button').filter({ hasText: '상세 보기' }).first().click();
            await detail.waitFor();
            assert.equal(new URL(page.url()).searchParams.get('flight'), firstId);
            await page.goBack();
            await recent.waitFor();
            await page.keyboard.press('Escape');
            await recent.waitFor({ state: 'hidden' });
            await page.reload({ waitUntil: 'networkidle' });
            await trigger.waitFor();
            assert.match(await trigger.innerText(), /1/);
            // Insert one no-longer-listed snapshot in this disposable browser only.
            await page.evaluate(key => {
                const records = JSON.parse(localStorage.getItem(key) || '[]');
                const absent = JSON.parse(JSON.stringify(records[0]));
                absent.flight.id = 'missing-test-record'; absent.flight.departure.airport = 'XXX';
                localStorage.setItem(key, JSON.stringify([...records, absent]));
            }, key);
            await page.reload({ waitUntil: 'networkidle' });
            await trigger.click();
            await recent.waitFor();
            assert.equal(await recent.locator('button:disabled').count(), 1);
            await recent.getByText('판매 종료 여부는 단정할 수 없어요.', { exact: true }).waitFor();
            const secondTab = await context.newPage();
            await secondTab.goto(base, { waitUntil: 'networkidle' });
            await secondTab.getByRole('button', { name: /^최근 본 표 2/ }).waitFor();
            await recent.getByRole('button', { name: '기록 비우기' }).click();
            await recent.getByText('아직 본 표가 없어요', { exact: true }).waitFor();
            await page.keyboard.press('Escape');
            await recent.waitFor({ state: 'hidden' });
            assert.equal(await trigger.count(), 0);
            await secondTab.getByRole('button', { name: /^최근 본 표 \d+/ }).waitFor({ state: 'hidden' });
            assert.deepEqual(errors, []);
            console.log('PASS ' + width + 'px: real feed, retained count/time, recent beside sort, view/back/persist/clear, unavailable, focus, no errors');
            await context.close();
        }
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
