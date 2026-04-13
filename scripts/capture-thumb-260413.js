const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    const thumbUrl = 'http://localhost:3000/blog-thumbnail-260413.html';
    await page.goto(thumbUrl, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const wide = await page.$('#wide-banner');
    if (wide) {
        await wide.screenshot({ path: path.join(__dirname, '..', 'public', 'images', 'blog-thumb-260413-wide.png') });
        console.log('✅ wide banner saved');
    }
    
    const square = await page.$('#square-thumb');
    if (square) {
        await square.screenshot({ path: path.join(__dirname, '..', 'public', 'images', 'blog-thumb-260413-square.png') });
        console.log('✅ square thumb saved');
    }

    await browser.close();
    console.log('Done!');
})();
