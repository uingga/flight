// GA4 Analytics 유틸리티
// 참고: NEXT_PUBLIC_GA_ID 환경변수가 설정되지 않으면 이벤트가 발송되지 않습니다.

declare global {
    interface Window {
        gtag?: (...args: unknown[]) => void;
    }
}

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || '';

/** GA4 페이지뷰 */
export const pageview = (url: string) => {
    if (!GA_ID || !window.gtag) return;
    window.gtag('config', GA_ID, { page_path: url });
};

/** GA4 커스텀 이벤트 */
export const event = (action: string, params?: Record<string, string | number | boolean>) => {
    if (!GA_ID || !window.gtag) return;
    window.gtag('event', action, params);
};

// ── 사전 정의 이벤트 헬퍼 ──

/** 예약 클릭 */
export const trackBookingClick = (source: string, route: string, price: number) => {
    event('booking_click', {
        travel_agency: source,
        route,
        price,
        currency: 'KRW',
    });
};

/** 항공권 공유 */
export const trackShare = (route: string, method: string) => {
    event('share_flight', {
        route,
        share_method: method, // 'native_share' | 'clipboard'
    });
};

/** 가격 알림 설정 */
export const trackAlertSetup = (route: string, maxPrice?: number) => {
    event('alert_setup', {
        route,
        ...(maxPrice ? { target_price: maxPrice } : {}),
    });
};

/** 가격 비교 링크 클릭 (네이버/스카이스캐너) */
export const trackCompareClick = (provider: 'naver' | 'skyscanner', route: string, price: number) => {
    event('compare_click', {
        provider,
        route,
        price,
        currency: 'KRW',
    });
};
