// DOM 교체 패턴 상세 분석
import { chromium } from 'playwright';
import * as fs from 'fs';

async function main() {
    var output: string[] = [];
    var log = function (msg: string) { console.log(msg); output.push(msg); };

    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        viewport: { width: 1920, height: 8000 },
    });
    var page = await context.newPage();

    await page.goto('https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV', {
        waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForSelector('table tbody', { timeout: 10000 }).catch(function () { });
    await page.waitForTimeout(2000);

    var mainRows = await page.$$('table tbody tr');
    var mainRowIndices: number[] = [];
    for (var i = 0; i < mainRows.length; i++) {
        var isMain = await mainRows[i].evaluate(function (row) { return row.querySelectorAll('td').length >= 5; });
        if (isMain) mainRowIndices.push(i);
    }

    for (var ri = 0; ri < mainRowIndices.length; ri++) {
        var rowIdx = mainRowIndices[ri];
        var info = await mainRows[rowIdx].evaluate(function (row) {
            var cells = row.querySelectorAll('td');
            return (cells[0]?.textContent || '').trim() + ' ' + (cells[2]?.textContent || '').trim();
        });

        var btn = await mainRows[rowIdx].$('a[onclick*="listActive"]');
        if (!btn) { log('Row ' + ri + ' (' + info + '): no button'); continue; }

        await btn.click({ timeout: 5000 });
        await page.waitForTimeout(2000);

        // 현재 DOM의 첫 번째와 마지막 depDate 확인
        var snapshot = await page.evaluate(function () {
            var links = document.querySelectorAll('td.link a[onclick*="selectFareINV"]');
            var count = links.length;
            var firstDep = '';
            var lastDep = '';
            var firstPrice = '';
            if (count > 0) {
                var first = links[0].querySelector('input[id*="_depDate_"]') as HTMLInputElement | null;
                var last = links[count - 1].querySelector('input[id*="_depDate_"]') as HTMLInputElement | null;
                var fp = links[0].querySelector('table.city_in td.red, table.city_in td.text_r');
                firstDep = first?.value || 'N/A';
                lastDep = last?.value || 'N/A';
                firstPrice = (fp?.textContent || '').trim();
            }
            return { count: count, firstDep: firstDep, lastDep: lastDep, firstPrice: firstPrice };
        });
        log('Row ' + ri + ' (' + info + '): ' + snapshot.count + ' links, first=' + snapshot.firstDep + ', last=' + snapshot.lastDep + ', price=' + snapshot.firstPrice);
    }

    fs.writeFileSync('scripts/ybtour-test-result.txt', output.join('\n'), 'utf8');
    await browser.close();
}
main().catch(console.error);
