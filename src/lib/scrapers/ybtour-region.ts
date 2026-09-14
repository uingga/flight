import type { Page, Request, Response } from 'playwright';
import { IncompleteScrapeError } from './scrape-errors';
import { assertNoSourceAccessBlockText, SourceResponseError } from './source-response';

/** Match the response to this click, then require the DOM to contain that response's cities. */
export async function selectYbtourRegion(
    page: Page, tabId: string, knownCities: string[], click: () => Promise<void>, timeout = 20_000,
): Promise<{ code: string; name: string }[]> {
    const code = tabId.replace('bannerCode_', '');
    const selector = '#div_citylist ul.ctab_list li[id^="cityCode_"]';
    const readCities = () => page.$$eval(selector, items => items.map(li => ({
        code: li.id.replace('cityCode_', ''), name: li.querySelector('a')?.textContent?.trim() || '',
    })));
    const check = async () => assertNoSourceAccessBlockText('노랑풍선 지역 전환', await page.locator('body').innerText(), page.url());
    await check();
    const alreadySelected = await page.locator(`[id="${tabId}"]`).evaluate(el => el.classList.contains('on'));
    let expected: string[];
    if (alreadySelected) {
        // Initial landing is already on Japan. Clicking the active tab sends no request.
        expected = (await readCities()).map(city => city.code);
        if (!expected.some(city => knownCities.includes(city))) {
            throw new IncompleteScrapeError('노랑풍선 초기 지역 목록 확인 실패', [tabId]);
        }
    } else {
        const started = new Set<Request>();
        const onRequest = (request: Request) => { started.add(request); };
        page.on('request', onRequest);
        const responsePromise = page.waitForResponse(response => {
            const request = response.request();
            const url = new URL(response.url());
            const params = new URLSearchParams(request.postData() || '');
            return started.has(request) && url.origin === 'https://fly.ybtour.co.kr'
                && url.pathname === '/booking/findDiscountAir.lts' && request.method() === 'POST'
                && params.get('svcTpCode') === 'CITY' && params.get('efcBannerCode') === code;
        }, { timeout }).then(response => ({ response }), error => ({ error }));
        let result;
        try {
            await click();
            result = await responsePromise;
        } finally {
            page.off('request', onRequest);
        }
        await check();
        if (!('response' in result)) throw new IncompleteScrapeError('노랑풍선 요청한 지역 응답 대기 실패', [tabId]);
        const response: Response = result.response;
        if (!response.ok()) throw new SourceResponseError('http-status', `노랑풍선 지역 응답 HTTP ${response.status()}`,
            response.status(), response.headers()['content-type'] || '', undefined, response.url());
        let timer: ReturnType<typeof setTimeout> | undefined;
        let body: string;
        try {
            body = await Promise.race([
                response.text(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new IncompleteScrapeError('노랑풍선 지역 응답 본문 대기 실패', [tabId])), timeout);
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
        assertNoSourceAccessBlockText('노랑풍선 지역 응답', body, response.url());
        expected = Array.from(new Set(Array.from(body.matchAll(/\bid=["']cityCode_([^"']+)["']/g), match => match[1]))).sort();
        if (!expected.length) throw new IncompleteScrapeError('노랑풍선 지역 응답에 도시 목록 없음', [tabId]);
    }
    try {
        await page.waitForFunction(({ tabId, expected, selector }) => {
            const selected = document.getElementById(tabId)?.classList.contains('on');
            const mask = Array.from(document.querySelectorAll('.dimBox.bg')).some(el =>
                el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
            const items = Array.from(document.querySelectorAll(selector));
            const cities = items.map(li => li.id.replace('cityCode_', '')).sort();
            return selected && !mask && items.every(el => el.getClientRects().length > 0)
                && JSON.stringify(cities) === JSON.stringify([...expected].sort());
        }, { tabId, expected, selector }, { timeout });
        await check();
        return await readCities();
    } catch (error) {
        await check();
        throw new IncompleteScrapeError('노랑풍선 지역 응답과 화면 목록 불일치 — 다음 지역으로 진행하지 않음', [tabId]);
    }
}
