// offers.k1 URL 형식 테스트 - gid vs dep/arr
async function test() {
  const baseUrl = 'https://www.myrealtrip.com/bridge/marketing/';
  
  const tests = [
    {
      name: '유저 홍보링크 (gid 방식) - 정상작동 확인됨',
      returnUrl: 'https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=3531274&depdt=2026-06-01&arrdt=2026-06-04&cabin=Y&adult=1&child=0&infant=0&t_scope=86400&mylink_id=1856324&utm_source=mktpartner'
    },
    {
      name: 'dep/arr 방식 (gid 없이)',
      returnUrl: 'https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?dep=ICN&arr=MYJ&depdt=2026-05-27&arrdt=2026-06-01&cabin=Y&adult=1&child=0&infant=0&t_scope=86400&mylink_id=1849392&utm_source=mktpartner'
    },
    {
      name: 'dep/arr + trip=RT 방식',
      returnUrl: 'https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?trip=RT&dep=ICN&arr=MYJ&depdt=2026-05-27&arrdt=2026-06-01&cabin=Y&adult=1&child=0&infant=0&t_scope=86400&mylink_id=1849392&utm_source=mktpartner'
    },
  ];

  for (const t of tests) {
    const url = `${baseUrl}?return_url=${encodeURIComponent(t.returnUrl)}`;
    
    // Follow redirects to final destination
    const res = await fetch(url, { redirect: 'follow' });
    const body = await res.text();
    const hasErr = body.includes('불편') || body.includes('지연') || body.includes('k1_mrt_error') || body.includes('ERROR');
    
    console.log(`\n[${res.status}] ${t.name}`);
    console.log(`  Final URL: ${res.url.substring(0, 120)}...`);
    console.log(`  Error: ${hasErr ? 'YES ❌' : 'NO ✅'}`);
    console.log(`  Body size: ${body.length}`);
    // Show snippet around error if found
    if (hasErr) {
      const idx = body.indexOf('k1_mrt_error');
      if (idx > -1) console.log(`  Error snippet: ...${body.substring(idx, idx+100)}...`);
    }
  }
}

test().catch(console.error);
