
import { chromium } from 'playwright';

async function debug() {
    console.log('Starting debug of Hana Tour promotion page...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        await page.goto('https://hope.hanatour.com/promotion/plan/PM0000113828', { waitUntil: 'networkidle' });
        console.log('Page loaded.');

        // Wait a bit more for dynamic content
        await page.waitForTimeout(5000);

        // Check for "남태평양" text
        const spTexts = await page.getByText('남태평양').all();
        console.log(`Found ${spTexts.length} elements with text "남태평양"`);

        if (spTexts.length > 0) {
            for (let i = 0; i < spTexts.length; i++) {
                const el = spTexts[i];
                console.log(`\n--- Element ${i} ---`);
                console.log('Tag:', await el.evaluate(e => e.tagName));
                console.log('Visible:', await el.isVisible());
                console.log('HTML:', await el.evaluate(e => e.outerHTML));

                // Check parent to see context (tab, button, etc.)
                const parent = await el.evaluate(e => e.parentElement?.outerHTML);
                console.log('Parent HTML:', parent?.substring(0, 500)); // Limit length
            }
        } else {
            console.log('Could not find "남태평양" text visible on page.');
            // Dump body just in case
            // console.log(await page.content());
        }

        // List all potential tab/navigation items
        const tabs = await page.$$('ul > li > a');
        console.log(`\nFound ${tabs.length} link items in lists.`);

        // Take screenshot for debugging
        await page.screenshot({ path: 'debug_hanatour_promo.png', fullPage: true });
        console.log('Saved screenshot to debug_hanatour_promo.png');

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
}

debug();
