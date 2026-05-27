import { chromium } from 'playwright';
import fs from 'fs';

/**
 * offers.k1 페이지의 모든 API 호출을 캡처하여 실제 검색 결과 가격을 추출합니다.
 */
async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const gidMap = JSON.parse(fs.readFileSync('data/gid-map.json', 'utf8'));
    
    // 난닝 테스트 - 유저가 476,600원을 확인한 노선
    const gid = gidMap['NNG'];
    const url = `https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=${gid}&depdt=2026-06-05&arrdt=2026-06-08&cabin=Y&adult=1&child=0&infant=0`;
    
    console.log('🔍 난닝 검색 페이지 로드...');
    console.log('URL:', url);
    
    // 모든 XHR/fetch 응답 캡처
    const apiCalls: { url: string; method: string; body: string }[] = [];
    page.on('response', async (response: any) => {
        const resUrl = response.url();
        if (resUrl.includes('api3') || resUrl.includes('api.') || resUrl.includes('/air/')) {
            if (!resUrl.endsWith('.css') && !resUrl.endsWith('.js') && !resUrl.endsWith('.png') && !resUrl.endsWith('.jpg')) {
                try {
                    const body = await response.text();
                    if (body.length > 50) {
                        apiCalls.push({ url: resUrl.substring(0, 150), method: response.request().method(), body: body.substring(0, 500) });
                    }
                } catch {}
            }
        }
    });
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(12000);
    
    // 스크린샷
    await page.screenshot({ path: 'scripts/nanning-page.png', fullPage: false });
    console.log('📸 스크린샷: scripts/nanning-page.png');
    
    // 캡처된 API
    console.log(`\n📡 캡처된 API 호출: ${apiCalls.length}개`);
    apiCalls.forEach((c, i) => {
        console.log(`\n[${i}] ${c.method} ${c.url}`);
        console.log(`    ${c.body.substring(0, 300)}`);
    });
    
    // 페이지에서 "원" 포함 텍스트 전체 추출
    const priceTexts = await page.evaluate(() => {
        const results: string[] = [];
        document.querySelectorAll('*').forEach(el => {
            const t = (el as HTMLElement).innerText?.trim() || '';
            if (t.match(/[\d,]+원/) && t.length < 50 && !results.includes(t)) {
                results.push(t);
            }
        });
        return results.slice(0, 30);
    });
    
    console.log('\n💰 "원" 포함 텍스트:');
    priceTexts.forEach(t => console.log('  ', t));
    
    await browser.close();
}

main().catch(console.error);
