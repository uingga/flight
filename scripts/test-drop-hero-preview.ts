import { chromium, type Page, type Route } from 'playwright';
import type { Flight } from '../src/types/flight';

const baseUrl = process.argv[2] || 'http://localhost:3002';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const [, month, day] = todayKst.split('-').map(Number);

const flights: Flight[] = [
    {
        id: 'drop-flight',
        source: 'ybtour',
        airline: '진에어',
        departure: { city: '인천(ICN)', airport: 'ICN', date: '2026-10-10', time: '08:20', arrivalTime: '09:45' },
        arrival: { city: '후쿠오카(FUK)', airport: 'FUK', date: '2026-10-13', time: '19:30', arrivalTime: '21:00' },
        price: 179_000,
        currency: 'KRW',
        link: 'https://example.com/drop-flight',
        availableSeats: 7,
        region: '일본',
    },
    {
        id: 'ordinary-flight-1',
        source: 'hanatour',
        airline: '에어서울',
        departure: { city: '인천(ICN)', airport: 'ICN', date: '2026-10-11', time: '09:00' },
        arrival: { city: '오사카(KIX)', airport: 'KIX', date: '2026-10-14', time: '17:00' },
        price: 189_000,
        currency: 'KRW',
        link: 'https://example.com/ordinary-flight-1',
        availableSeats: 8,
        region: '일본',
    },
    {
        id: 'ordinary-flight-2',
        source: 'onlinetour',
        airline: '제주항공',
        departure: { city: '김포(GMP)', airport: 'GMP', date: '2026-10-12', time: '10:00' },
        arrival: { city: '타이베이(TPE)', airport: 'TPE', date: '2026-10-15', time: '18:00' },
        price: 199_000,
        currency: 'KRW',
        link: 'https://example.com/ordinary-flight-2',
        availableSeats: 5,
        region: '중화권',
    },
];

function payload(withPick: boolean) {
    return {
        success: true,
        count: flights.length,
        flights,
        lastUpdated: new Date().toISOString(),
        todayPickId: withPick ? 'drop-flight' : null,
        todayPickDate: withPick ? todayKst : null,
        todayPickRepeatOverride: null,
        priceHistory: {},
        interparkPrices: {},
    };
}

async function fulfillPreviewFlights(route: Route, withPick: boolean) {
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload(withPick)),
    });
}

async function verifyHeroPreview(page: Page) {
    await page.route('**/api/preview-flights**', route => fulfillPreviewFlights(route, true));
    await page.goto(`${baseUrl}/preview/drop-hero`, { waitUntil: 'domcontentloaded' });

    const hero = page.locator('[data-drop-hero-flight-id="drop-flight"]');
    await hero.waitFor({ state: 'visible' });
    assert(await hero.getByText('TIKIT DROP', { exact: true }).count() === 1, 'TIKIT DROP 눈썹이 올바르지 않습니다.');
    assert(await hero.getByText(`${month}/${day}`, { exact: true }).count() === 1, 'DROP 날짜가 올바르지 않습니다.');
    assert(await hero.getByRole('heading', { name: '후쿠오카', exact: true }).count() === 1, '목적지가 제목으로 표시되지 않습니다.');
    assert(await hero.getByText('179,000원', { exact: true }).count() === 1, '가격이 표시되지 않습니다.');
    assert(await hero.getByText('현재 7석', { exact: true }).count() === 1, 'describeDropCard 근거 문장이 그대로 표시되지 않습니다.');
    assert(
        await hero.getByText('인천 출발 · 10.10(토) — 10.13(화) · 3박 4일', { exact: true }).count() === 1,
        '출발지·날짜·여정 정보가 올바르지 않습니다.',
    );
    assert(
        await hero.getByText('진에어 · 노랑풍선 · 7석 남음', { exact: true }).count() === 1,
        '항공사·판매처·좌석 정보가 올바르지 않습니다.',
    );
    assert(await hero.getByRole('button', { name: '항공권 상세 열기', exact: true }).count() === 1, '상세 열기 CTA가 하나가 아닙니다.');
    const backgroundImage = await hero.evaluate(element => getComputedStyle(element).backgroundImage);
    assert(backgroundImage.includes('/images/cities/fukuoka.png'), `후쿠오카 도시 사진이 적용되지 않았습니다: ${backgroundImage}`);
    assert(await page.locator('article[data-flight-id="drop-flight"]').count() === 0, '히어로 항공권이 일반 카드 목록에 중복 노출됩니다.');

    await hero.getByRole('button', { name: '항공권 상세 열기', exact: true }).click();
    await page.locator('[aria-label="항공권 상세"]').waitFor({ state: 'visible' });
}

async function verifyOtherPreviewIsUnchanged(page: Page) {
    await page.route('**/api/preview-flights**', route => fulfillPreviewFlights(route, true));
    await page.goto(`${baseUrl}/preview/mobile-redesign`, { waitUntil: 'domcontentloaded' });
    await page.locator('article[data-flight-id="drop-flight"]').waitFor({ state: 'visible' });
    assert(await page.locator('[data-drop-hero]').count() === 0, '기존 모바일 리디자인 미리보기에 DROP 히어로가 노출됩니다.');
    assert(await page.locator('article[data-flight-id="drop-flight"][data-tikit-drop="true"]').count() === 1, '기존 DROP 카드 표시가 바뀌었습니다.');
}

async function verifyProductionHomeIsUnchanged(page: Page) {
    await page.route('**/api/flights**', route => fulfillPreviewFlights(route, true));
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('article[data-flight-id="drop-flight"]').waitFor({ state: 'visible' });
    assert(await page.locator('[data-drop-hero]').count() === 0, '운영 메인에 DROP 히어로가 노출됩니다.');
    assert(await page.locator('article[data-flight-id="drop-flight"][data-tikit-drop="true"]').count() === 1, '운영 메인의 기존 DROP 카드 표시가 바뀌었습니다.');
}

async function verifyNoPickRendersNothing(page: Page) {
    await page.route('**/api/preview-flights**', route => fulfillPreviewFlights(route, false));
    await page.goto(`${baseUrl}/preview/drop-hero`, { waitUntil: 'domcontentloaded' });
    await page.locator('article[data-flight-id="ordinary-flight-1"]').waitFor({ state: 'visible' });
    assert(await page.locator('[data-drop-hero]').count() === 0, '선정 항공권이 없는데 DROP 히어로 대체 콘텐츠가 노출됩니다.');
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    try {
        await verifyHeroPreview(await browser.newPage({ viewport: { width: 390, height: 844 } }));
        await verifyOtherPreviewIsUnchanged(await browser.newPage({ viewport: { width: 390, height: 844 } }));
        await verifyProductionHomeIsUnchanged(await browser.newPage({ viewport: { width: 1440, height: 1000 } }));
        await verifyNoPickRendersNothing(await browser.newPage({ viewport: { width: 1440, height: 1000 } }));
        console.log('DROP 히어로 미리보기 확인 완료: hero/detail/dedup/opt-in/production/no-pick');
    } finally {
        await browser.close();
    }
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
