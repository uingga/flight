const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

    await page.goto('http://localhost:3000/blog-post-08.html', { waitUntil: 'networkidle' });

    // Hide the copy guide overlay
    await page.evaluate(() => {
        const guide = document.querySelector('.copy-guide');
        if (guide) guide.style.display = 'none';
    });

    const outDir = path.join(__dirname, '..', 'public', 'images');

    // 1. Main comparison table (first <table> that is NOT .mini-table)
    const mainTable = await page.$('.post > table');
    if (mainTable) {
        await mainTable.screenshot({ path: path.join(outDir, 'blog08-compare.png') });
        console.log('✅ blog08-compare.png');
    }

    // 2. Each city card's mini-table
    const cities = ['osaka', 'danang', 'fukuoka', 'bangkok', 'taipei', 'nhatrang', 'cebu', 'tokyo', 'qingdao', 'guam'];
    const miniTables = await page.$$('.city-card .mini-table');
    for (let i = 0; i < miniTables.length && i < cities.length; i++) {
        const filename = `blog08-mini-${cities[i]}.png`;
        await miniTables[i].screenshot({ path: path.join(outDir, filename) });
        console.log(`✅ ${filename}`);
    }

    // 3. Bottom cost table (last full table)
    const allTables = await page.$$('.post > table');
    if (allTables.length >= 2) {
        const costTable = allTables[allTables.length - 1];
        await costTable.screenshot({ path: path.join(outDir, 'blog08-cost.png') });
        console.log('✅ blog08-cost.png');
    }

    await browser.close();
    console.log('\n🎉 All tables captured!');
})();
