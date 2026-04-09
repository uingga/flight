import { chromium } from 'playwright';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
    const b = await chromium.launch({ headless: true });
    const c = await b.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        viewport: { width: 1920, height: 8000 },
        extraHTTPHeaders: { 'Referer': 'https://www.google.com/' },
    });
    const p = await c.newPage();
    await p.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

    await p.goto('https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV', {
        waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await p.waitForSelector('table tbody', { timeout: 10000 }).catch(() => {});
    await delay(3000);

    // 일본 탭 클릭
    const tab = p.locator('#bannerCode_J1');
    if (await tab.isVisible()) await tab.click({ timeout: 5000 });
    await delay(2000);

    // 후쿠오카 도시 클릭
    const city = p.locator('#cityCode_FUK a');
    if (await city.isVisible()) {
        await city.scrollIntoViewIfNeeded();
        await city.click({ timeout: 5000 });
        await p.waitForSelector('table tbody tr', { timeout: 5000 });
        await delay(2000);
    }

    // 첫 번째 메인 행의 조회 버튼 클릭
    const rows = await p.$$('table tbody tr');
    for (const row of rows) {
        const isMain = await row.evaluate(r => r.querySelectorAll('td').length >= 5);
        if (!isMain) continue;
        const btn = await row.$('a[onclick*="listActive"]');
        if (btn) {
            await btn.click({ timeout: 5000 });
            await delay(3000);
            break;
        }
    }

    // td.link 내부의 모든 input 출력
    const data = await p.evaluate(() => {
        const links = document.querySelectorAll('td.link a[onclick*="selectFareINV"]');
        if (!links.length) return { total: 0, inputs: [] as { id: string; value: string }[] };
        const first = links[0];
        const inps = first.querySelectorAll('input');
        return {
            total: links.length,
            inputs: Array.from(inps).map(i => ({ id: i.id, value: i.value })),
        };
    });

    console.log('Total schedule links:', data.total);
    console.log('\n=== First schedule - all hidden inputs ===');
    data.inputs.forEach(i => console.log(`  ${i.id} = ${i.value}`));

    await b.close();
}

main().catch(console.error);
