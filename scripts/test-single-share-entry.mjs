import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = 'http://localhost:31915';
const browser = await chromium.launch({ headless: true });
try {
    for (const mode of ['single', 'multiple', 'expired', 'main']) {
        const context = await browser.newContext();
        await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        await context.addInitScript(() => localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2', 'dismissed'));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (mode === 'expired') await page.route('**/api/flights*', async route => {
            const response = await route.fetch();
            const data = await response.json();
            data.flights = data.flights.filter(f => f.id !== 'ttang-7C1501ICNCTS-G3-2026-09-20');
            await route.fulfill({ response, json: data });
        });
        const path = mode === 'main' ? '/' : mode === 'multiple' ? '/t/g-vietnam-260914' : '/t/g-cts-260915';
        await page.goto(base + path);
        await page.getByText('항공권 불러오는 중', {exact:true}).waitFor({state:'hidden'});
        const discovery = page.getByRole('region', {name:'다른 항공권 둘러보기'});
        if (mode === 'single') {
            await page.getByRole('link', {name:/에서 확인하기/}).waitFor();
            const more = page.locator('section[aria-label="다른 항공권 둘러보기"]').getByRole('button', {name:'안 살 거지만 더 보기',exact:true});
            await more.click();
            await page.waitForFunction(() => document.querySelectorAll('article[data-flight-id]').length > 1);
            await page.waitForTimeout(700);
            assert.equal(await page.getByRole('link', {name:/에서 확인하기/}).count(), 0);
            assert.equal(new URL(page.url()).searchParams.get('utm_content'), 'share_group_cts-260915');
            await page.locator('article[data-flight-id]').first().getByRole('button').first().click();
            await page.getByRole('link', {name:/에서 확인하기/}).waitFor();
            assert.equal(await discovery.count(), 0);
        } else if (mode === 'expired') {
            await page.getByText('아, 조금 늦었네요.', {exact:true}).waitFor();
            assert.equal(await page.getByRole('link', {name:/에서 확인하기/}).count(), 0);
        } else {
            await page.locator('article[data-flight-id]').first().waitFor();
            await page.waitForTimeout(700);
            assert.equal(await page.getByRole('link', {name:/에서 확인하기/}).count(), 0);
            if (mode === 'multiple') assert.ok(await page.locator('article[data-flight-id]').count() > 1);
        }
        assert.deepEqual(errors, []);
        console.log(`PASS ${mode}`);
        await context.close();
    }
} finally { await browser.close(); }
