/** Local-only UI regression: every API request is intercepted; no real selection or credentials. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:3489';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'This mock test is local-only');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-overview-qa-'));
const sources = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip'];
const now = '2026-09-07T14:50:00+09:00';
const activity = { visitors: 120, detailOpenUsers: 40, bookingClickUsers: 12, alertSetupUsers: 0, bookingClickRate: 10, detailToBookingRate: 30, detailOpenRate: 33.3 };
const admin = {
    timestamp: now, totalFlights: 60, bySource: Object.fromEntries(sources.map(s => [s, 10])),
    byRegion: {}, byCity: {}, byAirline: {}, byDepartureCity: {}, avgPriceBySource: {}, priceByRegion: {}, cheapest: [],
    sourceUpdatedAt: Object.fromEntries(sources.map(s => [s, now])),
    crawlHistory: [{ timestamp: now, sites: Object.fromEntries(sources.map(s => [s, { total: 10, scraped: 20 }])), alerts: [] }],
    crawlScheduleHealth: { status: 'healthy', lastCompletedAt: now, expectedAt: now, delayMinutes: 0, pendingSlots: 0 },
    naverStatus: { lastCrawledAt: now, freshEntries: 10 },
};
const candidates = Array.from({ length: 35 }, (_, i) => ({
    id: `fixture-flight-${i + 1}`, rank: i + 1, departureCity: '인천', arrivalCity: i === 34 ? '광저우' : `도시${i + 1}`,
    departureDate: '2026-09-20', returnDate: '2026-09-24', effectivePrice: 200000 + i * 1000,
    naverLowest: null, naverDifference: null, recommendationTier: 3, selected: false,
}));

async function main() {
    const browser = await chromium.launch();
    try {
        for (const width of [1440, 390, 320]) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
            const page = await context.newPage();
            const errors: string[] = [];
            page.on('pageerror', e => errors.push(e.message));
            let payload: { available: boolean; message: string | null; current: object | null; candidates: typeof candidates } = { available: true, message: null, current: null, candidates };
            let getFails = false;
            let saveFails = true;
            let posts = 0;
            let holdGet = false;
            let releaseGet: (() => void) | undefined;
            await page.clock.setFixedTime(new Date(now));
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.origin !== new URL(base).origin) return route.abort();
                if (!url.pathname.startsWith('/api/')) return route.continue();
                if (url.pathname === '/api/crawl-log') return route.fulfill({ json: admin });
                if (url.pathname === '/api/ga-stats') return route.fulfill({ json: { available: true, periods: { today: { sessions: 150 } }, activityPeriods: { today: activity, recent7: activity, current: activity } } });
                if (url.pathname === '/api/admin-today-pick') {
                    if (route.request().method() === 'POST') {
                        posts += 1;
                        const body = route.request().postDataJSON();
                        assert.equal(body.key, 'mock-only');
                        if (saveFails) return route.fulfill({ status: 409, json: { error: '모의 저장 실패' } });
                        const candidate = candidates.find(c => c.id === body.flightId)!;
                        payload = { ...payload, current: { ...candidate, selectionMode: 'manual' }, candidates: candidates.map(c => ({ ...c, selected: c.id === candidate.id })) };
                        return route.fulfill({ json: { current: payload.current, message: '모의 선정 완료' } });
                    }
                    if (holdGet) await new Promise<void>(resolve => { releaseGet = resolve; });
                    return route.fulfill(getFails ? { status: 503, json: { error: '모의 조회 실패' } } : { json: payload });
                }
                return route.fulfill({ status: 503, json: { error: '모의 환경: 별도 지표 없음' } });
            });
            await page.goto(`${base}/admin?key=mock-only`);
            let summary = page.locator('#overview-tikit-drop');
            await summary.getByText('오늘 선정된 항공권이 없습니다.').waitFor();
            assert.equal(await summary.locator('article').count(), 0, 'initial overview has no candidates');
            const summaryBox = await summary.boundingBox();
            const performanceBox = await page.locator('#overview-performance').boundingBox();
            assert.ok(summaryBox && performanceBox && Math.abs(summaryBox.width - performanceBox.width) < 2, JSON.stringify({ summaryBox, performanceBox, width }));
            const order = await page.locator('#overview-actions, #overview-performance, #overview-tikit-drop').evaluateAll(nodes => nodes.map(n => n.id));
            assert.deepEqual(order, ['overview-actions', 'overview-performance', 'overview-tikit-drop']);
            await page.locator('#overview-performance').getByText('120명').waitFor();

            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'overview fits width');
            await page.screenshot({ path: path.join(out, `overview-${width}.png`), fullPage: true });
            assert.equal(await summary.getByRole('button', { name: '선정·변경', exact: true }).count(), 0);
            await summary.getByRole('button', { name: '노출순서에서 관리' }).click();
            summary = page.locator('#flight-order-tikit-drop');
            await summary.getByText('오늘 선정된 항공권이 없습니다.').waitFor();
            const placement = await page.locator('#flight-order-tikit-drop').evaluate(el =>
                !!el.nextElementSibling?.matches('[aria-label="항공권 노출 순서 편집"]'));
            assert.ok(placement, 'today selection is before the existing order editor');
            await page.screenshot({ path: path.join(out, `order-${width}.png`), fullPage: true });
            const open = () => summary.getByRole('button', { name: '선정·변경', exact: true }).click();
            await open();
            const dialog = page.getByRole('dialog', { name: 'TIKIT DROP 선정·변경', exact: true });
            const rows = dialog.locator('article');
            const search = dialog.getByLabel('항공권 찾기');
            const next = dialog.getByRole('button', { name: '다음', exact: true });
            const previous = dialog.getByRole('button', { name: '이전', exact: true });
            await dialog.waitFor();
            assert.equal(await rows.count(), 10);
            await next.click(); await next.click(); await next.click();
            assert.equal(await rows.count(), 5, 'last page retains all 35 candidates');
            assert.ok(await next.isDisabled());
            await previous.click(); assert.equal(await rows.count(), 10);
            await search.fill('광저우');
            await dialog.getByText('1 / 1 페이지').waitFor();
            assert.equal(await rows.count(), 1, 'search includes candidates beyond former top 30');
            page.once('dialog', d => d.dismiss());
            await rows.getByRole('button', { name: '선정', exact: true }).click();
            assert.equal(posts, 0, 'cancel does not POST');
            page.once('dialog', d => { assert.match(d.message(), /인천 → 광저우/); return d.accept(); });
            await rows.getByRole('button', { name: '선정', exact: true }).click();
            await dialog.getByRole('alert').filter({ hasText: '모의 저장 실패' }).waitFor();
            saveFails = false;
            page.once('dialog', d => d.accept());
            await rows.getByRole('button', { name: '선정', exact: true }).click();
            await dialog.getByText('모의 선정 완료').waitFor();
            assert.ok(await rows.getByRole('button', { name: '선정됨' }).isDisabled());
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'hidden' });
            await summary.getByText('인천 → 광저우').waitFor();
            assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.textContent?.trim()), '선정·변경');
            await page.getByRole('button', { name: /^(오늘 지금 볼 것|오늘)$/ }).click();
            await page.locator('#overview-tikit-drop').getByText('인천 → 광저우').waitFor();
            assert.equal(await page.getByRole('button', { name: '선정·변경', exact: true }).count(), 0);
            await page.locator('#overview-tikit-drop').getByRole('button', { name: '노출순서에서 관리' }).click();
            await open();
            await dialog.waitFor();
            assert.equal(await search.inputValue(), '');
            assert.equal(await rows.count(), 10);
            await search.fill('없는목적지');
            await dialog.getByText('검색 조건에 맞는 항공권이 없습니다.').waitFor();
            await search.fill('');
            await page.screenshot({ path: path.join(out, `panel-${width}.png`) });
            const box = await dialog.boundingBox();
            assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 901, 'dialog fits viewport');
            assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'no dialog overflow');
            await next.focus(); await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '선정 패널 닫기', 'Tab wraps within panel');
            await dialog.getByRole('button', { name: '선정 패널 닫기' }).click();
            await dialog.waitFor({ state: 'hidden' });
            await open(); await dialog.waitFor();
            await page.goBack(); await dialog.waitFor({ state: 'hidden' });
            await open(); await dialog.waitFor();
            await page.mouse.click(2, 2); await dialog.waitFor({ state: 'hidden' });
            getFails = true;
            await page.reload();
            await summary.getByText('모의 조회 실패').waitFor();
            await open(); await dialog.waitFor();
            getFails = false;
            payload = { available: false, message: '모의 권한: 선정 불가', current: null, candidates };
            await dialog.getByRole('button', { name: '새로고침', exact: true }).click();
            await dialog.getByText('모의 권한: 선정 불가').waitFor();
            assert.ok(await rows.first().getByRole('button', { name: '선정', exact: true }).isDisabled());
            payload = { available: true, message: null, current: null, candidates: [] };
            await dialog.getByRole('button', { name: '새로고침', exact: true }).click();
            await dialog.getByText('현재 선정 가능한 항공권이 없습니다.').waitFor();
            assert.equal(posts, 2);
            holdGet = true;
            await page.reload({ waitUntil: 'domcontentloaded' });
            await summary.getByText('선정 상태를 불러오는 중입니다.').waitFor();
            assert.ok(releaseGet);
            holdGet = false;
            releaseGet();
            await summary.getByText('오늘 선정된 항공권이 없습니다.').waitFor();
            assert.deepEqual(errors, []);
            await context.close();
            console.log(`${width}px: overview/order/metrics/search/pagination/confirm/cancel/failure/success/reopen/focus/backdrop/back/empty/unavailable passed`);
        }
    } finally { await browser.close(); }
    console.log(`Screenshots: ${out}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
