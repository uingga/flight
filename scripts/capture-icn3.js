const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto('http://localhost:3000/?q=%EC%BD%94%ED%83%80%ED%82%A4%EB%82%98%EB%B0%9C%EB%A3%A8', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    const card = await page.$('.card');
    if (card) {
        await card.screenshot({ path: path.join(__dirname, '..', 'public', 'blog-cards', 'icn_3.png') });
        console.log('✅ icn_3.png (코타키나발루) 저장 완료');
    } else {
        console.log('❌ 카드를 찾을 수 없음');
    }
    await browser.close();
})();
