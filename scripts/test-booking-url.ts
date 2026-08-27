import type { Flight } from '@/types/flight';
import { getFlightBookingUrl, normalizeBookingPassengers } from '@/lib/utils/booking-url';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const flight: Flight = {
    id: 'min-pax-test',
    source: 'ybtour',
    airline: '제주항공',
    departure: { city: '인천', airport: 'ICN', date: '2026-09-10', time: '10:00' },
    arrival: { city: '후쿠오카', airport: 'FUK', date: '2026-09-13', time: '18:00' },
    price: 150_000,
    currency: 'KRW',
    link: 'https://fly.ybtour.co.kr/example',
    minPax: 2,
};

const normalized = normalizeBookingPassengers(flight, { adult: 1, child: 0, infant: 0 });
assert(normalized.adult === 2, '최소 2인 항공권이 1인 예약 상태로 남았습니다.');

const mixedParty = normalizeBookingPassengers(flight, { adult: 1, child: 1, infant: 0 });
assert(mixedParty.adult === 1 && mixedParty.child === 1, '이미 최소 인원을 충족한 구성을 바꿨습니다.');

const infantParty = normalizeBookingPassengers(flight, { adult: 1, child: 0, infant: 1 });
assert(
    infantParty.adult === 2 && infantParty.infant === 1,
    '좌석을 점유하지 않는 유아가 최소 예약 인원에 포함됐습니다.',
);

const bookingUrl = new URL(getFlightBookingUrl(flight, { adult: 1, child: 0, infant: 0 }));
assert(bookingUrl.searchParams.get('adt') === '2', '노랑풍선 예약 주소의 성인 인원이 최소 인원을 반영하지 않았습니다.');
assert(bookingUrl.searchParams.get('AdultCount') === '2', '노랑풍선 보조 인원 값이 최소 인원을 반영하지 않았습니다.');

const sampleFlight = (source: Flight['source'], link: string): Flight => ({
    ...flight,
    id: `booking-${source}`,
    source,
    link,
    minPax: 1,
});

const hana = getFlightBookingUrl(sampleFlight(
    'hanatour',
    'https://www.hanatour.com/com/pmt/CHPC0PMT0011M200?fareId=FARE-123',
), { adult: 2, child: 1, infant: 1 }, true);
const hanaRedirect = new URL(hana, 'https://www.tikitikit.kr');
assert(hanaRedirect.pathname === '/api/redirect', '하나투어 예약 링크가 안전한 연결 경로를 사용하지 않습니다.');
const hanaTarget = new URL(hanaRedirect.searchParams.get('url') || '');
assert(hanaTarget.hostname === 'm.hanatour.com', '하나투어 모바일 예약 주소가 아닙니다.');
const hanaCondition = JSON.parse(hanaTarget.searchParams.get('searchCond') || '{}') as {
    psngrCntLst?: Array<{ ageDvCd: string; psngrCnt: number }>;
};
assert(hanaCondition.psngrCntLst?.find(item => item.ageDvCd === 'A')?.psngrCnt === 2, '하나투어 성인 인원이 연결되지 않았습니다.');
assert(hanaCondition.psngrCntLst?.find(item => item.ageDvCd === 'C')?.psngrCnt === 1, '하나투어 소아 인원이 연결되지 않았습니다.');

const mode = getFlightBookingUrl(sampleFlight(
    'modetour',
    'https://www.modetour.com/air/discount/example',
), undefined, true);
assert(new URL(mode).hostname === 'm.modetour.com', '모두투어 모바일 예약 주소가 아닙니다.');

const online = getFlightBookingUrl(sampleFlight(
    'onlinetour',
    'https://www.onlinetour.co.kr/flight/w/dcair/dcairList?route=FUK',
), undefined, true);
assert(new URL(online).hostname === 'm.onlinetour.co.kr', '온라인투어 모바일 예약 주소가 아닙니다.');
assert(new URL(online).pathname.includes('/flight/m/'), '온라인투어 모바일 화면 경로로 바뀌지 않았습니다.');

const ttang = getFlightBookingUrl(sampleFlight(
    'ttang',
    'https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do',
));
const ttangUrl = new URL(ttang);
assert(ttangUrl.hostname === 'mm.ttang.com', '땡처리닷컴 특가 목록 주소가 아닙니다.');
assert(ttangUrl.searchParams.get('scale') === '200', '땡처리닷컴 목록에서 해당 표를 찾기 어려운 작은 페이지로 연결됩니다.');
assert(ttang.includes('#:~:text='), '땡처리닷컴에서 표시 가격을 찾는 강조 정보가 빠졌습니다.');

const myrealtripFlight: Flight = {
    ...sampleFlight(
        'myrealtrip',
        'https://www.myrealtrip.com/bridge/marketing/?return_url=https%3A%2F%2Fflights.myrealtrip.com%2Fair%2Fagent%2Fb2c%2FAIR%2FAAA%2Foffers.k1%3Fgid%3D3567293%26adult%3D1%26child%3D0%26infant%3D0&mylink_id=1849392',
    ),
    departure: { city: '인천', airport: 'ICN', date: '2026-09-10', time: '10:00' },
    // 도시 검색용 코드는 SHA지만 실제 예약 결과에서 확인한 공항은 PVG인 사례를 재현한다.
    arrival: { city: '상하이(푸동)', airport: 'SHA', date: '2026-09-13', time: '18:00' },
    routeAirports: {
        outboundDeparture: 'ICN',
        outboundArrival: 'PVG',
        returnDeparture: 'PVG',
        returnArrival: 'ICN',
    },
};
const myrealtrip = getFlightBookingUrl(myrealtripFlight, { adult: 2, child: 1, infant: 0 });
const myrealtripPartnerUrl = new URL(myrealtrip);
assert(myrealtripPartnerUrl.hostname === 'www.myrealtrip.com', '마이리얼트립 제휴 연결 주소가 아닙니다.');
assert(myrealtripPartnerUrl.searchParams.get('mylink_id') === '1849392', '마이리얼트립 제휴 ID가 빠졌습니다.');
assert(myrealtripPartnerUrl.searchParams.get('utm_campaign') === 'tikitikit_flight', '마이리얼트립 제휴 추적값이 빠졌습니다.');

const myrealtripResultUrl = new URL(myrealtripPartnerUrl.searchParams.get('return_url') || '');
assert(myrealtripResultUrl.hostname === 'air-web.myrealtrip.com', '마이리얼트립 최신 검색 화면으로 연결되지 않습니다.');
assert(
    myrealtripResultUrl.searchParams.get('trip') === 'A.ICN.A.PVG.2026-09-10/A.PVG.A.ICN.2026-09-13',
    '마이리얼트립 검색 주소가 실제 확인된 공항과 날짜를 사용하지 않습니다.',
);
assert(myrealtripResultUrl.searchParams.get('adult') === '2', '마이리얼트립 성인 인원이 연결되지 않았습니다.');
assert(myrealtripResultUrl.searchParams.get('child') === '1', '마이리얼트립 소아 인원이 연결되지 않았습니다.');
assert(myrealtripResultUrl.searchParams.get('infant') === '0', '마이리얼트립 유아 인원이 연결되지 않았습니다.');
assert(myrealtripResultUrl.searchParams.get('cityNames') === '인천,상하이', '마이리얼트립 도시명이 정리되지 않았습니다.');

console.log('6개 여행사 예약 연결 확인 완료: 인원 보정·모바일 주소·특가 목록·제휴 추적');
