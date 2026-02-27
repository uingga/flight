// GA4 Analytics 유틸리티 + 자체 이벤트 로깅
// GA4: NEXT_PUBLIC_GA_ID 환경변수 필요
// 자체 로깅: /api/analytics로 이벤트 전송

declare global {
    interface Window {
        gtag?: (...args: unknown[]) => void;
    }
}

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || '';

/** 서버로 이벤트 전송 (비동기, 실패 무시) */
const logToServer = (data: Record<string, string | number | undefined>) => {
    try {
        fetch('/api/analytics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }).catch(() => { });
    } catch { }
};

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
    event('booking_click', { travel_agency: source, route, price, currency: 'KRW' });
    logToServer({ type: 'booking_click', source, route, price });
};

/** 항공권 공유 */
export const trackShare = (route: string, method: string) => {
    event('share_flight', { route, share_method: method });
    logToServer({ type: 'share', route, method });
};

/** 가격 알림 설정 */
export const trackAlertSetup = (route: string, maxPrice?: number) => {
    event('alert_setup', { route, ...(maxPrice ? { target_price: maxPrice } : {}) });
    logToServer({ type: 'alert_setup', route, price: maxPrice });
};

/** 가격 비교 링크 클릭 (네이버/스카이스캐너) */
export const trackCompareClick = (provider: 'naver' | 'skyscanner', route: string, price: number) => {
    event('compare_click', { provider, route, price, currency: 'KRW' });
    logToServer({ type: 'compare_click', provider, route, price });
};

/** 항공권 카드 클릭 */
export const trackCardClick = (route: string, price: number, airline: string, source: string) => {
    event('card_click', { route, price, airline, source, currency: 'KRW' });
    logToServer({ type: 'card_click', route, price, airline, source });
};

/** 출발지 필터 변경 */
export const trackFilterChange = (filterType: string, value: string) => {
    event('filter_change', { filter_type: filterType, filter_value: value });
};

/** 날짜 필터 변경 */
export const trackDateFilter = (startDate: string, endDate: string) => {
    event('date_filter', { start_date: startDate, end_date: endDate });
};
