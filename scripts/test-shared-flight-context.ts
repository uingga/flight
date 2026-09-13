import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { findSharedFlight, flightScheduleToken, prioritizeSharedPrice, readSharedContext,
    sharedCity, sharedDeparture, writeSharedContext } from '../src/lib/shared-flight-context';
import type { Flight } from '../src/types/flight';

const seed: Flight = {
    id: 'modetour-CHI-20107439', source: 'modetour', airline: '진에어',
    departure: { city: '부산', airport: 'PUS', date: '2026-09-30', time: '13:35' },
    arrival: { city: '타이중', airport: 'RMQ', date: '2026-10-04', time: '02:40' },
    price: 258000, currency: 'KRW', availableSeats: 10, region: '중국', link: 'https://example.invalid/booking',
};
const alternate = { ...seed, id: 'same-price-other-date', departure: { ...seed.departure, date: '2026-10-02' }, arrival: { ...seed.arrival, date: '2026-10-06' } };
const fixtures = [
    { ...seed, id: 'cheaper', price: 200000 }, seed, alternate,
    { ...seed, id: 'dearer', price: 300000 },
    { ...seed, id: 'other-city', arrival: { ...seed.arrival, city: '오사카', airport: 'KIX' } },
    { ...seed, id: 'other-departure', departure: { ...seed.departure, city: '인천', airport: 'ICN' } },
];
const token = flightScheduleToken(seed);
assert.equal(findSharedFlight([seed, { ...alternate, id: seed.id }], seed.id, flightScheduleToken(alternate))?.departure.date, alternate.departure.date);
assert.equal(findSharedFlight([seed], seed.id, 'not-the-same-schedule'), undefined);
assert.equal(sharedDeparture('김해(PUS)'), '부산/김해');
assert.equal(sharedCity('화련'), sharedCity('화롄'));
assert.deepEqual(prioritizeSharedPrice(fixtures.slice(0, 4), 258000, f => f.price).map(f => f.id), [seed.id, alternate.id, 'cheaper', 'dearer']);
const params = new URLSearchParams('utm_source=threads');
const context = { departure: '부산/김해', arrival: '타이중', price: 258000 };
writeSharedContext(params, context);
assert.deepEqual(readSharedContext(params), context);
assert.equal(readSharedContext(new URLSearchParams('sharePrice=258000')), null);
assert.equal(params.get('utm_source'), 'threads');
console.log('PASS helper: strict schedule, city aliases, stable ordering, scoped URL persistence');

