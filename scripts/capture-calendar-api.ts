import { chromium } from 'playwright';

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // 모든 API 요청의 헤더와 바디를 캡처
    page.on('request', async (request) => {
        const url = request.url();
        if (url.includes('calendar')) {
            console.log(`\n📤 REQUEST: ${request.method()} ${url}`);
            console.log('  Headers:', JSON.stringify(Object.fromEntries(
                Object.entries(request.headers()).filter(([k]) => !['user-agent','accept-encoding','accept-language','sec-'].some(p => k.startsWith(p)))
            )));
            if (request.postData()) console.log('  Body:', request.postData());
        }
    });

    page.on('response', async (response) => {
        if (response.url().includes('calendar')) {
            try {
                const body = await response.text();
                console.log(`\n📥 RESPONSE [${response.status()}]: ${response.url()}`);
                console.log('  Body:', body.substring(0, 300));
            } catch {}
        }
    });

    const testUrl = 'https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=3531274&depdt=2026-06-06&arrdt=2026-06-09&cabin=Y&adult=1&child=0&infant=0';
    await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    await browser.close();
    console.log('\n✅ 완료');
}
main().catch(console.error);
