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
 *
 * 텍스트 프래그먼트(#:~:text=)로 해당 항목까지 자동 스크롤+하이라이트한다 — 8/12 이전에도
 * 있던 기능의 개선판. 도시명 대신 가격을 1순위로 쓴다(더 고유해서 정확히 그 항목에 착지;
 * 동적 로딩 목록에서도 매칭되는 것 실측 확인). 도시명은 ttang 원본 표기 그대로 써야 한다
 * (예: 우리 표기 "다카마쓰" ≠ ttang 표기 "다카마츠") — 캐시의 city가 ttang API 원본이므로 그대로 사용.
 * 미지원 브라우저(일부 인앱)에서는 프래그먼트가 조용히 무시되고 안내 문구가 대신한다.
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

    const fragments: string[] = [];
    if (flight.price > 0) fragments.push(encodeURIComponent(`${flight.price.toLocaleString('ko-KR')}원`));
    const rawArrCity = flight.arrival.city?.replace(/\([^)]+\)/g, '').trim();
    if (rawArrCity) fragments.push(encodeURIComponent(rawArrCity));
    const textFragment = fragments.length ? `#:~:text=${fragments.join('&text=')}` : '';

    return `https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?${params.toString()}${textFragment}`;
}
