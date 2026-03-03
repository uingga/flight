/**
 * capture-thumb.js
 * 
 * 블로그 썸네일 HTML을 Playwright로 캡처합니다.
 * generate-blog.js 실행 후 수동으로 실행하세요.
 * 
 * 사용법:
 *   node scripts/capture-thumb.js 260303
 *   node scripts/capture-thumb.js          # 오늘 날짜 자동
 * 
 * 요구사항:
 *   - npm install playwright
 *   - localhost:3333 (또는 다른 포트)에서 public 서빙 중
 * 
 * 출력:
 *   public/images/blog-thumb-{날짜}-wide.png   (960×480, 블로그 헤더)
 *   public/images/blog-thumb-{날짜}-square.png  (800×800, 네이버 썸네일)
 */

const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const PORT = 3333;
const BASE_URL = `http://localhost:${PORT}`;

function getDateStr() {
    // 인자가 있으면 사용, 없으면 오늘 날짜 (YYMMDD)
    if (process.argv[2]) return process.argv[2];
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
}

async function isServerRunning(url) {
    return new Promise(resolve => {
        http.get(url, res => { resolve(true); res.resume(); })
            .on('error', () => resolve(false));
    });
}

(async () => {
    const dateStr = getDateStr();
    const thumbUrl = `${BASE_URL}/blog-thumbnail-${dateStr}`;

    console.log(`📸 썸네일 캡처 시작: ${thumbUrl}`);

    // 서버 확인
    if (!await isServerRunning(BASE_URL)) {
        console.error(`❌ ${BASE_URL} 서버가 실행 중이 아닙니다.`);
        console.error(`   npx -y serve public -p ${PORT} 으로 먼저 실행하세요.`);
        process.exit(1);
    }

    // 썸네일 HTML 존재 확인
    if (!await isServerRunning(thumbUrl)) {
        console.error(`❌ ${thumbUrl} 파일이 없습니다.`);
        process.exit(1);
    }

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });

    await page.goto(thumbUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000); // 폰트 + 이미지 로딩 대기

    const outDir = path.join(__dirname, '..', 'public', 'images');

    // 와이드 배너 캡처 (960×480)
    const wide = page.locator('#wide-banner');
    if (await wide.count() > 0) {
        const widePath = path.join(outDir, `blog-thumb-${dateStr}-wide.png`);
        await wide.screenshot({ path: widePath });
        console.log(`✅ 와이드 배너: images/blog-thumb-${dateStr}-wide.png`);
    } else {
        console.warn('⚠️ #wide-banner 요소를 찾을 수 없습니다.');
    }

    // 정사각 썸네일 캡처 (800×800)
    const square = page.locator('#square-thumb');
    if (await square.count() > 0) {
        const squarePath = path.join(outDir, `blog-thumb-${dateStr}-square.png`);
        await square.screenshot({ path: squarePath });
        console.log(`✅ 정사각 썸네일: images/blog-thumb-${dateStr}-square.png`);
    } else {
        console.warn('⚠️ #square-thumb 요소를 찾을 수 없습니다.');
    }

    await browser.close();
    console.log('📸 캡처 완료!');
})();