async function main() {
    const payload = { success: true, flights: fixtures, lastUpdated: new Date().toISOString() };
    const api = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)); });
    await new Promise<void>(resolve => api.listen(3140, '127.0.0.1', resolve));
    const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3139', '-H', '127.0.0.1'], {
        env: { ...process.env, NEXT_PUBLIC_BASE_URL: 'http://127.0.0.1:3140', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', NEXT_TELEMETRY_DISABLED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let logs = '';
    server.stdout.on('data', data => { logs += data; });
    server.stderr.on('data', data => { logs += data; });
    const browser = await chromium.launch({ headless: true });
    const origin = 'http://localhost:3139';
    try {
        for (let attempt = 0; attempt < 60; attempt++) {
            if (logs.includes('Ready in')) break;
            if (server.exitCode !== null) throw new Error(logs);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        for (const width of [390, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            page.setDefaultTimeout(20000);
            page.on('pageerror', error => console.error('PAGE ERROR', error.message));
            await page.addInitScript(() => localStorage.setItem('tikitikit-service-update-20260901-fuel-surcharge-v2', 'dismissed'));
            await page.route('**/*', route => {
                const url = new URL(route.request().url());
                if (url.origin !== origin) return route.abort();
                if (url.pathname.startsWith('/api/')) return route.fulfill({ json: url.pathname === '/api/flights' ? payload : { success: true } });
                return route.continue();
            });
            const campaign = 'utm_source=threads&utm_medium=social&utm_campaign=context-test&utm_content=posted&utm_term=route';
            const detail = page.locator('[role="dialog"][aria-label="항공권 상세"]');
            const ids = () => page.locator('article[data-flight-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-flight-id')));
            const expectList = async () => {
                await page.waitForFunction(() => document.querySelectorAll('article[data-flight-id]').length === 4);
                const actual = await ids();
                assert.deepEqual(new Set(actual.slice(0, 2)), new Set([seed.id, alternate.id]), `${width}: same-price first: ${actual}`);
                assert.deepEqual(new Set(actual), new Set(fixtures.slice(0, 4).map(f => f.id)));
                const url = new URL(page.url());
                for (const [key, value] of new URLSearchParams(campaign)) assert.equal(url.searchParams.get(key), value);
                assert.equal(url.searchParams.get('from'), null);
                assert.equal(url.searchParams.get('to'), null);
            };
            await page.goto(`${origin}/s/x${seed.id}?${campaign}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
            try { await detail.waitFor({ timeout: 45000 }); }
            catch (error) { console.error('FAILED PAGE', page.url(), (await page.content()).slice(-5000)); throw error; }
            assert.equal(new URL(page.url()).searchParams.get('schedule'), token);
            await expectList();
            await page.reload();
            await detail.waitFor();
            assert.equal(new URL(page.url()).searchParams.get('schedule'), token);
            await page.goBack();
            await detail.waitFor({ state: 'hidden' });
            await expectList();
            await page.goForward();
            await detail.waitFor();
            assert.equal(new URL(page.url()).searchParams.get('schedule'), token);
            const browseMore = detail.getByRole('button', { name: '안 살 거지만 더 보기' });
            assert.equal(await browseMore.count(), 0, 'Browse-more belongs to the list, not the detail');
            await detail.getByRole('button', { name: '닫기', exact: true }).click();
            await detail.waitFor({ state: 'hidden' });
            await expectList();
            assert.equal(new URL(page.url()).searchParams.get('flight'), null);
            await page.goForward();
            await detail.waitFor();
            assert.equal(new URL(page.url()).searchParams.get('schedule'), token);
            await detail.getByRole('button', { name: '닫기', exact: true }).click();
            await detail.waitFor({ state: 'hidden' });
            await page.reload();
            await expectList();
            await page.locator(`article[data-flight-id="${alternate.id}"] button`).first().click();
            await detail.waitFor();
            assert.equal(new URL(page.url()).searchParams.get('schedule'), flightScheduleToken(alternate));
            await page.goBack();
            await detail.waitFor({ state: 'hidden' });
            await expectList();
            await page.getByRole('button', { name: '항공권 정렬', exact: true }).click();
            await page.getByRole('button', { name: '낮은 가격순', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('article[data-flight-id]')?.getAttribute('data-flight-id') === 'cheaper');
            // A copied, fully resolved shared URL also gets a list behind its detail,
            // without resetting the user's explicit price sort on reload/back.
            const copied = new URL(page.url());
            copied.searchParams.set('flight', seed.id);
            copied.searchParams.set('schedule', token);
            await page.goto(copied.href);
            await detail.waitFor();
            await page.goBack();
            await detail.waitFor({ state: 'hidden' });
            await page.reload();
            await page.waitForFunction(() => document.querySelector('article[data-flight-id]')?.getAttribute('data-flight-id') === 'cheaper');
            assert.equal(new URL(page.url()).searchParams.get('sort'), 'price');
            await page.goto(origin);
            await page.waitForFunction(() => document.querySelectorAll('article[data-flight-id]').length === 6);
            assert.equal(new URL(page.url()).searchParams.get('shared'), null);
            await page.locator(`article[data-flight-id="${seed.id}"] button`).first().click();
            await detail.waitFor();
            assert.equal(await browseMore.count(), 0, 'Ordinary home details must not gain a shared-entry CTA');
            await detail.getByRole('button', { name: '닫기', exact: true }).click();
            await detail.waitFor({ state: 'hidden' });
            await page.goto(`${origin}/?dep=부산&sort=price&max=250000&${campaign}`);
            await page.waitForFunction(() => document.querySelectorAll('article[data-flight-id]').length === 1);
            assert.deepEqual(await ids(), ['cheaper']);
            assert.equal(new URL(page.url()).searchParams.get('shared'), null);
            await page.goto(`${origin}/s/x${seed.id}?schedule=invalid&${campaign}`);
            await page.waitForURL(url => url.pathname === '/', { timeout: 60000 });
            await page.waitForFunction(() => !new URL(location.href).searchParams.has('flight'));
            assert.equal(await detail.count(), 0, 'Do not open a different schedule on mismatch');
            console.log(`PASS ${width}px: redirect chain, exact detail, route/price context, UTM, browse CTA, close, back/forward, reload, alternate date, explicit sort, ordinary detail without CTA, ordinary filters, missing schedule`);
            await page.close();
        }
    } catch (error) { console.error(logs.slice(-6000)); throw error; }
    finally { await browser.close(); server.kill(); api.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
