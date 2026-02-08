
import { chromium } from 'playwright';
import fs from 'fs';

async function saveHtml() {
    console.log('Saving Online Tour HTML...');
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    try {
        const targetUrl = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=AS&SelectedCityCd=DAD&airSect=ICN';
        console.log(`Navigating to ${targetUrl}`);
        await page.goto(targetUrl, { timeout: 60000 });

        // Wait for list to appear
        try {
            await page.waitForSelector('.list_wrap', { timeout: 10000 });
            console.log('List wrapper found');
        } catch (e) {
            console.log('List wrapper not found immediately, waiting more...');
            await page.waitForTimeout(5000);
        }

        // Save FULL HTML
        const content = await page.content();
        fs.writeFileSync('debug_onlinetour_full.html', content);
        console.log(`Saved full HTML (${content.length} bytes) to debug_onlinetour_full.html`);

    } catch (e) {
        console.error('Save failed:', e);
    } finally {
        await browser.close();
    }
}

saveHtml();
