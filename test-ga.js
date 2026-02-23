const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    let caughtEvent = null;
    page.on('console', msg => {
        if (msg.text().includes('GA Event Fired')) {
            console.log('\n--- CAUGHT CONSOLE LOG ---');
            console.log(msg.text());
            caughtEvent = true;
        }
    });

    await page.goto('http://localhost:3000');
    console.log('Page loaded, waiting for flight cards...');
    await page.waitForSelector('.card', { timeout: 10000 });

    console.log('Clicking the first flight card...');
    const cards = await page.$$('.card');
    if (cards.length > 0) {
        await cards[0].click({ position: { x: 10, y: 10 } });
        await page.waitForTimeout(1000);
    } else {
        console.log('No cards found!');
    }

    if (caughtEvent) {
        console.log('\n✅ GA Event tracking verified successfully.');
    } else {
        console.log('\n❌ Failed to catch GA Event in console.');
    }

    await browser.close();
})();
