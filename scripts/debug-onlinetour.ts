import { chromium } from 'playwright';
import fs from 'fs';

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=AS&SelectedCityCd=CXR', { timeout: 30000 });
    await page.waitForTimeout(3000);

    try { await page.waitForSelector('#data_list > li.item', { timeout: 5000 }); } catch (e) { console.log('list load failed'); }

    const debug = await page.evaluate(() => {
        const items = document.querySelectorAll('#data_list > li.item');
        const results: any[] = [];

        items.forEach((item, idx) => {
            // Check the reserve button
            const reserveBtn = item.querySelector('a.btn_type5.popupLogin');
            const reserveBtn2 = item.querySelector('a.btn_type5');
            const allAnchors = Array.from(item.querySelectorAll('a')).map(a => ({
                class: a.className,
                text: a.textContent?.trim()?.substring(0, 30),
                onclick: a.getAttribute('onclick')?.substring(0, 80)
            }));

            const onclick = reserveBtn?.getAttribute('onclick') || '';
            const eventCode = onclick.match(/go_reserve\('([^']+)'\)/)?.[1];

            const priceStr = item.querySelector('.cell5 .txt_data strong')?.textContent?.replace(/,/g, '') || '0';
            const price = parseInt(priceStr);

            results.push({
                idx,
                price,
                hasReserveBtn: !!reserveBtn,
                hasReserveBtn2: !!reserveBtn2,
                eventCode: eventCode || 'NONE',
                anchors: allAnchors,
                cell7HTML: item.querySelector('.cell7')?.innerHTML?.substring(0, 200) || 'NO_CELL7'
            });
        });

        return results;
    });

    fs.writeFileSync('data/debug-reserve-btn.json', JSON.stringify(debug, null, 2));
    console.log('Items:', debug.length);
    debug.forEach(d => {
        console.log(`  item${d.idx}: price=${d.price}, btn=${d.hasReserveBtn}, btn2=${d.hasReserveBtn2}, eventCode=${d.eventCode}`);
        console.log('    anchors:', d.anchors.length);
        d.anchors.forEach(a => console.log(`      ${a.class} | ${a.text} | ${a.onclick}`));
    });

    await browser.close();
}

main().catch(console.error);
