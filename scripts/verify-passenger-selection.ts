import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://127.0.0.1:3108';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local QA only');
const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const flights = ['ybtour', 'hanatour', 'modetour'].map((source, index) => ({
    id: `passenger-test-${index}`, source, airline: '제주항공',
    departure: { city: '인천', airport: 'ICN', date: date(10 + index), time: '10:00' },
    arrival: { city: ['후쿠오카', '오사카', '도쿄'][index], airport: ['FUK', 'KIX', 'NRT'][index], date: date(13 + index), time: '18:00' },
    price: 150000 + index * 10000, currency: 'KRW', minPax: 2,
    link: source === 'hanatour' ? 'https://www.hanatour.com/com/pmt/CHPC0PMT0011M200?fareId=TEST' : `https://${source}.example/test`,
}));
async function main() {
const browser = await chromium.launch({ headless: true });
try {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
    await context.addInitScript(() => localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2', 'dismissed'));
    await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/api/preview-flights') return route.fulfill({ json: { success: true, flights, lastUpdated: new Date().toISOString() } });
        if (url.origin !== new URL(base).origin || url.pathname.startsWith('/api/')) {
            return route.fulfill({ contentType: request.resourceType() === 'script' ? 'application/javascript' : 'application/json', body: request.resourceType() === 'script' ? '' : '{}' });
        }
        return route.continue();
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const detail = page.locator('[role="dialog"][aria-label="항공권 상세"]');
    const picker = detail.locator('details').filter({ hasText: '탑승 인원' });
    const summary = picker.locator('summary');
    const open = async (index: number) => {
        await page.locator(`article[data-flight-id="passenger-test-${index}"]`).locator('button').first().click();
        await detail.waitFor();
    };
    const expectCount = async (adult: number) => {
        await page.waitForFunction(n => {
            const summary = [...document.querySelectorAll('[aria-label="항공권 상세"] summary')].find(el => el.textContent?.includes('탑승 인원'));
            return summary?.textContent?.includes(`성인 ${n}명`);
        }, adult);
    };
    const close = async () => { await page.keyboard.press('Escape'); await detail.waitFor({ state: 'hidden' }); };
    await page.goto(`${base}/preview/mobile-redesign`);
    await open(0);
    await expectCount(1);
    assert.equal(await picker.getAttribute('open'), null);
    const link = detail.getByRole('link', { name: /노랑풍선에서 확인하기/ });
    assert.equal(new URL((await link.getAttribute('href'))!).searchParams.get('adt'), '1');
    await page.waitForTimeout(600);
    await mkdir('output/passenger-selection', { recursive: true });
    await page.screenshot({ path: 'output/passenger-selection/collapsed-320.png' });
    await summary.click();
    await detail.getByRole('button', { name: '성인 한 명 늘리기', exact: true }).click();
    await expectCount(2);
    await close();
    await open(1);
    await expectCount(2);
    assert.equal(await picker.getAttribute('open'), null);
    const hanaLink = new URL((await detail.getByRole('link', { name: /하나투어에서 확인하기/ }).getAttribute('href'))!, base);
    const hanaTarget = new URL(hanaLink.searchParams.get('url')!);
    assert.equal(JSON.parse(hanaTarget.searchParams.get('searchCond')!).psngrCntLst[0].psngrCnt, 2);
    await page.goBack();
    await detail.waitFor({ state: 'hidden' });
    await page.goForward();
    await expectCount(2);
    await page.reload();
    await expectCount(2);
    await close();
    await open(2);
    await detail.getByText('여행사 예약 화면에서 선택해요', { exact: true }).waitFor();
    assert.equal(await picker.count(), 0);
    await close();
    await open(0);
    await expectCount(2);
    await summary.click();
    await detail.getByRole('button', { name: '성인 한 명 줄이기', exact: true }).click();
    await expectCount(1);
    assert(await detail.getByRole('button', { name: '성인 한 명 줄이기', exact: true }).isDisabled());
    assert.equal(new URL((await link.getAttribute('href'))!).searchParams.get('adt'), '1');
    await detail.getByRole('button', { name: '유아 한 명 늘리기', exact: true }).click();
    assert(await detail.getByRole('button', { name: '유아 한 명 늘리기', exact: true }).isDisabled());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('PASS: default 1, collapsed picker, selected 2 across flights/history/reload/unsupported source, decrease to 1 despite minPax 2, matching booking URLs, infant bounds, no mobile overflow or page errors');
} finally {
    await browser.close();
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
