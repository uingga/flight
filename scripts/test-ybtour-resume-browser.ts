import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { chromium } from 'playwright';
import { scrapeYbtour } from '../src/lib/scrapers/ybtour';

// Exercise the actual collector through all regions. Every HTTP request is fulfilled locally.
test('collector finishes after a persistent Asia mask, preserving earlier cities without duplicate partial rows', { timeout: 120_000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    let loads = 0;
    const queries: string[] = [];
    context.on('page', page => {
        page.on('pageerror', error => { console.error('Fixture script error:', error.message); void browser.close(); });
        page.on('console', msg => {
        if (msg.text().startsWith('QUERY:')) queries.push(msg.text().slice(6));
        });
    });
    await context.route('**/*', async route => {
        assert.match(route.request().url(), /^https:\/\/fly\.ybtour\.co\.kr\/booking\/findDiscountAir\.lts\?/);
        loads++;
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8">
          <style>.dimBox {position:fixed;inset:0;z-index:999;background:#ccc} a {display:inline-block;padding:8px}</style>
          <a id="bannerCode_J1" onclick="region('NRT')">일본</a>
          <a id="bannerCode_A0/A3" onclick="region('DAD')">아시아</a>
          <a id="bannerCode_P1" onclick="region('GUM')">괌/사이판</a>
          <a id="bannerCode_P0" onclick="region('SYD')">남태평양</a>
          <a id="bannerCode_E0/B1/F0" onclick="region('BCN')">유럽</a>
          <ul class="ctab_list"></ul><table><tbody id="fares"></tbody></table><div id="schedules"></div>
          <script>
          function region(code) {
            document.querySelector('.ctab_list').innerHTML='<li id="cityCode_'+code+'"><a>'+code+'</a></li>';
            document.querySelector('.ctab_list a').setAttribute('onclick','city('+JSON.stringify(code)+')');
            document.getElementById('fares').innerHTML=''; document.getElementById('schedules').innerHTML='';
          }
          function city(code) {
            document.getElementById('schedules').innerHTML='';
            document.getElementById('fares').innerHTML=Array.from({length:code==='DAD'?2:1}, (_,i)=>
              '<tr><td>진에어</td><td>'+(i?'부산':'인천')+'</td><td>'+code+'</td><td>왕복</td><td><a>조회</a></td></tr>').join('');
            document.querySelectorAll('#fares a').forEach((a,i)=>a.setAttribute('onclick','listActive('+JSON.stringify(code)+','+i+')'));
          }
          function listActive(code,i) {
            console.log('QUERY:'+code+':'+i);
            const input=(key,value)=>'<input id="x_'+key+'_1" value="'+value+'">';
            document.getElementById('schedules').innerHTML='<table><tbody><tr><td class="link"></td></tr></tbody></table>';
            const link=document.createElement('a'); link.setAttribute('onclick','selectFareINV()');
            link.innerHTML=input('depDate','20260920')+input('inmRetDate','20260924')+input('inhId',code+i)
              +input('inpArrApCode',code)+input('inpDepApCode',i?'PUS':'ICN')+input('remainingSeat','4')
              +'<table class="city_in"><tbody><tr><td class="red">'+(i?'110,000':'100,000')+'원</td></tr></tbody></table>';
            document.querySelector('td.link').appendChild(link);
            if (${loads} === 1 && code==='DAD' && i===0) document.body.insertAdjacentHTML('beforeend','<div class="dimBox bg"></div>');
          }
          region('NRT');
          </script>` });
    });
    // The scraper gets a real, isolated browser context, with no route allowed to reach the agency.
    const launch = mock.method(chromium, 'launch', async () => ({
        newContext: async () => context,
        close: async () => {},
    }));
    try {
        const flights = await scrapeYbtour([]);
        assert.equal(loads, 2, 'one initial landing and one recovery, not a whole-run restart');
        assert.equal(queries.filter(q => q === 'NRT:0').length, 1, 'Japan must not be re-read');
        assert.equal(queries.filter(q => q === 'DAD:0').length, 2, 'failed city resumes after restoring the region');
        assert.equal(queries.filter(q => q === 'DAD:1').length, 1);
        for (const code of ['GUM', 'SYD', 'BCN']) assert.equal(queries.filter(q => q === code+':0').length, 1);
        assert.equal(flights.length, 6, 'partial first row must not be duplicated');
        assert.equal(new Set(flights.map(f => f.id)).size, 6);
        assert.equal(flights.filter(f => f.arrival.airport === 'DAD').length, 2);
    } finally {
        launch.mock.restore();
        await browser.close();
    }
});
