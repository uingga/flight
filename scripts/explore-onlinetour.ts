
import { chromium } from 'playwright';
import fs from 'fs';

async function explore() {
    console.log('Exploring Online Tour...');
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    try {
        await page.goto('https://www.onlinetour.co.kr/', { timeout: 30000 });
        console.log('Main page loaded.');

        // Search for keywords
        const keywords = ['땡처리', '특가', '할인', '긴급'];
        const links = await page.evaluate((keywords) => {
            const results: any[] = [];
            document.querySelectorAll('a').forEach(a => {
                const text = a.textContent?.trim() || '';
                const href = a.href;
                if (keywords.some(k => text.includes(k))) {
                    results.push({ text, href });
                }
            });
            return results;
        }, keywords);

        console.log('Found potential links:', links);

        if (links.length > 0) {
            console.log('Trying to visit the first promising link...');
            // Filter for "flight" related if possible, or just "땡처리"
            const target = links.find(l => l.text.includes('땡처리')) || links[0];
            if (target) {
                console.log(`Navigating to ${target.href}`);
                await page.goto(target.href);
                await page.waitForTimeout(3000);
                console.log('Target page loaded. Saving HTML snippet...');
                const content = await page.content();
                fs.writeFileSync('debug_onlinetour_target.html', content.substring(0, 50000)); // Save first 50k chars
            }
        }

    } catch (e) {
        console.error('Exploration failed:', e);
    } finally {
        await browser.close();
    }
}

explore();
