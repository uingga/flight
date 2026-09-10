const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const base = process.env.CALENDAR_TEST_URL || 'http://127.0.0.1:3499';
const output = path.resolve('output/calendar-20260910');
const daySelector = '.react-datepicker__day:not(.react-datepicker__day--outside-month)';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390, 360]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, isMobile: width < 768, hasTouch: width < 768 });
      await page.goto(`${base}/preview/mobile-redesign`, { waitUntil: 'networkidle' });
      const open = async (initial = false) => {
        if (width >= 768) {
          await page.locator('button[class*="desktopFilterSummary"]').filter({ hasText: '날짜' }).click();
          await page.getByRole('button', { name: '날짜 직접 선택', exact: true }).click();
        } else {
          if (initial) await page.getByRole('button', { name: '필터', exact: true }).click();
          await page.locator('button[class*="dateDirectButton"]').click();
        }
        await page.locator('.react-datepicker').waitFor();
      };
      const day = number => page.locator(`${daySelector}.react-datepicker__day--${String(number).padStart(3, '0')}`);
      const verifyEndpoint = async locator => {
        const style = await locator.evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundImage, height: el.getBoundingClientRect().height }));
        assert.equal(style.color, 'rgb(255, 255, 255)');
        assert.ok(style.background.includes('rgb(255, 56, 92) 99%'), style.background);
        assert.ok(style.height >= 44);
      };
      await open(true);
      assert.equal(await page.locator('.react-datepicker__day--disabled').first().evaluate(el => getComputedStyle(el).cursor), 'not-allowed');
      await page.locator('.react-datepicker').getByRole('button', { name: '다음 달', exact: true }).click();
      const month = await page.locator('.react-datepicker__current-month').innerText();
      assert.match(month, /^\d{4}년 \d+월$/);
      await day(13).click();
      await verifyEndpoint(day(13));
      await day(19).hover();
      await verifyEndpoint(day(19));
      const bands = await page.locator('.react-datepicker__day--in-selecting-range').evaluateAll(els => els.map(el => ({ x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right, y: el.getBoundingClientRect().y, background: getComputedStyle(el).backgroundImage })));
      assert.ok(bands.length >= 7);
      for (let i = 1; i < bands.length; i++) if (bands[i].y === bands[i - 1].y) assert.ok(Math.abs(bands[i].x - bands[i - 1].right) < 1, 'range cells must touch');
      assert.ok(bands.every(b => b.background.includes('rgb(255, 240, 243)')));
      await day(19).click();
      await page.locator('.react-datepicker').waitFor({ state: 'hidden' });
      await open();
      assert.equal(await page.locator('.react-datepicker__current-month').innerText(), month);
      await verifyEndpoint(day(13));
      await verifyEndpoint(day(19));
      const calendar = page.locator('[class*="dateCalendarWrap"]').filter({ has: page.locator('.react-datepicker') });
      const rect = await calendar.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width, 'calendar must fit viewport');
      await calendar.screenshot({ path: path.join(output, `calendar-${width}.png`) });
      // A new selection replaces the previous range; same-day ranges retain their circle.
      await day(22).click();
      await verifyEndpoint(day(22));
      await day(22).click();
      await page.locator('.react-datepicker').waitFor({ state: 'hidden' });
      await open();
      await verifyEndpoint(day(22));
      assert.equal(await day(22).evaluate(el => getComputedStyle(el).getPropertyValue('--calendar-band').trim()), 'transparent');
      // A range spanning months retains the start and end after month navigation.
      await day(28).click();
      await page.locator('.react-datepicker').getByRole('button', { name: '다음 달', exact: true }).click();
      await day(3).click();
      await page.locator('.react-datepicker').waitFor({ state: 'hidden' });
      await open();
      await verifyEndpoint(day(28));
      await page.locator('.react-datepicker').getByRole('button', { name: '다음 달', exact: true }).click();
      await verifyEndpoint(day(3));
      console.log(`PASS ${width}px: endpoints, hover, continuous range, single day, cross-month, viewport`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
