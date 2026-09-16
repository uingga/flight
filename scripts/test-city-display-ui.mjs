import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.argv[2] || 'http://127.0.0.1:3514';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const groups = [
    ['상하이', 'PVG', ['상해(푸동공항)', '상하이(푸동)'], ['상해', '상하이']],
    ['마쓰야마', 'MYJ', ['마츠야마', '마쓰야마(MYJ)'], ['마츠야마', '마쓰야마']],
    ['다카마쓰', 'TAK', ['다카마츠', '다카마쓰'], ['다카마츠', '다카마쓰']],
    ['타이베이', 'TPE', ['타이페이', '타이베이'], ['타이페이', '타이베이']],
    ['성도', 'TFU', ['청두', '성도'], ['청두', '성도']],
    ['장가계', 'DYG', ['장자제', '장가계(다융)'], ['장자제', '장가계']],
];
const fixtures = groups.flatMap(([label, airport, aliases], group) => aliases.map((city, index) => ({
    id: `city-alias-${group}-${index}`, source: 'modetour', airline: '제주항공',
    departure: { city: '인천', airport: 'ICN', date: `2030-10-0${index + 1}`, time: '10:00' },
    arrival: { city, airport, date: `2030-10-0${index + 5}`, time: '15:00' },
    price: 305000 + index * 10000, currency: 'KRW', availableSeats: 4,
    region: '중국', link: 'https://example.invalid/booking',
})));
const browser = await chromium.launch();
try {
    for (const width of [390, 1440]) {
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
        for (const [label, airport, aliases, queries] of groups) {
            for (const query of queries) {
                await page.goto(`${origin}/preview/mobile-redesign?q=${encodeURIComponent(query)}`);
                await page.waitForFunction(() => document.querySelectorAll('article[data-flight-id]').length === 2);
                const cards = page.locator('article[data-flight-id]');
                for (const text of await cards.allTextContents()) assert.ok(text.includes(label), text);
                await cards.first().getByRole('button').first().click();
                const dialog = page.getByRole('dialog', { name: `인천 ↔ ${label}`, exact: true });
                await dialog.waitFor();
                assert.ok(await dialog.getByText(`${label}(${airport})`, { exact: true }).count() > 0);
                assert.equal(await dialog.getByRole('link', { name: /모두투어에서 확인하기/ }).getAttribute('href'), 'https://example.invalid/booking');
                await dialog.getByRole('button', { name: '닫기', exact: true }).click();
                await dialog.waitFor({ state: 'hidden' });
            }
        }
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}px: six city groups, both search spellings, cards, detail, unchanged airports/links`);
        await page.close();
    }
} finally { await browser.close(); }
