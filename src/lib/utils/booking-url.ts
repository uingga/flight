import type { Flight } from '@/types/flight';
import { getMobileUrl } from './mobile-url';
import { getTtangBookingUrl } from './ttang-url';
import { getYbtourBookingUrl } from './ybtour-url';

export interface BookingPassengers {
    adult: number;
    child: number;
    infant: number;
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
