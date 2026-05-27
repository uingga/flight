const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    await page.goto('https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=20260410&adt=1&chd=0&inf=0&page=1&scale=200', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
    });
    
    await page.waitForSelector('li.exair1', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);
    
    // Get ALL data attributes from first li.exair1
    const attrs = await page.evaluate(() => {
        const li = document.querySelector('li.exair1');
        if (!li) return { error: 'no li.exair1 found' };
        const el = li as HTMLElement;
        const result: Record<string, string> = {};
        for (const attr of Array.from(el.attributes)) {
            if (attr.name.startsWith('data-')) {
                result[attr.name] = attr.value;
            }
        }
        // Also get inner HTML structure
        result['__innerHTML_snippet'] = el.innerHTML.substring(0, 500);
        return result;
    });
    
    console.log('===== TTANG DATA ATTRIBUTES =====');
    console.log(JSON.stringify(attrs, null, 2));
    
    await browser.close();
})();
