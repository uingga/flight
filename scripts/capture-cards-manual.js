/**
 * capture-cards-manual.js
 * 수동으로 선택한 항공편의 카드 스크린샷을 캡처합니다.
 * generate-blog.js의 captureCardScreenshots와 동일한 방식 (Playwright API mock).
 * 
 * 사용법: node scripts/capture-cards-manual.js
 * 주의: localhost:3000이 실행 중이어야 합니다.
 */

const path = require('path');
const fs = require('fs');

const CARDS_DIR = path.join(__dirname, '..', 'public', 'blog-cards');
const DATA_PATH = path.join(__dirname, '..', 'data', 'all-flights-cache.json');

// ===== 수동 선택 항공편 (여기를 수정) =====
const MANUAL_CARDS = [
    // rank_1: 부산 → 시즈오카
    { label: 'rank_1', departure: '부산', arrival: '시즈오카', airline: '에어부산' },
    // rank_2: 부산 → 후쿠오카
    { label: 'rank_2', departure: '부산', arrival: '후쿠오카', airline: '제주항공' },
    // rank_3: 인천/서울 → 상해(상하이)
    { label: 'rank_3', departure: ['인천', '서울'], arrival: ['상해', '상하이'], airline: '중국남방항공' },
    // icn_1: 인천 → 괌
    { label: 'icn_1', departure: ['인천', '서울'], arrival: '괌' },
    // icn_2: 인천 → 푸켓
    { label: 'icn_2', departure: ['인천', '서울'], arrival: '푸켓' },
];

function findFlight(flights, spec) {
    const depList = Array.isArray(spec.departure) ? spec.departure : [spec.departure];
    const arrList = Array.isArray(spec.arrival) ? spec.arrival : [spec.arrival];

    return flights
        .filter(f => f.price > 0)
        .filter(f => depList.some(d => (f.departure?.city || '').includes(d)))
        .filter(f => arrList.some(a => (f.arrival?.city || '').includes(a)))
        .filter(f => !spec.airline || (f.airline || '').includes(spec.airline))
        .sort((a, b) => a.price - b.price)[0];
}

async function main() {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    const flights = data.flights || [];
    console.log(`📦 ${flights.length}개 항공편 로드`);

    if (!fs.existsSync(CARDS_DIR)) {
        fs.mkdirSync(CARDS_DIR, { recursive: true });
    }

    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const localUrl = 'http://localhost:3000';

    for (const spec of MANUAL_CARDS) {
        const flight = findFlight(flights, spec);
        if (!flight) {
            console.warn(`  ⚠️ ${spec.label}: 항공편을 찾을 수 없습니다.`);
            continue;
        }
        console.log(`  📸 ${spec.label}: ${flight.departure?.city} → ${flight.arrival?.city} | ${flight.airline} | ${flight.price.toLocaleString()}원`);

        const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
        try {
            await page.route('**/api/flights*', async route => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        flights: [flight],
                        lastUpdated: new Date().toISOString()
                    })
                });
            });

            await page.goto(localUrl, { waitUntil: 'networkidle', timeout: 20000 });
            await page.waitForTimeout(1500);

            // 날짜 필터 해제
            try {
                const dateTag = page.locator('span:has-text("~") button');
                if (await dateTag.first().isVisible({ timeout: 2000 }).catch(() => false)) {
                    await dateTag.first().click();
                    await page.waitForTimeout(500);
                }
            } catch (e) { }

            // 출발지 필터 해제 → '전체'
            try {
                const allChip = page.locator('button').filter({ hasText: '전체' }).first();
                if (await allChip.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await allChip.click();
                    await page.waitForTimeout(1000);
                }
            } catch (e) { }

            const cardLocator = page.locator('.card').first();
            await cardLocator.waitFor({ state: 'visible', timeout: 10000 });

            const savePath = path.join(CARDS_DIR, `${spec.label}.png`);
            await cardLocator.screenshot({ path: savePath });
            console.log(`    ✅ ${spec.label}.png 저장 완료`);
        } catch (e) {
            console.error(`    ❌ ${spec.label} 캡처 실패:`, e.message?.split('\n')[0]);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    console.log('📸 카드 스크린샷 완료');
}

main().catch(err => {
    console.error('❌ 오류:', err);
    process.exit(1);
});
