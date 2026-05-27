const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
    await page.goto('http://localhost:3000/blog-thumbnail-04.html');
    await page.waitForTimeout(3000);

    const wide = await page.$('.wide');
    if (wide) {
        await wide.screenshot({ path: 'public/thumbnail-04-wide.png' });
        console.log('Wide thumbnail saved!');
    }

    const square = await page.$('.square');
    if (square) {
        await square.screenshot({ path: 'public/thumbnail-04-square.png' });
        console.log('Square thumbnail saved!');
    }

    await browser.close();
    console.log('Done!');
})();
