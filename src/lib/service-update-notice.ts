import { type AnnouncementNotice, isAnnouncementActive } from './announcement-notice';

// This notice stays active until collection and expired-flight cleanup recover.
export const SERVICE_UPDATE_NOTICE_KEY = 'tikitikit-service-update-20260923-flight-data-recovery-v1';
export const SERVICE_UPDATE_NOTICE_END = null;

export function isServiceUpdateNoticeActive(now = Date.now()): boolean {
    return isAnnouncementActive(SERVICE_UPDATE_NOTICE, now);
}

export const SERVICE_UPDATE_NOTICE: AnnouncementNotice = {
    id: 'flight-data-recovery-20260923-v1',
    storageKey: SERVICE_UPDATE_NOTICE_KEY,
    endsAt: SERVICE_UPDATE_NOTICE_END,
    eyebrow: '항공권 정보 안내',
    title: '항공권 데이터 복구 중입니다',
    body: '새 항공권 반영이 지연되고, 판매가 끝난 표가 목록에 남아 있거나 가격이 다를 수 있습니다. 예약 전 여행사 페이지에서 판매 여부와 최종 가격을 확인해 주세요.',
};
