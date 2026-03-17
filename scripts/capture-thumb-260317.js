const { chromium } = require('playwright');
const path = require('path');

async function main() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
    
    await page.goto('http://localhost:3000/blog-thumbnail-260317.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000); // wait for fonts to load

    const outDir = path.join(__dirname, '..', 'public', 'images');

    // Wide banner
    const wide = page.locator('#wide-banner');
    await wide.screenshot({ path: path.join(outDir, 'blog-thumb-260317-wide.png') });
    console.log('✅ blog-thumb-260317-wide.png');

    // Square thumb
    const square = page.locator('#square-thumb');
    await square.screenshot({ path: path.join(outDir, 'blog-thumb-260317-square.png') });
    console.log('✅ blog-thumb-260317-square.png');

    await browser.close();
    console.log('📸 썸네일 캡처 완료!');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
