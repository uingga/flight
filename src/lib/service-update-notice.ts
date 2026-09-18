import { type AnnouncementNotice, isAnnouncementActive } from './announcement-notice';

// New notice: dismissing the previous fuel notice must not hide this one.
export const SERVICE_UPDATE_NOTICE_KEY = 'tikitikit-service-update-20260919-modetour-maintenance-v1';
// Display cutoff requested by the operator; not a confirmed maintenance end time.
export const SERVICE_UPDATE_NOTICE_END = Date.parse('2026-09-19T06:00:00+09:00');

export function isServiceUpdateNoticeActive(now = Date.now()): boolean {
    return isAnnouncementActive(SERVICE_UPDATE_NOTICE, now);
}

export const SERVICE_UPDATE_NOTICE: AnnouncementNotice = {
    id: 'modetour-maintenance-20260919-v1',
    storageKey: SERVICE_UPDATE_NOTICE_KEY,
    endsAt: SERVICE_UPDATE_NOTICE_END,
    eyebrow: '여행사 접속 안내',
    title: '모두투어 점검 안내',
    body: '모두투어 홈페이지 점검으로 접속 및 예약이 원활하지 않을 수 있어요. 모두투어 항공권 예약 페이지가 열리지 않으면 잠시 후 다시 이용해 주세요.',
};
