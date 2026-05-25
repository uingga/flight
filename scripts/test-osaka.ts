import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage();
  // 구마모토 KMJ, 6/4→6/9
  const url = 'https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=3555883&depdt=2026-06-04&arrdt=2026-06-09&cabin=Y&adult=1&child=0&infant=0';
  console.log('구마모토 6/4→6/9 검색 중...');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(12000);
  
  const prices = await page.evaluate(() => {
    const r: string[] = [];
    document.querySelectorAll('*').forEach(el => {
      const t = (el as HTMLElement).innerText?.trim() || '';
      if (t.match(/[\d,]+원/) && t.length < 80 && !r.includes(t) && t.includes('석 남음')) r.push(t);
    });
    return r.slice(0, 5);
  });
  console.log('\n=== 구마모토 실제 가격 ===');
  if (prices.length === 0) console.log('❌ 없음');
  else prices.forEach(p => console.log(' ', p));
  await browser.close();
}
test().catch(e => { console.error('에러:', e.message); process.exit(1); });
