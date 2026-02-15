import { chromium } from 'playwright';

async function quickTest() {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        viewport: { width: 390, height: 844 },
    });
    const page = await ctx.newPage();

    const url = 'https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=20260220&adt=1&chd=0&inf=0&page=1&scale=20';
    console.log('Loading:', url);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('DOM loaded, waiting for li.exair1...');

    await page.waitForSelector('li.exair1', { timeout: 10000 }).catch(() => console.log('waitForSelector timed out'));

    const result = await page.evaluate(() => {
        const items = document.querySelectorAll('li.exair1');
        const tabs = document.querySelectorAll('[id^="allttang_cal_"]');
        return {
            itemCount: items.length,
            tabCount: tabs.length,
            items: Array.from(items).slice(0, 3).map(li => {
                const el = li as HTMLElement;
                return {
                    airline: el.dataset.tktcardesc,
                    depCity: el.dataset.depcitydesc,
                    arrCity: el.dataset.arrcitydesc,
                    depDate: el.dataset.fromsupplydate,
                    arrDate: el.dataset.tosupplydate,
                    price: el.dataset.totalprice,
                    masterId: el.dataset.masterid,
                };
            }),
            tabTexts: Array.from(tabs).slice(0, 5).map(t => t.textContent?.trim()),
        };
    });

    console.log('Result:', JSON.stringify(result, null, 2));
    await browser.close();
}

quickTest();
