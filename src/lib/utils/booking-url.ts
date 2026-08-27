import type { Flight } from '@/types/flight';
import { getMobileUrl } from './mobile-url';
import { getTtangBookingUrl } from './ttang-url';
import { getYbtourBookingUrl } from './ybtour-url';

export interface BookingPassengers {
    adult: number;
    child: number;
    infant: number;
}

const MYREALTRIP_PARTNER_ID = '1849392';
const IATA_AIRPORT_PATTERN = /^[A-Z]{3}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanMyRealTripCityName(city: string): string {
    return city.replace(/\s*\([^)]*\)\s*/g, '').trim();
}

/**
 * 마이리얼트립의 오래된 gid 상품 주소 대신 현재 항공권 검색 주소를 만든다.
 * 실제 예약 결과에서 확인한 routeAirports를 우선해 상하이처럼 공항이 여러 개인
 * 도시에서도 다른 공항의 결과로 연결되지 않게 한다.
 */
function buildMyRealTripBookingUrl(
    flight: Flight,
    passengers: BookingPassengers,
): string | null {
    const outboundDeparture = flight.routeAirports?.outboundDeparture || flight.departure.airport;
    const outboundArrival = flight.routeAirports?.outboundArrival || flight.arrival.airport;
    const returnDeparture = flight.routeAirports?.returnDeparture || outboundArrival;
    const returnArrival = flight.routeAirports?.returnArrival || outboundDeparture;
    const airportCodes = [outboundDeparture, outboundArrival, returnDeparture, returnArrival];

    if (
        !airportCodes.every(code => IATA_AIRPORT_PATTERN.test(code))
        || !ISO_DATE_PATTERN.test(flight.departure.date)
        || !ISO_DATE_PATTERN.test(flight.arrival.date)
    ) {
        return null;
    }

    const resultUrl = new URL('https://air-web.myrealtrip.com/results');
    resultUrl.searchParams.set(
        'trip',
        `A.${outboundDeparture}.A.${outboundArrival}.${flight.departure.date}`
        + `/A.${returnDeparture}.A.${returnArrival}.${flight.arrival.date}`,
    );
    resultUrl.searchParams.set('adult', String(passengers.adult));
    resultUrl.searchParams.set('child', String(passengers.child));
    resultUrl.searchParams.set('infant', String(passengers.infant));
    resultUrl.searchParams.set('cabins', 'ECONOMY');
    resultUrl.searchParams.set('tripType', 'ROUND_TRIP');

    const departureCity = cleanMyRealTripCityName(flight.departure.city);
    const arrivalCity = cleanMyRealTripCityName(flight.arrival.city);
    if (departureCity && arrivalCity) {
        resultUrl.searchParams.set('cityNames', `${departureCity},${arrivalCity}`);
    }

    const trackingId = [
        'flight', outboundDeparture, outboundArrival,
        flight.departure.date.replace(/\D/g, ''), flight.arrival.date.replace(/\D/g, ''),
    ].join('_').slice(0, 100);
    const partnerUrl = new URL('https://www.myrealtrip.com/bridge/marketing/');
    partnerUrl.searchParams.set('return_url', resultUrl.toString());
    partnerUrl.searchParams.set('mylink_id', MYREALTRIP_PARTNER_ID);
    partnerUrl.searchParams.set('utm_source', 'mktpartner');
    partnerUrl.searchParams.set('t_scope', '86400');
    partnerUrl.searchParams.set('utm_campaign', 'tikitikit_flight');
    partnerUrl.searchParams.set('utm_content', trackingId);
    return partnerUrl.toString();
}

export function normalizeBookingPassengers(
    flight: Flight,
    passengers: BookingPassengers,
): BookingPassengers {
    const normalized = {
        adult: Math.max(1, Math.floor(passengers.adult || 0)),
        child: Math.max(0, Math.floor(passengers.child || 0)),
        infant: Math.max(0, Math.floor(passengers.infant || 0)),
    };
    const minimumPassengers = Math.max(1, Math.floor(flight.minPax || 1));
    // 좌석을 점유하지 않는 유아는 여행사의 최소 예약 인원에 포함하지 않는다.
    const seatPassengers = normalized.adult + normalized.child;
    if (seatPassengers < minimumPassengers) {
        normalized.adult += minimumPassengers - seatPassengers;
    }
    normalized.infant = Math.min(normalized.infant, normalized.adult);
    return normalized;
}

