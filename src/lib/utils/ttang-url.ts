import { Flight } from '@/types/flight';

export interface TtangPassengers {
    adult: number;
    child: number;
    infant: number;
}

export function getTtangBookingUrl(flight: Flight, pax: TtangPassengers): string {
    const dateParam = (value: string | undefined) => {
        const digits = value?.replace(/\D/g, '').slice(0, 8) || '';
        return digits.length === 8
            ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
            : '';
    };
    const cityName = (city: string | undefined, airport: string | undefined) => {
        const base = city?.replace(/\([^)]+\)/g, '').trim() || '';
        if (airport === 'ICN' && (base === '서울' || base === '인천')) return '인천';
        if (airport === 'GMP' && (base === '서울' || base === '김포')) return '김포';
        return base;
    };

    const depCode = flight.departure.airport || '';
    const arrCode = flight.arrival.airport || '';
    const depDate = dateParam(flight.departure.date);
    const returnDate = dateParam(flight.arrival.date);

    // 크롤러가 저장한 realtime_V2 주소를 우선 사용한다. 노선·왕복 날짜가 모두 들어 있어
    // 같은 출발일의 전체 프로모션 목록이 아니라 해당 여정의 소수 결과만 표시된다.
    const storedUrl = flight.link || flight.searchLink || '';
    if (storedUrl.includes('/ttangair/search/realtime_V2/list.do')) {
        try {
            const url = new URL(storedUrl);
            url.searchParams.set('adt', String(pax.adult));
            url.searchParams.set('chd', String(pax.child));
            url.searchParams.set('inf', String(pax.infant));
            if (depCode) url.searchParams.set('dep0', depCode);
            if (arrCode) url.searchParams.set('arr0', arrCode);
            if (depDate) url.searchParams.set('depdate0', depDate);
            if (arrCode) url.searchParams.set('dep1', arrCode);
            if (depCode) url.searchParams.set('arr1', depCode);
            if (returnDate) url.searchParams.set('depdate1', returnDate);
            url.searchParams.set('dep0Name', cityName(flight.departure.city, depCode));
            url.searchParams.set('arr0Name', cityName(flight.arrival.city, arrCode));
            url.searchParams.set('dep1Name', cityName(flight.arrival.city, arrCode));
            url.searchParams.set('arr1Name', cityName(flight.departure.city, depCode));
            url.searchParams.set('comp', 'Y');
            return url.toString();
        } catch { /* 아래의 재구성 주소 사용 */ }
    }

    if (depCode && arrCode && depDate && returnDate) {
        const params = new URLSearchParams({
            trip: 'RT',
            dep0: depCode,
            arr0: arrCode,
            dep0Name: cityName(flight.departure.city, depCode),
            arr0Name: cityName(flight.arrival.city, arrCode),
            depdate0: depDate,
            dep1: arrCode,
            arr1: depCode,
            dep1Name: cityName(flight.arrival.city, arrCode),
            arr1Name: cityName(flight.departure.city, depCode),
            depdate1: returnDate,
            adt: String(pax.adult),
            chd: String(pax.child),
            inf: String(pax.infant),
            comp: 'Y',
        });
        return `https://mm.ttang.com/ttangair/search/realtime_V2/list.do?${params.toString()}`;
    }

    // 오래된 캐시에 상세 정보가 없을 때만 기존 날짜별 목록으로 안전하게 폴백한다.
    const compactDepDate = depDate.replace(/-/g, '');
    return `https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=${compactDepDate}&adt=${pax.adult}&chd=${pax.child}&inf=${pax.infant}&page=1&scale=200`;
}
