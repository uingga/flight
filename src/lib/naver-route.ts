export interface ExactRouteAirports {
    outboundDeparture: string;
    outboundArrival: string;
    returnDeparture: string;
    returnArrival: string;
}

interface NaverComparableFlight {
    source?: string;
    departure?: { airport?: string };
    arrival?: { airport?: string };
    routeAirports?: Partial<ExactRouteAirports>;
}

const normalizeAirport = (value: unknown): string | null => {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : null;
};

export const normalizeComparisonDate = (value: unknown): string => String(value || '')
    .replace(/\(.*\)/g, '')
    .replace(/\./g, '-')
    .trim()
    .substring(0, 10);

/**
 * 네이버와 비교할 실제 네 구간 공항을 반환한다.
 *
 * 마이리얼트립의 Calendar API는 SHA처럼 실제 공항이 아닌 도시 코드를 줄 수 있다.
 * 따라서 마이리얼트립과 온라인투어는 예약/상품 응답에서 확인한 routeAirports가 없으면 비교하지 않는다.
 * 다른 여행사는 기존 데이터 구조가 실제 왕복 공항을 뜻하므로 대칭 왕복으로 해석한다.
 */
export function getExactRouteAirports(flight: NaverComparableFlight): ExactRouteAirports | null {
    if (flight.routeAirports) {
        const outboundDeparture = normalizeAirport(flight.routeAirports.outboundDeparture);
        const outboundArrival = normalizeAirport(flight.routeAirports.outboundArrival);
        const returnDeparture = normalizeAirport(flight.routeAirports.returnDeparture);
        const returnArrival = normalizeAirport(flight.routeAirports.returnArrival);
        if (!outboundDeparture || !outboundArrival || !returnDeparture || !returnArrival) return null;
        return { outboundDeparture, outboundArrival, returnDeparture, returnArrival };
    }

    // 마이리얼트립은 도시 검색 코드(SHA 등), 온라인투어는 여행지 코드(BOR 등)가
    // arrival.airport에 들어올 수 있다. 검증된 실제 구간이 없으면 네이버 URL을 만들지 않는다.
    if (flight.source === 'myrealtrip' || flight.source === 'onlinetour') return null;

    const outboundDeparture = normalizeAirport(flight.departure?.airport);
    const outboundArrival = normalizeAirport(flight.arrival?.airport);
    if (!outboundDeparture || !outboundArrival) return null;
    return {
        outboundDeparture,
        outboundArrival,
        returnDeparture: outboundArrival,
        returnArrival: outboundDeparture,
    };
}

export function formatNaverRoute(route: ExactRouteAirports): string {
    const outbound = `${route.outboundDeparture}-${route.outboundArrival}`;
    const returning = `${route.returnDeparture}-${route.returnArrival}`;
    return route.returnDeparture === route.outboundArrival && route.returnArrival === route.outboundDeparture
        ? outbound
        : `${outbound}/${returning}`;
}

export function buildNaverPriceKey(
    flight: NaverComparableFlight,
    departureDate: unknown,
    returnDate: unknown,
): string | null {
    const route = getExactRouteAirports(flight);
    const depDate = normalizeComparisonDate(departureDate);
    const retDate = normalizeComparisonDate(returnDate);
    if (!route || !/^\d{4}-\d{2}-\d{2}$/.test(depDate) || !/^\d{4}-\d{2}-\d{2}$/.test(retDate)) return null;

    const outbound = `${route.outboundDeparture}-${route.outboundArrival}`;
    const returning = `${route.returnDeparture}-${route.returnArrival}`;
    const routeKey = returning === `${route.outboundArrival}-${route.outboundDeparture}`
        ? outbound
        : `${outbound}__${returning}`;
    return `${routeKey}_${depDate}_${retDate}`;
}

export function buildNaverSearchUrl(
    route: ExactRouteAirports,
    departureDate: unknown,
    returnDate?: unknown,
): string | null {
    const depDate = normalizeComparisonDate(departureDate).replace(/-/g, '');
    if (!/^\d{8}$/.test(depDate)) return null;

    const outbound = `${route.outboundDeparture}-${route.outboundArrival}-${depDate}`;
    const retDate = normalizeComparisonDate(returnDate).replace(/-/g, '');
    if (/^\d{8}$/.test(retDate) && retDate !== depDate) {
        return `https://flight.naver.com/flights/international/${outbound}/${route.returnDeparture}-${route.returnArrival}-${retDate}?adult=1&fareType=Y`;
    }
    return `https://flight.naver.com/flights/international/${outbound}?adult=1&fareType=Y`;
}
