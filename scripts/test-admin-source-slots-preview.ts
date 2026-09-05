/**
 * ADMIN_KEY=... npx tsx scripts/test-admin-source-slots-preview.ts <baseUrl> [outDir]
 * Real cached collection records are tested first. The separate FIXTURE scenarios
 * are synthetic UI regressions, never collection evidence and never written to data/.
 */
import assert from 'node:assert/strict';
import { chromium, type Locator } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = (process.argv[2] || 'http://127.0.0.1:3473').replace(/\/$/, '');
const adminKey = process.env.ADMIN_KEY;
const outDir = process.argv[3] || path.join(process.env.LOCALAPPDATA || '.', 'Temp', 'admin-slots-shots');
const kst = (time: string) => `2026-09-05T${time}+09:00`;
fs.mkdirSync(outDir, { recursive: true });

async function run() {
    assert.ok(adminKey, 'ADMIN_KEY is required (local test key or authorized admin key)');
    const response = await fetch(`${baseUrl}/api/crawl-log?key=${encodeURIComponent(adminKey)}`);
    assert.equal(response.status, 200, `crawl-log HTTP ${response.status}`);
    const real = await response.json();
    const fixture = {
        ...real,
        currentCrawlRun: { id: 1, title: 'TEST FIXTURE', status: 'in_progress', stage: 'crawling', event: 'schedule', startedAt: kst('14:23:30'), updatedAt: kst('14:24:00'), url: '', plannedSources: ['ybtour'], skippedSources: [] },
        crawlScheduleHealth: { ...real.crawlScheduleHealth, lastCompletedAt: kst('11:30:00'), expectedAt: kst('14:23:00'), status: 'waiting' },
        sourceCircuits: { ttang: { reason: 'blocked', openedAt: kst('14:25:00'), nextProbeAt: '2026-09-06T14:25:00+09:00', detail: 'TEST FIXTURE: HTTP 403', localFallback: { status: 'failed', lastAttemptAt: kst('14:27:00'), detail: 'TEST FIXTURE: PC response unavailable' } } },
        manualCaptureStatus: {},
        crawlHistory: [
            { timestamp: kst('08:30:00'), sites: { modetour: { total: 20, scraped: 200 } }, alerts: [] },
            { timestamp: kst('12:00:00'), sites: { modetour: { total: 20, scraped: 100, manual: true } }, alerts: [] },
            { timestamp: kst('14:25:00'), sites: { modetour: { total: 20, preserved: true }, ttang: { total: 42, preserved: true }, onlinetour: { total: 1, skipped: true, skipReason: 'circuit', skippedUntil: '2026-09-06T14:25:00+09:00' } }, alerts: [] },
            { timestamp: kst('14:27:00'), sites: { ttang: { total: 42, preserved: true, localFallback: true } }, alerts: [] },
            { timestamp: kst('14:30:00'), sites: { modetour: { total: 20, scraped: 400, manual: true } }, alerts: [] },
        ],
    };
    const browser = await chromium.launch();
    const results: string[] = [];
    try {
        for (const scenario of ['real-cache', 'FIXTURE'] as const) {
            for (const [name, viewport, scale] of [['desktop', { width: 1440, height: 1000 }, 2], ['mobile', { width: 390, height: 844 }, 3]] as const) {
                const context = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: name === 'mobile', isMobile: name === 'mobile' });
                try {
                    const page = await context.newPage();
                    const errors: string[] = [];
                    page.on('pageerror', error => errors.push(error.message));
                    if (scenario === 'FIXTURE') await page.clock.setFixedTime(new Date(kst('15:00:00')));
                    // Keep only the collection API and local flight summary. Do not
                    // query analytics/accounts or send tracking during this UI test.
                    await page.route('**/*', async route => {
                        const url = new URL(route.request().url());
                        if (url.origin !== new URL(baseUrl).origin) return route.abort();
                        if (url.pathname === '/api/crawl-log') return route.fulfill({ json: scenario === 'FIXTURE' ? fixture : real });
                        if (url.pathname.startsWith('/api/') && url.pathname !== '/api/flights') return route.fulfill({ status: 503, json: { error: 'Disabled for collection UI test' } });
                        return route.continue();
                    });
                    await page.goto(`${baseUrl}/admin`, { waitUntil: 'networkidle' });
                    await page.fill('input[type="password"]', adminKey);
                    await page.click('button:has-text("접속")');
                    await page.getByRole('button', { name: /^항공권·수집/ }).click({ timeout: 60_000 });
                    const section = page.locator('#operations-sources');
                    await section.waitFor();
                    const cards = section.locator('article');
                    assert.equal(await cards.count(), 6, `${scenario}/${name}: six agencies`);
                    const axes = await cards.evaluateAll(nodes => nodes.map(card => [...card.querySelectorAll('[data-slot-bar]')].map(bar => bar.getAttribute('data-slot-at'))));
                    assert.equal(axes[0].length, 16);
                    axes.forEach(axis => assert.deepEqual(axis, axes[0], 'all 16 slots align'));
                    const geometry = await section.locator('[data-slot-bar]').evaluateAll(nodes => nodes.map(node => {
                        const parent = node.getBoundingClientRect();
                        const bar = node.querySelector('i')!.getBoundingClientRect();
                        return { bar: bar.height, slot: parent.height, width: bar.width };
                    }));
                    assert.ok(geometry.every(g => g.width > 0 && g.bar > 0 && g.bar <= g.slot + 1), 'bars stay inside shared chart height');
                    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
                    const open = async (target: Locator) => {
                        if (name === 'desktop') await target.hover(); else await target.tap();
                        const tooltip = target.locator('[role="tooltip"]');
                        await tooltip.waitFor({ state: 'visible' });
                        const box = await tooltip.boundingBox();
                        assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y >= 0, 'tooltip fits viewport');
                        return tooltip;
                    };
                    for (const index of [0, 4, 7, 10, 13, 15]) {
                        const target = cards.first().locator('[data-slot-bar]').nth(index);
                        await open(target);
                        if (name === 'mobile') {
                            await target.tap();
                            await target.locator('[role="tooltip"]').waitFor({ state: 'hidden' });
                        }
                    }
                    let target = cards.first().locator('[data-slot-bar]').last();
                    if (scenario === 'FIXTURE') {
                        const latest = await cards.evaluateAll(nodes => nodes.map(card => card.querySelector('[data-slot-bar]:last-child')?.getAttribute('data-slot-status')));
                        assert.deepEqual(latest, ['running', 'pending', 'manual', 'skipped', 'failed', 'unscheduled']);
                        const manual = cards.nth(2).locator('[data-slot-status="manual"]');
                        assert.equal(await manual.count(), 2);
                        const heights = await manual.locator('i').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
                        assert.ok(heights[1] > heights[0] * 3.5, 'manual 100/400 counts scale, not fixed markers');
                        target = manual.last();
                        const manualTip = await open(target);
                        assert.match(await manualTip.innerText(), /수동 확인 400건/);
                        assert.match(await manualTip.innerText(), /자동 수집 실패.*수동 캡처/s);
                        await page.screenshot({ path: path.join(outDir, `${scenario}-${name}-manual.png`) });
                        const failureTip = await open(cards.nth(4).locator('[data-slot-bar]').last());
                        assert.match(await failureTip.innerText(), /보존된 노출 42건/);
                        assert.match(await failureTip.innerText(), /PC response unavailable/);
                        assert.doesNotMatch(await failureTip.innerText(), /수집 42건/);
                        const skipTip = await open(cards.nth(3).locator('[data-slot-bar]').last());
                        assert.match(await skipTip.innerText(), /차단 휴식/);
                    }
                    const tooltip = await open(target);
                    results.push(`${scenario}/${name}: 6 cards × 16 aligned slots; bounded bars/tooltips; ${await target.getAttribute('data-slot-status')}`);
                    await section.screenshot({ path: path.join(outDir, `${scenario}-${name}-section.png`) });
                    await page.screenshot({ path: path.join(outDir, `${scenario}-${name}-viewport.png`) });
                    if (name === 'mobile') {
                        await section.locator('h2').first().tap();
                        await tooltip.waitFor({ state: 'hidden' });
                    } else {
                        await target.focus();
                        await target.press('Escape');
                        await tooltip.waitFor({ state: 'hidden' });
                        await target.press('Enter');
                        await tooltip.waitFor({ state: 'visible' });
                        await target.press('Escape');
                        await tooltip.waitFor({ state: 'hidden' });
                    }
                    assert.deepEqual(errors, [], 'no browser runtime errors');
                } finally { await context.close(); }
            }
        }
        fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ baseUrl, checkedAt: new Date().toISOString(), realCacheTimestamp: real.timestamp, results }, null, 2));
        console.log(results.join('\n'));
        console.log(`Screenshots and results: ${outDir}`);
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
