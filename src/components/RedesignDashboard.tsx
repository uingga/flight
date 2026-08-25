'use client';

import MobileRedesignPreview from '@/app/preview/mobile-redesign/MobileRedesignPreview';

/**
 * 운영 메인 교체용 진입점.
 * 미리보기 전용 안내와 미리보기 경로 링크를 숨기고 실제 홈 동작을 사용한다.
 */
export default function RedesignDashboard() {
    return <MobileRedesignPreview previewMode={false} />;
}
