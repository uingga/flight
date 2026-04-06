import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    await page.goto('https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=20260410&adt=1&chd=0&inf=0&page=1&scale=200', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
    });
    
    await page.waitForSelector('li.exair1', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);
    
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
        result['__innerHTML'] = el.innerHTML.substring(0, 2000);
        return result;
    });
    
    fs.writeFileSync('/tmp/ttang-attrs.json', JSON.stringify(attrs, null, 2), 'utf8');
    console.log('Saved to /tmp/ttang-attrs.json');
    await browser.close();
})();
