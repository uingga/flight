// 마이리얼트립 URL 형식 테스트
const urls = [
  'https://www.myrealtrip.com/flights/lowest',
  'https://www.myrealtrip.com/offer/flights',
  'https://www.myrealtrip.com/flight',
  'https://www.myrealtrip.com/offers/flights',
  'https://www.myrealtrip.com/flights/list',
  'https://www.myrealtrip.com/flights/search/roundtrip/ICN/MYJ/2026-05-27/2026-06-01/1/0/0/economy',
  'https://www.myrealtrip.com/flights/roundtrip/ICN/MYJ/2026-05-27/2026-06-01',
  'https://www.myrealtrip.com/bridge/marketing/?return_url=https%3A%2F%2Fwww.myrealtrip.com&mylink_id=1849392',
];

async function test() {
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'manual' });
      const location = res.headers.get('location') || '';
      const body = await res.text();
      const hasError = body.includes('불편') || body.includes('error') || body.includes('404');
      const title = body.match(/<title>([^<]*)<\/title>/)?.[1] || '';
      console.log(`[${res.status}] ${url}`);
      if (location) console.log(`  → Redirect: ${location}`);
      if (title) console.log(`  → Title: ${title}`);
      if (hasError) console.log(`  → ⚠️ Error page detected`);
      else console.log(`  → ✅ No error detected`);
    } catch (e: any) {
      console.log(`[ERR] ${url} → ${e.message}`);
    }
  }
  
  // Partner API landing URL test
  console.log('\n--- Partner API Landing URL Test ---');
  const apiKey = process.env.MYREALTRIP_API_KEY;
  if (!apiKey) { console.log('No API key'); return; }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://partner-ext-api.myrealtrip.com/v1/products/flight/fare-query-landing-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        departureCity: 'ICN', arrivalCity: 'MYJ',
        departureDate: '2026-05-27', arrivalDate: '2026-06-01',
        adults: 1, children: 0, infants: 0, cabinClass: 'Y'
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    console.log(`[${res.status}]`, await res.text());
  } catch (e: any) {
    clearTimeout(timeout);
    console.log(`Partner API failed: ${e.message}`);
  }
}

test();
