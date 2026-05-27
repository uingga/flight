const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    const thumbUrl = 'http://localhost:3000/blog-thumbnail-260325.html';
    await page.goto(thumbUrl, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Wide banner
    const wide = await page.$('#wide-banner');
    if (wide) {
        await wide.screenshot({ path: path.join(__dirname, '..', 'public', 'images', 'blog-thumb-260325-wide.png') });
        console.log('✅ wide banner saved');
    }
    
    // Square thumb
    const square = await page.$('#square-thumb');
    if (square) {
        await square.screenshot({ path: path.join(__dirname, '..', 'public', 'images', 'blog-thumb-260325-square.png') });
        console.log('✅ square thumb saved');
    }

    await browser.close();
    console.log('Done!');
})();
