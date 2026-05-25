/**
 * 모바일 URL 관련 유틸리티
 * Dashboard.tsx에서 추출
 */

// 모바일 여부 체크
export const checkIsMobile = () => {
    if (typeof navigator === 'undefined') return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// PC URL → 모바일 URL 변환
export const getMobileUrl = (url: string, isMobile: boolean): string => {
    if (!isMobile || !url) return url;


    // 온라인투어: m.onlinetour.co.kr + /flight/m/ 경로 사용
    if (url.includes('onlinetour.co.kr')) {
        let mobileUrl = url.replace('www.onlinetour.co.kr', 'm.onlinetour.co.kr');
        mobileUrl = mobileUrl.replace('/flight/w/', '/flight/m/');
        mobileUrl = mobileUrl.replace('/dcair/dcairReservation', '/dcair/dcairReservationGuest');
        mobileUrl = mobileUrl.replace('/dcair/dcairList', '/dcair/list');
        return mobileUrl;
    }
    // 모두투어: www.modetour.com → m.modetour.com
    if (url.includes('www.modetour.com')) {
        return url.replace('www.modetour.com', 'm.modetour.com');
    }
    // 하나투어: PC URL 그대로 (모바일 fallback은 href에서 /api/redirect로 처리)
    if (url.includes('hanatour.com')) {
        return url;
    }
    // 노랑풍선: PC URL 파라미터를 모바일 URL에 전달 (도시 탭 선택)
    if (url.includes('fly.ybtour.co.kr')) {
        try {
            const parsed = new URL(url);
            const mobileUrl = new URL('https://mfly.ybtour.co.kr/mobile/fr/booking/findDiscountAirMobile.lts');
            mobileUrl.searchParams.set('efcTpCode', 'INV');
            mobileUrl.searchParams.set('efcCode', 'INV');
            for (const key of ['efcBannerCode', 'inhId', 'depDate', 'efcCityCode']) {
                const val = parsed.searchParams.get(key);
                if (val) mobileUrl.searchParams.set(key, val);
            }
            return mobileUrl.toString();
        } catch {
            return 'https://mfly.ybtour.co.kr/mobile/fr/booking/findDiscountAirMobile.lts?efcTpCode=INV&efcCode=INV';
        }
    }
    // 땡처리닷컴: www.ttang.com → m.ttang.com
    if (url.includes('www.ttang.com')) {
        return url.replace('www.ttang.com', 'm.ttang.com');
    }
    return url;
};
