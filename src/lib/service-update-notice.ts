import { type AnnouncementNotice, isAnnouncementActive } from './announcement-notice';

// Keep the key stable so existing dismissals are respected.
export const SERVICE_UPDATE_NOTICE_KEY = 'tikitikit-service-update-20260901-fuel-surcharge-v2';
export const SERVICE_UPDATE_NOTICE_END = Date.parse('2026-09-20T00:00:00+09:00');

export function isServiceUpdateNoticeActive(now = Date.now()): boolean {
    return isAnnouncementActive(SERVICE_UPDATE_NOTICE, now);
}

export const SERVICE_UPDATE_NOTICE: AnnouncementNotice = {
    id: 'fuel-surcharge-20260901-v2',
    storageKey: SERVICE_UPDATE_NOTICE_KEY,
    endsAt: SERVICE_UPDATE_NOTICE_END,
    eyebrow: '9월 발권 안내',
    title: '⛽ 9월 유류할증료가 올랐어요',
    body: '항공유 가격 상승으로 국내선·국제선 모두 4개월 만에 인상됐어요. 9월 1일 이후 발권분에 적용되며, 항공사·노선별 금액은 예약 단계에서 확인해 주세요.',
};
