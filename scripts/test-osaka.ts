import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage();
  // 옌타이 YNT, gid=4226288, Bulk API 날짜 기준 10/19출발 6박
  const url = 'https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=4226288&depdt=2026-10-19&arrdt=2026-10-25&cabin=Y&adult=1&child=0&infant=0';
  console.log('옌타이 검색 중...');
  console.log('URL:', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  console.log('페이지 로드 완료, 12초 대기...');
  await page.waitForTimeout(12000);
  
  const prices = await page.evaluate(() => {
    const r: string[] = [];
    document.querySelectorAll('*').forEach(el => {
      const t = (el as HTMLElement).innerText?.trim() || '';
      if (t.match(/[\d,]+원/) && t.length < 50 && !r.includes(t)) r.push(t);
    });
    return r.slice(0, 15);
  });
  console.log('\n=== 옌타이 실제 가격 ===');
  if (prices.length === 0) console.log('❌ 가격 없음');
  else prices.forEach(p => console.log(' ', p));
  
  await browser.close();
}
test().catch(e => { console.error('에러:', e.message); process.exit(1); });
