import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        extraHTTPHeaders: {
            'Referer': 'https://www.google.com/',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
    });
    const page = await context.newPage();

    // 모든 API 응답을 가로채서 fareId가 있는 데이터를 찾기
    const interceptedApis: string[] = [];
    let fareApiResponse: any = null;

    page.on('response', async (response) => {
        const url = response.url();
        // 항공 관련 API를 모두 캡처
        if (url.includes('/api/') || url.includes('fare') || url.includes('air') || url.includes('flight')) {
            try {
                const contentType = response.headers()['content-type'] || '';
                if (contentType.includes('json')) {
                    const text = await response.text();
                    interceptedApis.push(`${response.status()} ${url.substring(0, 100)}`);
                    if (text.includes('fareId')) {
                        fareApiResponse = JSON.parse(text);
                        console.log('✅ FOUND fareId in API:', url.substring(0, 120));
                    }
                }
            } catch { }
        }
    });

    console.log('Loading hanatour page...');
    await page.goto('https://www.hanatour.com/trp/air/CHPC0AIR0233M200', {
        waitUntil: 'networkidle',
        timeout: 30000,
    });
    await page.waitForTimeout(5000);

    console.log('\n=== Intercepted APIs ===');
    interceptedApis.forEach(api => console.log(' ', api));

    if (fareApiResponse) {
        // fareId가 있는 API 응답 분석
        const keys = Object.keys(fareApiResponse);
        console.log('\nFare API keys:', keys.join(', '));

        // 데이터 배열 찾기
        for (const key of keys) {
            const val = fareApiResponse[key];
            if (Array.isArray(val) && val.length > 0 && val[0].fareId) {
                console.log(`\n${key}: ${val.length} items`);
                console.log('Sample:', JSON.stringify(val[0], null, 2).substring(0, 500));
                break;
            }
        }
    } else {
        console.log('\n❌ No fareId found in any API response');

        // Vue.js로 시도
        const vueResult = await page.evaluate(() => {
            let result = { vueFound: false, fareLstFound: false, count: 0, sample: null as any };
            const allElements = Array.from(document.querySelectorAll('*'));
            for (const el of allElements) {
                const vue = (el as any).__vue__;
                if (vue) {
                    result.vueFound = true;
                    if (vue.$data && Array.isArray(vue.$data.farLst) && vue.$data.farLst.length > 0) {
                        result.fareLstFound = true;
                        result.count = vue.$data.farLst.length;
                        result.sample = {
                            fareId: vue.$data.farLst[0].fareId?.substring(0, 40),
                            keys: Object.keys(vue.$data.farLst[0]).join(', ')
                        };
                        break;
                    }
                }
            }
            return result;
        });
        console.log('\nVue.js fallback:', JSON.stringify(vueResult, null, 2));
    }

    await browser.close();
})();
