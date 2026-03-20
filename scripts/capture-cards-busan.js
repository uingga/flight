/**
 * capture-cards-busan.js
 * 부산 출발 일본 TOP 5 항공권 카드 캡처
 * 사용법: node scripts/capture-cards-busan.js
 * 주의: localhost:3000이 실행 중이어야 합니다.
 */

const path = require('path');
const fs = require('fs');

const CARDS_DIR = path.join(__dirname, '..', 'public', 'blog-cards');
const DATA_PATH = path.join(__dirname, '..', 'data', 'all-flights-cache.json');

// ===== 부산 출발 일본 TOP 5 =====
const MANUAL_CARDS = [
    // 1위: 부산 → 오사카 15.3만
    { label: 'busan_jp_1', departure: '부산', arrival: ['오사카', '간사이'], airline: '이스타항공' },
    // 2위: 부산 → 시즈오카 16만
    { label: 'busan_jp_2', departure: '부산', arrival: '시즈오카', airline: '에어부산' },
    // 3위: 부산 → 구마모토 16.2만
    { label: 'busan_jp_3', departure: '부산', arrival: '구마모토', airline: '이스타항공' },
    // 4위: 부산 → 후쿠오카 16.3만
    { label: 'busan_jp_4', departure: '부산', arrival: '후쿠오카', airline: '제주항공' },
    // 5위: 부산 → 도쿄 22만
    { label: 'busan_jp_5', departure: '부산', arrival: ['도쿄', 'NRT'], airline: '진에어' },
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
    console.log('📸 부산 특집 카드 캡처 완료!');
}

main().catch(err => {
    console.error('❌ 오류:', err);
    process.exit(1);
});
