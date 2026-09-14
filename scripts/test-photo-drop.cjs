const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
    const base = process.env.HERO_TEST_URL || 'http://127.0.0.1:3500';
    const cache = require('../data/all-flights-cache.json');
    const flights = [...new Map(cache.flights.map(flight => [flight.id, flight])).values()];
    const selected = flights.find(f => f.source === 'modetour' && f.arrival.airport === 'SGN');
    assert.ok(selected);
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0,10);
    const payload = { success: true, lastUpdated: new Date().toISOString(), todayPickId: selected.id, todayPickDate: today,
        flights: flights.map(f => ({ ...f, firstSeen: today })) };
    const browser = await chromium.launch();
    try {
        for (const width of [390, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 960 } });
            await page.route('**/api/preview-flights?**', route => route.fulfill({ json: payload }));
            await page.goto(base + '/preview/mobile-redesign');
            const hero = page.locator('[data-drop-hero]');
            await hero.waitFor();
            const selectedId = await hero.getAttribute('data-drop-hero-flight-id');
            const copy = await hero.locator('[class*="scheduleLink"]').innerText();
            assert.match(copy, /이 가격의 다른 일정/);
            const total = Number(copy.match(/일정 (\d+)개/)[1]) + 1;
            assert.ok(total > 1);
            assert.doesNotMatch(await hero.locator('[class*="journey"]').innerText(), /대표 일정/);
            assert.equal(await hero.locator('[class*="seats"]').count(), 0);
            await hero.locator('[class*="cardAction"]').click();
            await hero.waitFor({ state: 'hidden' });
            const cards = page.locator('article[data-flight-id]');
            assert.equal(await cards.count(), total);
            const ids = await cards.evaluateAll(nodes => nodes.map(el => el.dataset.flightId));
            assert.ok(ids.includes(selectedId));
            const group = payload.flights.filter(f => ids.includes(f.id));
            const latestDate = group.map(f => f.departure.date).sort().at(-1);
            assert.equal(group.find(f => f.id === selectedId).departure.date, latestDate);
            const dialog = page.locator('[role="dialog"][aria-label="항공권 상세"]');
            assert.equal(await dialog.count(), 0);
            await cards.first().locator('button[class*="cardBody"]').click();
            await dialog.waitFor();
            assert.equal(await cards.count(), total);
            await dialog.getByRole('button', { name: '닫기', exact: true }).click();
            await dialog.waitFor({ state: 'hidden' });
            assert.deepEqual(await cards.evaluateAll(nodes => nodes.map(el => el.dataset.flightId)), ids);
            await page.getByRole('button', { name: '전체 항공권', exact: false }).click();
            await hero.waitFor();
            console.log('PASS', width, total + ' schedules; detail close preserves list; back restores hero');
            await page.goForward();
            await hero.waitFor({ state: 'hidden' });
            assert.equal(await cards.count(), total);
            await cards.first().locator('button[class*="cardBody"]').click();
            await dialog.waitFor();
            await page.goBack();
            await dialog.waitFor({ state: 'hidden' });
            assert.equal(await cards.count(), total);
            await page.goBack();
            await hero.waitFor();
            await page.goForward();
            await hero.waitFor({ state: 'hidden' });
            assert.equal(await cards.count(), total);
            await page.reload();
            await page.getByText(new RegExp('TIKIT DROP.*일정 ' + total + '개')).waitFor();
            assert.equal(await cards.count(), total);
            await page.goBack();
            await hero.waitFor();
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await hero.locator('[class*="cardAction"]').click();
            await hero.waitFor({ state: 'hidden' });
            await page.goBack();
            await hero.waitFor();
            console.log('PASS', width, 'browser back/forward, refresh restoration and reduced motion');
            await page.close();
        }
        const single = await browser.newPage({ viewport: { width: 390, height: 960 } });
        await single.route('**/api/preview-flights?**', route => route.fulfill({
            json: { ...payload, flights: payload.flights.filter(f => f.id === payload.todayPickId) },
        }));
        await single.goto(base + '/preview/mobile-redesign');
        const hero = single.locator('[data-drop-hero]');
        await hero.waitFor();
        assert.equal(await hero.locator('[class*="scheduleLink"]').count(), 0);
        await hero.locator('[class*="cardAction"]').click();
        await single.locator('[role="dialog"][aria-label="항공권 상세"]').waitFor();
        console.log('PASS single schedule opens detail directly');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
