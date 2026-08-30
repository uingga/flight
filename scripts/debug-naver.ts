/**
 * 네이버 항공권 디버그 스크립트
 * - 실제 페이지 스크린샷 촬영
 * - GraphQL 응답 캡처
 * - DOM 구조 확인
 */
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';

chromium.use(stealth());

const DATA_DIR = path.join(process.cwd(), 'data');

if (!['1', 'true'].includes(String(process.env.NAVER_LIVE_RUN || '').toLowerCase())) {
    throw new Error('실제 네이버 디버그 요청은 NAVER_LIVE_RUN=1을 명시해야 합니다.');
}

(async () => {
    console.log('🔍 네이버 항공권 디버그 시작...\n');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'ko-KR',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // GraphQL 응답 수집
    const graphqlResponses: any[] = [];
    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('airline-api.naver.com') || url.includes('flight.naver.com/api')) {
            try {
                const json = await response.json();
                graphqlResponses.push({ url, data: json });
                console.log(`  📡 API 응답: ${url.substring(0, 80)}...`);
            } catch { }
        }
    });

    // 테스트: ICN → NRT, 내일 출발 ~ 3일 후 귀국
    const today = new Date();
    const dep = new Date(today.getTime() + 7 * 86400000); // 7일 후
    const ret = new Date(today.getTime() + 10 * 86400000); // 10일 후
    const depStr = dep.toISOString().substring(0, 10).replace(/-/g, '');
    const retStr = ret.toISOString().substring(0, 10).replace(/-/g, '');

    const url = `https://flight.naver.com/flights/international/ICN-NRT-${depStr}/NRT-ICN-${retStr}?adult=1&isDirect&fareType=Y`;
    console.log(`🌐 URL: ${url}\n`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('⏳ 30초 대기 중...');
    await page.waitForTimeout(30000);

    // 스크린샷
    await page.screenshot({ path: path.join(DATA_DIR, 'debug-naver-screenshot.png'), fullPage: true });
    console.log('📸 스크린샷 저장됨: data/debug-naver-screenshot.png');

    // 페이지 HTML 일부
    const html = await page.content();
    fs.writeFileSync(path.join(DATA_DIR, 'debug-naver-page.html'), html, 'utf-8');
    console.log('📄 HTML 저장됨: data/debug-naver-page.html');

    // DOM에서 가격 관련 요소 검색
    const priceInfo = await page.evaluate(() => {
        const results: string[] = [];

        // 다양한 가격 셀렉터 시도
        const selectors = [
            '[class*="price"]',
            '[class*="fare"]',
            '[class*="Price"]',
            '[class*="Fare"]',
            '[data-testid*="price"]',
            '[class*="item_inner"]',
            '[class*="result"]',
            '[class*="airline"]',
            '[class*="concurrent"]',
        ];

        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
                results.push(`\n--- ${sel} (${els.length}개) ---`);
                els.forEach((el, i) => {
                    if (i < 3) {
                        const text = (el as HTMLElement).innerText?.substring(0, 100) || '';
                        results.push(`  [${i}] ${text}`);
                    }
                });
            }
        }

        // 전체 텍스트에서 "원" 포함 요소 검색
        const allEls = document.querySelectorAll('*');
        const priceEls: string[] = [];
        allEls.forEach(el => {
            const text = (el as HTMLElement).innerText || '';
            if (text.match(/\d{3,}원/) && text.length < 50) {
                priceEls.push(text.trim());
            }
        });
        if (priceEls.length > 0) {
            results.push(`\n--- "N원" 패턴 (${priceEls.length}개) ---`);
            [...new Set(priceEls)].slice(0, 10).forEach(t => results.push(`  ${t}`));
        }

        return results.join('\n');
    });

    console.log('\n📊 DOM 가격 정보:');
    console.log(priceInfo);

    // GraphQL 응답 저장
    if (graphqlResponses.length > 0) {
        fs.writeFileSync(
            path.join(DATA_DIR, 'debug-naver-api.json'),
            JSON.stringify(graphqlResponses, null, 2),
            'utf-8'
        );
        console.log(`\n📡 API 응답 ${graphqlResponses.length}건 저장됨: data/debug-naver-api.json`);
    } else {
        console.log('\n⚠️ API 응답이 캡처되지 않았습니다.');
    }

    await browser.close();
    console.log('\n✅ 디버그 완료!');
})();