/**
 * 여행사마다 다른 실제 예약 착지 주소를 한곳에서 만든다.
 * 목록에 저장된 원본 링크를 그대로 열면 하나투어·노랑풍선·땡처리닷컴은
 * 해당 일정이나 표시 가격을 찾지 못할 수 있으므로 메인과 리디자인이 이 함수를 공유한다.
 */
export function getFlightBookingUrl(
    flight: Flight,
    passengers: BookingPassengers = { adult: 1, child: 0, infant: 0 },
    isMobile = false,
): string {
    passengers = normalizeBookingPassengers(flight, passengers);
    if (flight.source === 'hanatour') {
        const psngrCntLst: Array<{ ageDvCd: string; psngrCnt: number }> = [];
        if (passengers.adult > 0) psngrCntLst.push({ ageDvCd: 'A', psngrCnt: passengers.adult });
        if (passengers.child > 0) psngrCntLst.push({ ageDvCd: 'C', psngrCnt: passengers.child });
        if (passengers.infant > 0) psngrCntLst.push({ ageDvCd: 'I', psngrCnt: passengers.infant });

        const fareIdMatch = flight.link.match(/fareId=([^&]+)/);
        if (fareIdMatch) {
            if (isMobile) {
                const bookingUrl = `https://m.hanatour.com/com/pmt/CHPC0PMT0011M100?searchCond=${encodeURIComponent(JSON.stringify({ fareId: decodeURIComponent(fareIdMatch[1]), psngrCntLst }))}`;
                const fallback = flight.searchLink
                    ? flight.searchLink.replace('hope.hanatour.com', 'm.hanatour.com').replace('M200', 'M100')
                    : 'https://m.hanatour.com/trp/air/CHPC0AIR0233M100';
                return `/api/redirect?url=${encodeURIComponent(bookingUrl)}&fallback=${encodeURIComponent(fallback)}`;
            }
            const bookingUrl = `https://www.hanatour.com/com/pmt/CHPC0PMT0011M200?searchCond=${encodeURIComponent(JSON.stringify({ fareId: decodeURIComponent(fareIdMatch[1]), psngrCntLst }))}`;
            const fallback = flight.searchLink || 'https://www.hanatour.com/trp/air/CHPC0AIR0233M200';
            return `/api/redirect?url=${encodeURIComponent(bookingUrl)}&fallback=${encodeURIComponent(fallback)}`;
        }

        let url = flight.link || flight.searchLink || '';
        if (url.includes('searchCond=')) {
            try {
                const searchCondition = url.match(/searchCond=([^&]+)/);
                if (searchCondition) {
                    const parsed = JSON.parse(decodeURIComponent(searchCondition[1]));
                    parsed.psngrCntLst = psngrCntLst;
                    url = url.replace(/searchCond=[^&]+/, `searchCond=${encodeURIComponent(JSON.stringify(parsed))}`);
                }
            } catch { /* 원본 링크를 그대로 사용한다. */ }
        }
        return isMobile
            ? url.replace('hope.hanatour.com', 'm.hanatour.com').replace('www.hanatour.com', 'm.hanatour.com').replace('M200', 'M100')
            : url.replace('hope.hanatour.com', 'www.hanatour.com');
    }

    if (flight.source === 'modetour') return getMobileUrl(flight.link, isMobile);
    if (flight.source === 'ttang') return getTtangBookingUrl(flight);
    if (flight.source === 'ybtour') return getYbtourBookingUrl(flight, passengers);
    if (flight.source === 'onlinetour') return getMobileUrl(flight.link, isMobile);

    if (flight.source === 'myrealtrip') {
        const currentSearchUrl = buildMyRealTripBookingUrl(flight, passengers);
        if (currentSearchUrl) return currentSearchUrl;

        // 공항이나 날짜 정보가 비정상인 과거 데이터만 기존 주소로 안전하게 폴백한다.
        let url = flight.link;
        url = url.replace(/adult%3D\d+/, `adult%3D${passengers.adult}`);
        url = url.replace(/child%3D\d+/, `child%3D${passengers.child}`);
        url = url.replace(/infant%3D\d+/, `infant%3D${passengers.infant}`);
        try {
            const trackedUrl = new URL(url);
            const trackingId = [
                'flight', flight.departure.airport, flight.arrival.airport,
                flight.departure.date?.replace(/\D/g, ''), flight.arrival.date?.replace(/\D/g, ''),
            ].filter(Boolean).join('_').slice(0, 100);
            trackedUrl.searchParams.set('utm_campaign', 'tikitikit_flight');
            trackedUrl.searchParams.set('utm_content', trackingId);
            return trackedUrl.toString();
        } catch {
            return url;
        }
    }

    return getMobileUrl(flight.link, isMobile);
}
