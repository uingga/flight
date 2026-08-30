import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
chromium.use(stealth());

if (!['1', 'true'].includes(String(process.env.NAVER_LIVE_RUN || '').toLowerCase())) {
    throw new Error('실제 네이버 진단은 NAVER_LIVE_RUN=1을 명시해야 합니다.');
}

/**
 * Xvfb(가상 디스플레이) 환경에서 headed 모드가 네이버 차단을 우회하는지 테스트
 */
(async () => {
    console.log('🧪 Xvfb 시뮬레이션 테스트...');
    console.log('DISPLAY:', process.env.DISPLAY || '(없음)');

    // headless: false 이지만 Xvfb가 있으면 화면 없이도 동작
    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });

    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'ko-KR',
    });
    const page = await ctx.newPage();

    let apiCount = 0;
    page.on('response', async (r) => {
        if (r.url().includes('flight-api.naver.com/graphql')) {
            apiCount++;
        }
    });

    await page.goto('https://flight.naver.com/flights/international/ICN-NRT-20260603/NRT-ICN-20260606?adult=1&isDirect&fareType=Y', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
    });

    console.log('⏳ 25초 대기...');
    await page.waitForTimeout(25000);

    const domPrice = await page.evaluate(() => {
        const els = document.querySelectorAll('[class*="item_num"]');
        const prices: number[] = [];
        els.forEach(el => {
            const text = (el as HTMLElement).innerText || '';
            const match = text.replace(/,/g, '').replace(/원/g, '').match(/(\d{4,})/);
            if (match) prices.push(parseInt(match[1]));
        });
        const valid = prices.filter(p => p > 10000);
        return valid.length > 0 ? Math.min(...valid) : null;
    });

    console.log(`\n📊 결과:`);
    console.log(`  API 응답: ${apiCount}건`);
    console.log(`  DOM 최저가: ${domPrice ? domPrice.toLocaleString() + '원' : '없음'}`);
    console.log(`  판정: ${(apiCount > 0 || domPrice) ? '✅ 성공!' : '❌ 실패 (차단됨)'}`);

    await browser.close();
})();
