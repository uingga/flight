const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });

    await page.goto('http://localhost:3000/blog-thumbnail-260311.html', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2000));

    const outDir = path.resolve(__dirname, '..', 'public', 'images');

    const wide = await page.$('#wide-banner');
    if (wide) {
        await wide.screenshot({ path: path.join(outDir, 'blog-thumb-260311-wide.png') });
        console.log('✅ blog-thumb-260311-wide.png');
    }

    const sq = await page.$('#square-thumb');
    if (sq) {
        await sq.screenshot({ path: path.join(outDir, 'blog-thumb-260311-square.png') });
        console.log('✅ blog-thumb-260311-square.png');
    }

    await browser.close();
    console.log('🎉 Done!');
})();
