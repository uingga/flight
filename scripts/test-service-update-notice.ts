import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isServiceUpdateNoticeActive, SERVICE_UPDATE_NOTICE as notice, SERVICE_UPDATE_NOTICE_KEY, SERVICE_UPDATE_NOTICE_END } from '../src/lib/service-update-notice';
import { watchAnnouncement, isAnnouncementActive, type AnnouncementNotice } from '../src/lib/announcement-notice';
const end = Date.parse('2026-09-19T06:00:00+09:00');
const expiringNotice = { ...notice, endsAt: end };

test('data recovery notice remains active until explicitly withdrawn', () => {
    assert.equal(SERVICE_UPDATE_NOTICE_END, null);
    assert.equal(isServiceUpdateNoticeActive(Date.parse('2026-09-23T00:00:00Z')), true);
    assert.equal(isServiceUpdateNoticeActive(Date.parse('2027-01-01T00:00:00Z')), true);
    assert.equal(SERVICE_UPDATE_NOTICE_KEY, 'tikitikit-service-update-20260923-flight-data-recovery-v1');
    assert.equal(notice.title, '항공권 데이터 복구 중입니다');
    assert.match(notice.body, /새 항공권 반영이 지연/);
    assert.match(notice.body, /판매가 끝난 표/);
    assert.match(notice.body, /최종 가격/);
});
test('dated expiry boundary and invalid dates retain fail-closed behavior', () => {
    assert.equal(isAnnouncementActive(expiringNotice, end - 1), true);
    assert.equal(isAnnouncementActive(expiringNotice, end), false);
    assert.equal(isAnnouncementActive({ endsAt: NaN }, end), false);
    assert.equal(isAnnouncementActive(notice, NaN), false);
});
function fixture(stored: string | null = null, fails = false, initial = end - 1, testedNotice: AnnouncementNotice = expiringNotice) {
    let now = initial, open = false;
    let timer: (() => void) | undefined;
    let listener: (() => void) | undefined;
    const stop = watchAnnouncement(testedNotice, value => { open = value; }, {
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
test('undated notice needs no expiry timer and respects dismissal', () => {
    const undatedNotice = { ...notice, endsAt: null };
    const f = fixture(null, false, end, undatedNotice);
    assert.equal(f.open, true); assert.equal(f.timer, undefined); assert.equal(f.listener, undefined); f.stop();
    const dismissed = fixture('dismissed', false, end, undatedNotice);
    assert.equal(dismissed.open, false); dismissed.stop();
    const blockedStorage = fixture(null, true, end, undatedNotice);
    assert.equal(blockedStorage.open, true); blockedStorage.stop();
});
test('old notice dismissal does not hide new recovery notice', () => {
    const stored = new Map([['tikitikit-service-update-20260919-modetour-maintenance-v1', 'dismissed']]);
    let open = false;
    const stop = watchAnnouncement(notice, value => { open = value; }, {
        localStorage: { getItem: (key: string) => stored.get(key) ?? null },
        setTimeout: () => 1,
        clearTimeout: () => {},
    } as unknown as Window, {
        addEventListener: () => {},
        removeEventListener: () => {},
    } as unknown as Document, () => Date.parse('2026-09-23T00:00:00Z'));
    assert.equal(open, true); stop();
});
