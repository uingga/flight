import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { YbtourInteractionGuard } from '../src/lib/scrapers/ybtour-interaction';
import { IncompleteScrapeError } from '../src/lib/scrapers/scrape-errors';
import { classifySourceAccessRestriction } from '../src/lib/source-circuit';

test('offline fare pagination: hidden provincial departures, page blocks and fail-closed controls', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        let requests = 0;
        await page.route('**/*', route => { requests++; return route.abort(); });
        const html = (count=28) => `<body data-pages="" data-queries="0">
          <table id="totalFareTable" fareTotCnt="${count}" onePageCnt="10"><tbody>
          ${Array.from({length:count},(_,i)=>`<tr id="fareListSeq_${i+1}" style="display:${i<10?'':'none'}"><td>진에어</td><td>${i===11?'부산':i===13?'대구':'인천'}</td><td>다낭</td><td>왕복</td><td><a href="#" onclick="document.body.dataset.queries=String(Number(document.body.dataset.queries)+1);return false">조회</a></td></tr>`).join('')}
          </tbody></table><span id="pageList"></span><a id="pageNext" href="#">다음</a><a id="pagePrev" href="#">이전</a>
          <script>
          function changePage(p) {
            document.body.dataset.pages+=p+',';
            document.querySelectorAll('tr').forEach((r,i)=>r.style.display=i>=(p-1)*10&&i<p*10?'':'none');
            const start=Math.floor((p-1)/5)*5+1;
            document.getElementById('pageList').innerHTML=Array.from({length:Math.min(5,Math.ceil(${count}/10)-start+1)},(_,i)=>start+i===p?'<strong>'+p+'</strong>':'<a href="#" onclick="changePage('+(start+i)+')">'+(start+i)+'</a>').join('');
            document.getElementById('pageNext').onclick=()=>changePage(start+5);
            document.getElementById('pagePrev').onclick=()=>changePage(start-1);
          }
          changePage(1);document.body.dataset.pages='';
          </script></body>`;
        const row = async (seq: number) => (await page.$(`#fareListSeq_${seq}`))!;

        await page.setContent(html());
        const guard = new YbtourInteractionGuard(page);
        await guard.revealFareRow(await row(1), '인천');
        assert.equal(await page.locator('body').getAttribute('data-pages'), '');
        assert.equal(await (await row(12)).isVisible(), false, 'same hidden Busan row as the live failure');
        await guard.revealFareRow(await row(12), '부산');
        await guard.click('부산 조회', () => page.locator('#fareListSeq_12 a').click());
        await guard.revealFareRow(await row(14), '대구');
        await guard.click('대구 조회', () => page.locator('#fareListSeq_14 a').click());
        assert.equal(await page.locator('body').getAttribute('data-pages'), '2,', 'only one page switch for both departures');
        assert.equal(await page.locator('body').getAttribute('data-queries'), '2');

        await page.setContent(html(75));
        await new YbtourInteractionGuard(page).revealFareRow(await row(72), '8페이지');
        assert.equal(await page.locator('body').getAttribute('data-pages'), '6,8,', 'navigate the visible next block, then target');

        await page.setContent(html());
        await page.locator('#totalFareTable').evaluate(el => el.setAttribute('onePageCnt','0'));
        await assert.rejects(new YbtourInteractionGuard(page).revealFareRow(await row(12),'잘못된 페이지 정보'), IncompleteScrapeError);
        assert.equal(await (await row(12)).isVisible(), false);

        await page.setContent(html());
        await page.locator('#pageList a').first().evaluate(el => el.addEventListener('click', event => event.stopImmediatePropagation(), true));
        await assert.rejects(new YbtourInteractionGuard(page).revealFareRow(await row(12),'작동하지 않는 이동'), /페이지 이동 실패/);
        assert.equal(await (await row(12)).isVisible(), false, 'never force-show hidden rows');

        await page.setContent(html());
        await page.locator('body').evaluate(el => el.prepend('CAPTCHA'));
        await assert.rejects(new YbtourInteractionGuard(page).revealFareRow(await row(12),'접근 제한'), e => {
            assert.equal(classifySourceAccessRestriction(e)?.reason,'blocked'); return true;
        });
        assert.equal(await page.locator('body').getAttribute('data-pages'), '');
        assert.equal(requests,0, 'no travel agency requests');
    } finally { await browser.close(); }
});
