import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:31848';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local preview only');
const key = 'flight-order-local-preview';
async function read() {
    const response = await fetch(base + '/api/admin-flight-order', { headers: { 'x-admin-key': key } });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.mode, 'preview');
    return result;
}
async function write(placements) {
    const data = await read();
    const response = await fetch(base + '/api/admin-flight-order', {
        method: 'PUT', headers: { 'x-admin-key': key, Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: data.order.revision, placements }),
    });
    assert.equal(response.status, 200);
}
const original = await read();
const browser = await chromium.launch({ headless: true });
fs.mkdirSync('tmp/flight-order-screenshots', { recursive: true });
try {
    for (const width of [1440, 390, 320]) {
        await write([]);
        const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 960, hasTouch: width < 960 });
        await context.addInitScript(() => localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2', 'dismissed'));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        await page.goto(base + '/preview/flight-order');
        const cards = page.locator('[data-order-card]:not([data-position="drop"])');
        await cards.first().waitFor();
        const target = cards.nth(width >= 960 ? 1 : 4);
        const targetId = await target.getAttribute('data-order-card');
        const targetKey = await target.getAttribute('data-order-key');
        const initialIds = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.orderCard));
        if (width >= 960) {
            await cards.first().evaluate(element => element.scrollIntoView({ block: 'start' }));
            await target.dragTo(cards.first(), { sourcePosition: { x: 40, y: 100 }, targetPosition: { x: 40, y: 150 } });
        }
        else {
            await target.getByRole('button', { name: /맨 위로/ }).click();
            await cards.first().getByRole('button', { name: /아래로/ }).click();
            assert.equal(await cards.nth(1).getAttribute('data-order-card'), targetId);
            await cards.nth(1).getByText('위로 ↑', { exact: true }).click();
        }
        assert.equal(await cards.first().getAttribute('data-order-card'), targetId);
        assert.deepEqual((await read()).order.placements, [], 'edit is not applied yet');
        const applyButton = page.getByRole('button', { name: '적용', exact: true });
        assert.ok(await applyButton.isDisabled(), 'preview is required before applying');
        await page.getByRole('button', { name: '미리보기', exact: true }).click();
        assert.equal(await cards.first().getAttribute('data-order-card'), targetId);
        assert.equal(await cards.first().getByRole('button').count(), 0);
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: `tmp/flight-order-screenshots/preview-${width}.png` });
        await applyButton.click();
        await page.getByRole('status').filter({ hasText: '격리된 미리보기에 적용했습니다' }).waitFor();
        await cards.first().waitFor();
        assert.deepEqual((await read()).order.placements, [{ key: targetKey, position: 1 }]);
        await page.reload();
        await cards.first().waitFor();
        assert.equal(await cards.first().getAttribute('data-order-card'), targetId, 'saved after page reload');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'editor horizontal overflow');
        await page.screenshot({ path: `tmp/flight-order-screenshots/editor-${width}.png` });
        const main = await context.newPage();
        await main.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        await main.goto(base);
        const publicCards = main.locator('article[data-flight-id]');
        await publicCards.first().waitFor();
        const savedData = await read();
        const offset = savedData.todayPickId ? 1 : 0;
        assert.equal(await publicCards.nth(offset).getAttribute('data-flight-id'), targetId, 'main uses saved manual position');
        const before = await publicCards.evaluateAll(nodes => nodes.map(node => node.dataset.flightId));
        await main.getByRole('button', { name: '특가 더 보기', exact: true }).click();
        const after = await publicCards.evaluateAll(nodes => nodes.map(node => node.dataset.flightId));
        assert.ok(after.length > before.length);
        assert.deepEqual(after.slice(0, before.length), before);
        assert.equal(new Set(after).size, after.length, 'no page overlap');
        await main.getByRole('button', { name: '항공권 정렬', exact: true }).click();
        await main.getByRole('button', { name: '낮은 가격순', exact: true }).click();
        const source = new Map(savedData.flights.map(flight => [flight.id, flight]));
        let sortedIds = await publicCards.evaluateAll(nodes => nodes.map(node => node.dataset.flightId));
        const prices = sortedIds.map(id => source.get(id).price + (source.get(id).source === 'ttang' ? 20000 : 0));
        assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'price order unchanged');
        await main.getByRole('button', { name: '항공권 정렬', exact: true }).click();
        await main.getByRole('button', { name: '빠른 출발순', exact: true }).click();
        sortedIds = await publicCards.evaluateAll(nodes => nodes.map(node => node.dataset.flightId));
        const dates = sortedIds.map(id => source.get(id).departure.date.replace(/\./g, '-').slice(0, 10));
        assert.deepEqual(dates, [...dates].sort(), 'date order unchanged');
        // Refresh price/ID/seats in a browser-only response fixture; never edit cache files.
        let refreshMode = 'updated';
        await main.route('**/api/flights?*', async route => {
            const response = await route.fetch();
            const payload = await response.json();
            payload.flights = refreshMode === 'updated'
                ? payload.flights.map(flight => flight.id === targetId ? { ...flight, id: 'preview-refreshed-id', price: 88000, availableSeats: 2, seats: '잔여 2석' } : flight)
                : payload.flights.filter(flight => flight.id !== targetId);
            await route.fulfill({ response, json: payload });
        });
        await main.goto(base);
        await publicCards.first().waitFor();
        assert.equal(await publicCards.nth(offset).getAttribute('data-flight-id'), 'preview-refreshed-id', 'cache refresh retains placement');
        assert.match(await publicCards.nth(offset).innerText(), /88,000|108,000/);
        assert.match(await publicCards.nth(offset).innerText(), /2석/);
        if (width >= 960) {
            const targetCity = source.get(targetId).arrival.city;
            const otherCity = savedData.flights.find(flight => flight.arrival.city !== targetCity).arrival.city.replace(/\([^)]+\)/g, '').trim();
            await main.getByRole('textbox', { name: '도시·항공사 검색', exact: true }).fill(otherCity);
            assert.equal(await main.locator('article[data-flight-id="preview-refreshed-id"]').count(), 0, 'city filter excludes manual flight');
        }
        refreshMode = 'hidden';
        await main.reload();
        await publicCards.first().waitFor();
        assert.equal(await main.locator(`article[data-flight-id="${targetId}"]`).count(), 0, 'filtered out manual flight never restored');
        await main.close();
        await page.getByRole('button', { name: '자동 추천순으로 복원', exact: true }).click();
        assert.deepEqual((await read()).order.placements, [{ key: targetKey, position: 1 }], 'restore also previews before save');
        assert.deepEqual(await cards.evaluateAll(nodes => nodes.map(node => node.dataset.orderCard)), initialIds);
        await applyButton.click();
        await page.getByRole('status').filter({ hasText: '격리된 미리보기에 적용했습니다' }).waitFor();
        assert.deepEqual((await read()).order.placements, []);
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}px: edit, preview, apply, reload, main feed, pagination, price/date sorting, hidden flight, restore, no overflow`);
        await context.close();
    }
} finally {
    await browser.close();
    await write(original.order.placements);
}
