import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isServiceUpdateNoticeActive, SERVICE_UPDATE_NOTICE as notice, SERVICE_UPDATE_NOTICE_KEY, SERVICE_UPDATE_NOTICE_END as end } from '../src/lib/service-update-notice';
import { watchAnnouncement } from '../src/lib/announcement-notice';

test('expiry boundary and existing key/content', () => {
    assert.equal(isServiceUpdateNoticeActive(end - 1), true);
    assert.equal(isServiceUpdateNoticeActive(Date.parse('2026-09-19T15:00:00Z')), false);
    assert.equal(isServiceUpdateNoticeActive(end + 86400000), false);
    assert.equal(SERVICE_UPDATE_NOTICE_KEY, 'tikitikit-service-update-20260901-fuel-surcharge-v2');
    assert.match(notice.title, /9월 유류할증료가 올랐어요/);
    assert.doesNotMatch(JSON.stringify(notice), /네이버/);
});
function fixture(stored: string | null = null, fails = false, initial = end - 1) {
    let now = initial, open = false;
    let timer: (() => void) | undefined;
    let listener: (() => void) | undefined;
    const stop = watchAnnouncement(notice, value => { open = value; }, {
        localStorage: { getItem: () => { if (fails) throw Error('blocked'); return stored; } },
        setTimeout: (callback: () => void) => { timer = callback; return 1; },
        clearTimeout: () => { timer = undefined; },
    } as unknown as Window, {
        addEventListener: (_: string, callback: () => void) => { listener = callback; },
        removeEventListener: () => { listener = undefined; },
    } as unknown as Document, () => now);
    return { get open() { return open; }, get timer() { return timer; }, get listener() { return listener; },
        expire: () => { now = end; }, stop };
}
test('open notice expires on timer and cleans up', () => {
    const f = fixture(); assert.equal(f.open, true); f.expire(); f.timer!();
    assert.equal(f.open, false); f.stop(); assert.equal(f.timer, undefined); assert.equal(f.listener, undefined);
});
test('sleeping tab expires on visibility change', () => {
    const f = fixture(); f.expire(); f.listener!(); assert.equal(f.open, false); f.stop();
});
test('dismissed notice stays hidden', () => {
    const f = fixture('dismissed'); assert.equal(f.open, false); f.listener!(); assert.equal(f.open, false); f.stop();
});
test('storage unavailable still allows notice and expiry', () => {
    const f = fixture(null, true); assert.equal(f.open, true); f.expire(); f.timer!(); assert.equal(f.open, false); f.stop();
});
test('expired visits register no timer or listener', () => {
    const f = fixture(null, false, end); assert.equal(f.open, false);
    assert.equal(f.timer, undefined); assert.equal(f.listener, undefined); f.stop();
});
