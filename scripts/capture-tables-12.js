const { chromium } = require('playwright');
const path = require('path');

async function main() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 1200 } });
    
    await page.goto('http://localhost:3000/blog12-tables.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const outDir = path.join(__dirname, '..', 'public', 'images');

    const timeline = page.locator('#timeline-table');
    await timeline.screenshot({ path: path.join(outDir, 'blog12-timeline.png') });
    console.log('✅ blog12-timeline.png');

    const timing = page.locator('#timing-table');
    await timing.screenshot({ path: path.join(outDir, 'blog12-timing.png') });
    console.log('✅ blog12-timing.png');

    await browser.close();
    console.log('📸 표 재캡처 완료!');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
