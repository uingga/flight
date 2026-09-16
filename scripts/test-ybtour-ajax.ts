import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { waitForAction } from '../src/lib/scrapers/ybtour-ajax';
import { YbtourRecoverableActionError } from '../src/lib/scrapers/ybtour-interaction';
import { SourceResponseError } from '../src/lib/scrapers/source-response';

function fixture(status = 200, body = 'fares') {
    const events = new EventEmitter();
    const request = { url: () => 'https://fly.ybtour.co.kr/booking/findDiscountAir.lts',
        method: () => 'POST', postData: () => 'efcCityCode=SHI', failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET' }) };
    const response = { request: () => request, ok: () => status === 200, status: () => status,
        text: async () => body, url: request.url };
    const page = Object.assign(events, { url: request.url, locator: () => ({ innerText: async () => body }),
        waitForResponse: (predicate: (r: any) => boolean, { timeout }: { timeout: number }) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => { events.off('response', listener); reject(Error('timeout')); }, timeout);
            const listener = (r: any) => { if (predicate(r)) { clearTimeout(timer); events.off('response', listener); resolve(r); } };
            events.on('response', listener);
        }),
    }) as unknown as Page;
    const run = (click: () => Promise<void>) => waitForAction(page, '/booking/findDiscountAir.lts', { efcCityCode: 'SHI' }, click, 80);
    return { events, request, response, run };
}

test('slow response is awaited without sending a second request', async () => {
    const f = fixture(); let clicks = 0;
    await f.run(async () => { clicks++; f.events.emit('request', f.request); setTimeout(() => f.events.emit('response', f.response), 55); });
    assert.equal(clicks, 1);
    assert.equal(f.events.listenerCount('request'), 0);
    assert.equal(f.events.listenerCount('requestfailed'), 0);
});
test('no request and confirmed network failure allow bounded city recovery', async () => {
    for (const sent of [false, true]) {
        const f = fixture();
        await assert.rejects(f.run(async () => { if (sent) { f.events.emit('request', f.request); f.events.emit('requestfailed', f.request); } }), YbtourRecoverableActionError);
    }
});
test('pending request never becomes eligible for replay', async () => {
    const f = fixture();
    await assert.rejects(f.run(async () => { f.events.emit('request', f.request); }), error => {
        assert.ok(error instanceof Error); assert.match(error.message, /response_pending/);
        assert.equal(error instanceof YbtourRecoverableActionError, false); return true;
    });
});
test('access restrictions never become recoverable UI errors', async () => {
    for (const status of [403, 429]) {
        const f = fixture(status);
        await assert.rejects(f.run(async () => { f.events.emit('request', f.request); f.events.emit('response', f.response); }), SourceResponseError);
    }
});
