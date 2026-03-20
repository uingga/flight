const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto('http://localhost:3000/blog-thumbnail-08.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const outDir = path.join(__dirname, '..', 'public', 'images');

    const wide = await page.$('#wide-banner');
    if (wide) {
        await wide.screenshot({ path: path.join(outDir, 'blog-thumb-08-wide.png') });
        console.log('✅ blog-thumb-08-wide.png');
    }

    const square = await page.$('#square-thumb');
    if (square) {
        await square.screenshot({ path: path.join(outDir, 'blog-thumb-08-square.png') });
        console.log('✅ blog-thumb-08-square.png');
    }

    await browser.close();
    console.log('🎉 Done!');
})();
