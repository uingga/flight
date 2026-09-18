import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import type { Flight } from '../src/types/flight';
import { rememberFlightOffers, recordFlightOfferNews } from '../src/lib/flight-offer-history.mjs';
import { priceDropDay, resolvePriceDrop } from '../src/lib/price-drop-insight';

const origin = process.env.INSIGHT_TEST_URL || 'http://127.0.0.1:31878';
const now = Date.now();
const today = priceDropDay(now);
const oldAt = new Date(now - 8 * 86400000).toISOString();
const at = new Date(now - 60000).toISOString();
const cities = [['CTS', '삿포로'], ['NRT', '도쿄'], ['KIX', '오사카'], ['FUK', '후쿠오카'], ['DAD', '다낭'], ['TPE', '타이베이']];
const sources: Flight['source'][] = ['ybtour', 'hanatour', 'modetour', 'ttang', 'myrealtrip', 'onlinetour'];
const oldFlights: Flight[] = Array.from({ length: 36 }, (_, index) => ({
    id: 'insight-fixture-' + index, source: sources[index % sources.length], airline: '진에어',
    flightNumber: `LJ${index + 1}/LJ${index + 101}`, price: 300000 + index * 1000,
    currency: 'KRW', link: 'https://example.invalid', availableSeats: 4,
    departure: { airport: 'PUS', city: '부산', date: priceDropDay(now + (30 + index) * 86400000), time: '10:00' },
    arrival: { airport: cities[index % 6][0], city: cities[index % 6][1],
        date: priceDropDay(now + (34 + index) * 86400000), time: '12:00' },
    firstSeen: priceDropDay(oldAt), priceCheckedAt: oldAt,
}));
const history = rememberFlightOffers({}, oldFlights, oldAt);
const returned: Flight[] = recordFlightOfferNews([], oldFlights.map((f, index) => ({ ...f,
    price: f.price - (index < 6 ? 10000 : 0), firstSeen: today, priceCheckedAt: at,
})), at, history);
const newFlight: Flight = { ...oldFlights[0], id: 'genuinely-new', flightNumber: 'LJ501/LJ502',
    firstSeen: today, priceCheckedAt: at, price: 280000 };

async function main() {
    const browser = await chromium.launch();
    try {
        for (const width of [390, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            let includeNew = false;
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.origin !== origin) return route.abort();
                if (url.pathname === '/api/flights' || url.pathname === '/api/preview-flights') {
                    return route.fulfill({ json: { success: true, flights: includeNew ? [...returned, newFlight] : returned,
                        lastUpdated: at, total: returned.length + Number(includeNew), priceHistory: {}, interparkPrices: {} } });
                }
                if (url.pathname === '/api/price-drop-flights') {
                    const records = returned.flatMap(f => { const result = resolvePriceDrop(f, '', [], now); return result ? [result] : []; });
                    return route.fulfill({ json: { available: true, historyAvailable: false, asOf: today, records } });
                }
                if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: false, enabled: false, available: false, records: [] } });
                return route.continue();
            });
            const open = async () => {
                await page.goto(origin + '/preview/mobile-redesign');
                await page.locator('article[data-flight-id]').first().waitFor();
                if (width < 960) {
                    const button = page.getByRole('button', { name: '특가 더 보기', exact: true });
                    if (await button.isVisible()) await button.click();
                }
                try { await page.locator('#price-drop-flights-insight').waitFor({ timeout: 8000 }); }
                catch (error) {
                    console.error({ width, articles: await page.locator('article[data-flight-id]').count(),
                        records: returned.flatMap(f => resolvePriceDrop(f, '', [], now) || []).length,
                        body: (await page.locator('body').innerText()).slice(-6500), errors });
                    throw error;
                }
            };
            await open();
            assert.equal(await page.locator('#fresh-flights-insight').count(), 0, 'No fallback to old returning listings');
            const priceBar = page.locator('#price-drop-flights-insight');
            assert.match(await priceBar.innerText(), /이전 확인가보다/);
            assert.match(await priceBar.innerText(), /1만원/);
            assert.match(await priceBar.innerText(), /총 6개/, 'Every source, including Ttang, remains visible');
            assert.doesNotMatch(await priceBar.innerText(), /어제보다/);
            const button = priceBar.locator(width < 960 ? 'button[class*="freshFlightsMobileTicket"]' : 'button[class*="freshFlightsTicket"]').first();
            await button.evaluate(element => (element as HTMLButtonElement).click());
            await page.locator('[role="dialog"][aria-label="항공권 상세"]').waitFor();
            includeNew = true;
            await open();
            const fresh = page.locator('#fresh-flights-insight');
            await fresh.waitFor();
            assert.match(await fresh.innerText(), /오늘/);
            assert.equal(await fresh.getAttribute('data-fresh-route-count'), '1');
            assert.deepEqual(errors, []);
            console.log(`PASS ${width}px: no old-discovery fallback; 10,000 won return shown with honest label; detail opens; one genuine new route`);
            await page.close();
        }
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
