const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const output = path.resolve('output/filter-scroll-edges-20260910');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [390, 320, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.goto('http://127.0.0.1:3499/preview/mobile-redesign', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: width < 960 ? '필터' : '상세 조건', exact: true }).click();
      const dialog = page.locator('[role="dialog"][aria-label="항공권 필터"]');
      const header = dialog.locator('[data-scrolled]');
      const footer = dialog.locator('[data-more-below]');
      const area = dialog.locator('[class*="filterScrollArea"]');
      if (width >= 960) {
        assert.equal(await area.evaluate(el => getComputedStyle(el).display), 'contents');
        assert.equal(await header.evaluate(el => getComputedStyle(el, '::after').content), 'none');
        console.log('PASS PC unchanged');
        await page.close();
        continue;
      }
      assert.equal(await header.getAttribute('data-scrolled'), 'false');
      await dialog.locator('button[aria-controls="advanced-filter-options"]').click();
      await page.waitForFunction(() => document.querySelector('[data-more-below]')?.dataset.moreBelow === 'true');
      await area.evaluate(el => { el.scrollTop = 120; });
      await page.waitForFunction(() => document.querySelector('[data-scrolled]')?.dataset.scrolled === 'true');
      assert.equal(await header.evaluate(el => getComputedStyle(el, '::after').pointerEvents), 'none');
      assert.equal(await footer.evaluate(el => getComputedStyle(el, '::before').pointerEvents), 'none');
      const before = await footer.boundingBox();
      await dialog.screenshot({ path: path.join(output, `middle-${width}.png`) });
      await area.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForFunction(() => document.querySelector('[data-more-below]')?.dataset.moreBelow === 'false');
      const after = await footer.boundingBox();
      assert.ok(Math.abs(before.y - after.y) < 1, 'CTA must not move while scrolling');
      const airline = dialog.locator('label[class*="mobileAirlineSelect"]');
      const airlineBox = await airline.boundingBox();
      assert.ok(airlineBox.y + airlineBox.height <= after.y, 'last control must be above CTA');
      await area.evaluate(el => { el.scrollTop = 0; });
      await page.waitForFunction(() => document.querySelector('[data-scrolled]')?.dataset.scrolled === 'false');
      await dialog.locator('button[class*="dateDirectButton"]').click();
      await page.locator('.react-datepicker').waitFor();
      await page.waitForFunction(() => document.querySelector('[data-more-below]')?.dataset.moreBelow === 'true');
      await area.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForFunction(() => document.querySelector('[data-more-below]')?.dataset.moreBelow === 'false');
      await dialog.getByRole('button', { name: /개 항공권 보기/ }).click();
      await dialog.waitFor({ state: 'hidden' });
      console.log(`PASS ${width}px: top/middle/end fades, resize after calendar, fixed CTA, no control overlap`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
