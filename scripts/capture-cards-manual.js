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
    // rank_1: 서울 → 지난 12.9만
    { label: 'rank_1', departure: ['서울', '인천'], arrival: ['지난', '제남'], airline: '에어로케이' },
    // rank_2: 청주 → 칭다오 14.3만
    { label: 'rank_2', departure: '청주', arrival: ['칭다오', '청도'], airline: '에어로케이' },
    // rank_3: 부산 → 오사카 15.3만
    { label: 'rank_3', departure: '부산', arrival: ['오사카', '간사이'], airline: '이스타항공' },
    // icn_1: 인천 → 오키나와
    { label: 'icn_1', departure: ['인천', '서울'], arrival: '오키나와' },
    // icn_2: 인천 → 괌
    { label: 'icn_2', departure: ['인천', '서울'], arrival: '괌' },
    // icn_3: 인천 → 타이베이
    { label: 'icn_3', departure: ['인천', '서울'], arrival: ['타이페이', '타이베이'] },
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
    // 프로덕션 API에서 최신 데이터 가져오기
    try {
        console.log('🌐 프로덕션 API에서 최신 데이터 가져오는 중...');
        const res = await fetch('https://tikitikit.kr/api/flights');
        const freshData = await res.json();
        if (freshData.flights?.length > 0) {
            fs.writeFileSync(DATA_PATH, JSON.stringify(freshData, null, 2));
            console.log(`✅ 캐시 업데이트 완료: ${freshData.flights.length}개 항공편`);
        }
    } catch (e) {
        console.warn('⚠️ API 접속 실패, 기존 캐시 사용:', e.message);
    }

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
