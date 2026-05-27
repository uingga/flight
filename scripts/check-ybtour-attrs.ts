import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        viewport: { width: 1920, height: 8000 },
    });
    const page = await context.newPage();
    
    await page.goto('https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
    });
    
    await page.waitForSelector('table tbody', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);
    
    // Click first city to load schedule data
    const cityBtn = page.locator('#cityCode_FUK a');
    if (await cityBtn.isVisible()) {
        await cityBtn.click();
        await page.waitForTimeout(3000);
    }
    
    // Click search button on first row
    const searchBtn = await page.$('a[onclick*="listActive"]');
    if (searchBtn) {
        await searchBtn.click();
        await page.waitForTimeout(3000);
    }
    
    // Get table structure  
    const tableHtml = await page.evaluate(() => {
        // Get main row cells
        const mainRow = document.querySelector('table tbody tr');
        if (!mainRow) return { error: 'no row found' };
        const cells = mainRow.querySelectorAll('td');
        const cellTexts = Array.from(cells).map((c, i) => `td[${i}]: ${c.textContent?.trim()}`);
        
        // Get schedule row (td.link)
        const linkTd = document.querySelector('td.link');
        const linkHtml = linkTd ? linkTd.innerHTML.substring(0, 1500) : 'no td.link';
        
        // Check for hidden inputs
        const inputs = document.querySelectorAll('td.link input[type="hidden"]');
        const inputNames = Array.from(inputs).slice(0, 20).map(inp => {
            const el = inp as HTMLInputElement;
            return `${el.id || el.name}: ${el.value}`;
        });
        
        return { cellTexts, linkHtml, inputNames };
    });
    
    fs.writeFileSync('/tmp/ybtour-structure.json', JSON.stringify(tableHtml, null, 2), 'utf8');
    console.log('Saved to /tmp/ybtour-structure.json');
    await browser.close();
})();
