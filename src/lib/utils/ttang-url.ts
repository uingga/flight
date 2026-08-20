import { Flight } from '@/types/flight';

export interface TtangPassengers {
    adult: number;
    child: number;
    infant: number;
}

/**
 * 땡처리닷컴 예약 링크 = 해당 출발일의 "땡처리 특가" 목록.
 *
 * 우리가 보여주는 가격은 특가 프로모션 API(allTtangListAct)에서 온 것이라
 * 일반 실시간 운임 검색(realtime_V2)에는 그 가격이 아예 없다 — 2026-08-12에
 * 노선별 착지를 노리고 realtime_V2로 바꿨다가, 가격이 96% 정확한데도
 * "티키티킷 가격이 거짓"으로 보이는 회귀가 생겨 특가 목록으로 되돌렸다.
 * (특가 목록은 dep0/arr0 노선 파라미터를 서버가 무시하므로 노선 필터 착지는 불가능.
 *  대신 scale=200으로 한 페이지에 다 실어 광고한 가격이 반드시 목록에 존재하게 한다.
 *  어떤 항목을 찾을지는 상세 시트의 안내 문구가 알려준다.)
 */
export function getTtangBookingUrl(flight: Flight, pax: TtangPassengers): string {
    const compactDate = flight.departure.date?.replace(/\D/g, '').slice(0, 8) || '';
    const params = new URLSearchParams({
        trip: 'RT',
        depdate0: compactDate,
        adt: String(pax.adult),
        chd: String(pax.child),
        inf: String(pax.infant),
        page: '1',
        scale: '200',
    });
    return `https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?${params.toString()}`;
}
