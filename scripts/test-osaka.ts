import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage();

  // 기타큐슈 KKJ, 6/25출발 7일
  const url = 'https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=3536878&depdt=2026-06-25&arrdt=2026-07-02&cabin=Y&adult=1&child=0&infant=0';
  console.log('기타큐슈 검색 중...');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  console.log('페이지 로드 완료, 15초 대기...');
  await page.waitForTimeout(15000);

  // "석 남음" 패턴 확인
  const has석남음 = await page.evaluate(() => document.body?.innerText?.includes('석 남음'));
  console.log('"석 남음" 포함:', has석남음);

  // 모든 가격 텍스트
  const prices = await page.evaluate(() => {
    const r: string[] = [];
    document.querySelectorAll('*').forEach(el => {
      const t = (el as HTMLElement).innerText?.trim() || '';
      if (t.match(/[\d,]+원/) && t.length < 80 && !r.includes(t)) r.push(t);
    });
    return r.slice(0, 15);
  });
  
  console.log('\n가격 텍스트:');
  if (prices.length === 0) {
    console.log('❌ 없음');
    const body = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
    console.log('페이지:', body);
  } else {
    prices.forEach(p => console.log(' ', p));
  }
  
  await browser.close();
}
test().catch(e => { console.error('에러:', e.message); process.exit(1); });
