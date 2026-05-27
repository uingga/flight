const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });

    await page.goto('http://localhost:3000/blog-thumbnail-260310.html', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1000)); // wait for fonts

    const outDir = path.resolve(__dirname, '..', 'public', 'images');

    // Capture wide banner
    const wideBanner = await page.$('#wide-banner');
    if (wideBanner) {
        await wideBanner.screenshot({ path: path.join(outDir, 'blog-thumb-260310-wide.png') });
        console.log('✅ blog-thumb-260310-wide.png');
    }

    // Capture square thumbnail
    const squareThumb = await page.$('#square-thumb');
    if (squareThumb) {
        await squareThumb.screenshot({ path: path.join(outDir, 'blog-thumb-260310-square.png') });
        console.log('✅ blog-thumb-260310-square.png');
    }

    await browser.close();
    console.log('🎉 Done!');
})();
