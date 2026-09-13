const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const origin = process.argv[2] || 'http://127.0.0.1:3499';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const ids = [
  'ttang-RF0384CJJIBR-G11-2026-09-26',
  'ttang-RF0384CJJIBR-G14-2026-09-29',
  'ttang-RF0384CJJIBR-G13-2026-10-10',
];
(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [390, 320, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.addInitScript(() => localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2', 'dismissed'));
      await page.route(/google-analytics\.com|googletagmanager\.com|\/api\/visits/, route => route.abort());
      const publishedPath = '/t/tRF0384CJJIBR-G13-2026-10-10';
      const redirect = await page.request.get(`${origin}${publishedPath}`, { maxRedirects: 0 });
      const target = new URL(redirect.headers().location);
      assert.equal(target.pathname, '/share-group/ibr-260910');
      assert.equal(target.searchParams.get('utm_content'), 'share_tRF0384CJJIBR-G13-2026-10-10');
      const individual = await page.request.get(`${origin}/s/tRF0384CJJIBR-G13-2026-10-10`, { maxRedirects: 0 });
      assert.equal(new URL(individual.headers().location).pathname, '/share/ttang-RF0384CJJIBR-G13-2026-10-10');
      await page.goto(`${origin}${publishedPath}?utm_content=ibaraki-test`, { waitUntil: 'networkidle' });
      const api = await page.request.get(`${origin}/api/flights`);
      const data = await api.json();
      const byId = new Map(data.flights.map(f => [f.id, f]));
      const activeIds = ids.filter(id => byId.has(id));
      assert.ok(activeIds.length > 0, 'collection needs an active flight for this interaction test');
      const cards = page.locator('article[data-flight-id]');
      await cards.first().waitFor();
      assert.deepEqual(await cards.evaluateAll(es => es.map(e => e.dataset.flightId)), activeIds);
      const detail = page.locator('[role="dialog"][aria-label="항공권 상세"]');
      assert.equal(await detail.count(), 0, 'entry must show the list, not a detail');
      const more = page.getByRole('button', { name: '안 살 거지만 더 보기' });
      await more.waitFor();
      await cards.first().locator('button').first().click();
      await detail.waitFor();
      assert.equal(await detail.getByRole('button', { name: '안 살 거지만 더 보기' }).count(), 0);
      assert.equal(new URL(page.url()).searchParams.get('flight'), activeIds[0]);
      assert.equal(await cards.count(), activeIds.length, 'active cards stay behind the detail');
      await page.goBack();
      await detail.waitFor({ state: 'hidden' });
      assert.deepEqual(await cards.evaluateAll(es => es.map(e => e.dataset.flightId)), activeIds);
      await more.click();
      await more.waitFor({ state: 'hidden' });
      await cards.first().waitFor();
      const shown = await cards.evaluateAll(es => es.map(e => e.dataset.flightId));
      assert.ok(shown.length > 3, 'browse more must offer other flights');
      for (const id of shown) assert.equal(byId.get(id)?.departure.airport, 'CJJ');
      assert.equal(new URL(page.url()).searchParams.get('utm_source'), 'threads');
      assert.equal(new URL(page.url()).searchParams.get('utm_content'), 'ibaraki-test');
      console.log(`PASS ${width}px: active schedules only, selected detail without browse CTA, back to list, browse more, attribution`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
