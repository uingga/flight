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

console.log('예약 인원 보정 확인 완료: 최소 2인 항공권은 유아를 제외한 2인으로 연결');
