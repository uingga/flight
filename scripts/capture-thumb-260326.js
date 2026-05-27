const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
    
    const thumbUrl = 'http://localhost:3000/blog-thumbnail-260326.html';
    try {
        await page.goto(thumbUrl, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
        console.log('networkidle timeout, trying load...');
        await page.goto(thumbUrl, { waitUntil: 'load', timeout: 30000 });
    }
    await page.waitForTimeout(3000);

    // Wide banner
    const wide = await page.$('#wide-banner');
    if (wide) {
        await wide.screenshot({ path: path.join(__dirname, '..', 'public', 'images', 'blog-thumb-260326-wide.png') });
        console.log('✅ wide banner saved');
    }
    
    // Square thumb
    const square = await page.$('#square-thumb');
    if (square) {
        await square.screenshot({ path: path.join(__dirname, '..', 'public', 'images', 'blog-thumb-260326-square.png') });
        console.log('✅ square thumb saved');
    }

    await browser.close();
    console.log('Done!');
})();
