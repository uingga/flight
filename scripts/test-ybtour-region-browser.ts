import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { selectYbtourRegion } from '../src/lib/scrapers/ybtour-region';
import { IncompleteScrapeError } from '../src/lib/scrapers/scrape-errors';
import { classifySourceAccessRestriction } from '../src/lib/source-circuit';

// All responses are fixtures; no agency requests leave this browser.
test('region transitions correlate new CITY responses and wait for the matching DOM', { timeout: 30_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        let status = 200; let responseCity = 'DAD'; let delay = 0; let responseBody: string | undefined;
        let requests = 0;
        await page.route('**/*', async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({ body: '<a id="bannerCode_J1" class="on">Japan</a><a id="bannerCode_A0/A3">Asia</a><a id="bannerCode_P1">Guam</a><div id="div_citylist"><ul class="ctab_list"><li id="cityCode_NRT"><a>NRT</a></li></ul></div>' });
                return;
            }
            requests++;
            const body = responseBody ?? `<li id="cityCode_${responseCity}"><a>${responseCity}</a></li>`;
            await new Promise(resolve => setTimeout(resolve, delay));
            await route.fulfill({ status, contentType: 'text/html', body });
        });
        const reset = () => page.goto('https://fly.ybtour.co.kr/booking/findDiscountAir.lts');
        const click = (region: string, render = true) => async () => {
            await page.evaluate(({ region, render }) => {
                document.querySelectorAll('[id^="bannerCode_"]').forEach(el => el.classList.toggle('on', el.id === 'bannerCode_'+region));
                void fetch('/booking/findDiscountAir.lts', { method: 'POST', body: new URLSearchParams({ svcTpCode: 'CITY', efcBannerCode: region }) })
                    .then(r => r.text()).then(html => { if (render) document.querySelector('.ctab_list')!.innerHTML = html; });
            }, { region, render });
        };
        await reset();
        assert.equal((await selectYbtourRegion(page, 'bannerCode_J1', ['NRT'], async () => assert.fail('no active-tab click')))[0].code, 'NRT');
        assert.equal(requests, 0);
        await page.evaluate(() => {
            document.getElementById('bannerCode_J1')!.className = '';
            (window as unknown as { selEfcBannerCode: string }).selEfcBannerCode = 'J1';
        });
        assert.equal((await selectYbtourRegion(page, 'bannerCode_J1', ['NRT'], async () => assert.fail('active internal state sends no request')))[0].code, 'NRT');
        assert.equal(requests, 0);
        await reset();
        delay = 3200;
        assert.equal((await selectYbtourRegion(page, 'bannerCode_A0/A3', ['DAD'], click('A0/A3'), 5000))[0].code, 'DAD');
        assert.equal(requests, 1, 'slow response must not trigger reloads/retries');

        delay = 0; responseCity = 'GUM';
        await assert.rejects(selectYbtourRegion(page, 'bannerCode_P1', ['GUM'], click('P1', false), 200), IncompleteScrapeError);
        await reset();
        await assert.rejects(selectYbtourRegion(page, 'bannerCode_P1', ['GUM'], click('A0/A3'), 200), IncompleteScrapeError);

        // A previous request for the same region cannot satisfy a new transition.
        await reset(); delay = 100;
        const oldRequest = page.waitForRequest(r => r.method() === 'POST');
        await click('P1')(); await oldRequest;
        await page.locator('[id="bannerCode_P1"]').evaluate(el => el.classList.remove('on'));
        await assert.rejects(selectYbtourRegion(page, 'bannerCode_P1', ['GUM'], async () => {}, 300), IncompleteScrapeError);

        delay = 0;
        for (const httpStatus of [403, 429]) {
            await reset(); status = httpStatus;
            await assert.rejects(selectYbtourRegion(page, 'bannerCode_P1', ['GUM'], click('P1'), 500), e => {
                assert.equal(classifySourceAccessRestriction(e)?.reason, httpStatus === 429 ? 'rate_limited' : 'blocked'); return true;
            });
        }
        status = 200; responseBody = 'CAPTCHA'; await reset();
        await assert.rejects(selectYbtourRegion(page, 'bannerCode_P1', ['GUM'], click('P1'), 500), e => {
            assert.equal(classifySourceAccessRestriction(e)?.reason, 'blocked'); return true;
        });
        responseBody = '<div>empty</div>'; await reset();
        await assert.rejects(selectYbtourRegion(page, 'bannerCode_P1', ['GUM'], click('P1'), 500), IncompleteScrapeError);
    } finally { await browser.close(); }
});
