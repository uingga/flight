import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.argv[2] || 'http://127.0.0.1:31879';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Local test only');
const fixtures = ['구이린', '계림', '구이린시', '하노이'].map((city, index) => ({
    id: `city-label-${index}`, source: 'modetour', airline: '제주항공',
    departure: { city: '인천', airport: 'ICN', date: `2030-10-0${index + 1}`, time: '10:00' },
    arrival: { city, airport: index < 3 ? 'KWL' : 'HAN', date: `2030-10-0${index + 5}`, time: '15:00' },
    price: 305000 + index * 10000, currency: 'KRW', availableSeats: 4,
    region: index < 3 ? '중국' : '동남아', link: 'https://example.invalid/booking',
}));
const browser = await chromium.launch({ headless: true });
try {
    for (const width of [320, 390, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2', 'dismissed'));
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (url.pathname.startsWith('/api/')) return route.fulfill({ json:
                ['/api/flights', '/api/preview-flights'].includes(url.pathname)
                    ? { success: true, flights: fixtures, lastUpdated: new Date().toISOString() }
                    : { success: true },
            });
            return route.continue();
        });
        for (const term of ['계림', '구이린', '구이린시', 'KWL']) {
            await page.goto(`${origin}/preview/mobile-redesign?q=${encodeURIComponent(term)}`);
            await page.waitForFunction(() => document.querySelectorAll('article[data-flight-id]').length === 3);
            const cards = page.locator('article[data-flight-id]');
            for (const text of await cards.allTextContents()) {
                assert.ok(text.includes('계림'), text);
                assert.ok(!text.includes('구이린'), text);
            }
            await cards.first().getByRole('button').first().click();
            const title = page.getByRole('heading', { name: '인천 ↔ 계림(구이린)', exact: true });
            await title.waitFor();
            const dialog = page.getByRole('dialog', { name: '인천 ↔ 계림(구이린)' });
            assert.equal(await dialog.getByRole('link', { name: /모두투어에서 확인하기/ }).getAttribute('href'), fixtures[0].link);
            assert.ok(await dialog.getByText('계림(KWL)', { exact: true }).count() > 0);
            await dialog.getByRole('button', { name: '닫기', exact: true }).click();
            await title.waitFor({ state: 'hidden' });
        }
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}px: four search aliases, three source labels, detail heading, airport and booking link`);
        await page.close();
    }
} finally { await browser.close(); }
