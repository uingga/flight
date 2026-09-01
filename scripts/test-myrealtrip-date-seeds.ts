import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import {
    appendMyrealtripDateSeedFlights,
    isMyrealtripQuickDepartureSeed,
    matchesMyrealtripQuickDepartureRoute,
    selectInterparkMyrealtripDateCandidates,
} from '../src/lib/scrapers/myrealtrip';

const observedAt = '2026-09-01T00:00:00.000Z';
const popularLowestRoutes = [
    {
        originCity: { code: 'SEL' as const, name: '서울' },
        destinationCity: { code: 'OSA', name: '오사카' },
        tripType: 'ROUND_TRIP' as const,
        isDirect: true,
        outboundDate: '2026-09-17',
        inboundDate: '2026-09-22',
        airlineCode: 'TW',
        price: 191_780,
    },
    {
        originCity: { code: 'SEL' as const, name: '서울' },
        destinationCity: { code: 'SPK', name: '삿포로' },
        tripType: 'ROUND_TRIP' as const,
        isDirect: true,
        outboundDate: '2026-09-19',
        inboundDate: '2026-09-23',
        airlineCode: '7C',
        price: 319_000,
    },
    {
        originCity: { code: 'SEL' as const, name: '서울' },
        destinationCity: { code: 'NHA', name: '나트랑' },
        tripType: 'ROUND_TRIP' as const,
        isDirect: true,
        outboundDate: '2026-09-26',
        inboundDate: '2026-10-01',
        airlineCode: 'ZE',
        price: 301_700,
    },
];

const candidates = selectInterparkMyrealtripDateCandidates({
    popularUpdatedAt: observedAt,
    popularLowestRoutes,
}, {
    now: new Date('2026-09-01T03:00:00.000Z'),
});

assert.deepEqual(
    candidates.map(candidate => candidate.destinationCityCode),
    ['OSA', 'CTS', 'CXR'],
    '인터파크 도시 코드는 실제 마이리얼트립 검색이 가능한 코드로 변환해야 한다.',
);

assert.deepEqual(
    selectInterparkMyrealtripDateCandidates({
        popularUpdatedAt: '2026-08-30T00:00:00.000Z',
        popularLowestRoutes,
    }, {
        now: new Date('2026-09-01T03:00:00.000Z'),
    }),
    [],
    '24시간이 지난 빠른 출발 목록으로 추가 예약 페이지 요청을 만들면 안 된다.',
);

const existingFlight: Flight = {
    id: 'mrt-ICN-KIX-20260917-200000',
    source: 'myrealtrip',
    airline: '티웨이항공',
    departure: {
        city: '서울(인천)',
        airport: 'ICN',
        date: '2026-09-17',
        time: '',
    },
    arrival: {
        city: '오사카(간사이)',
        airport: 'KIX',
        date: '2026-09-22',
        time: '',
    },
    price: 200_000,
    currency: 'KRW',
    link: 'https://example.com',
};
const flights = [existingFlight];
const added = appendMyrealtripDateSeedFlights(flights, candidates);

assert.deepEqual(
    added.map(flight => flight.arrival.airport),
    ['CTS', 'CXR'],
    '이미 같은 도시·날짜가 있으면 도시 코드가 달라도 중복 후보를 추가하면 안 된다.',
);
assert.equal(isMyrealtripQuickDepartureSeed(added[0]), true);
assert.equal(
    matchesMyrealtripQuickDepartureRoute(added[0], {
        isDirect: true,
        depTime: '10:00',
        arrTime: '12:30',
        retDepTime: '14:00',
        retArrTime: '16:30',
        routeAirports: {
            outboundDeparture: 'ICN',
            outboundArrival: 'CTS',
            returnDeparture: 'CTS',
            returnArrival: 'ICN',
        },
    }),
    true,
    '직항이며 실제 공항이 후보 도시와 맞을 때만 검증을 통과해야 한다.',
);
assert.equal(
    matchesMyrealtripQuickDepartureRoute(added[0], {
        isDirect: true,
        depTime: '10:00',
        arrTime: '12:30',
        retDepTime: '14:00',
        retArrTime: '16:30',
        routeAirports: {
            outboundDeparture: 'ICN',
            outboundArrival: 'FUK',
            returnDeparture: 'FUK',
            returnArrival: 'ICN',
        },
    }),
    false,
    '다른 공항으로 연결된 검색 결과를 후보 항공권으로 저장하면 안 된다.',
);
assert.equal(
    matchesMyrealtripQuickDepartureRoute(added[0], {
        isDirect: false,
        depTime: '10:00',
        arrTime: '12:30',
        retDepTime: '14:00',
        retArrTime: '16:30',
        routeAirports: {
            outboundDeparture: 'ICN',
            outboundArrival: 'CTS',
            returnDeparture: 'CTS',
            returnArrival: 'ICN',
        },
    }),
    false,
    '인터파크의 직항 후보를 마이리얼트립 경유 결과로 대체하면 안 된다.',
);
assert.equal(
    matchesMyrealtripQuickDepartureRoute(added[0], {
        isDirect: true,
        depTime: '',
        arrTime: '',
        retDepTime: '',
        retArrTime: '',
        routeAirports: {
            outboundDeparture: 'ICN',
            outboundArrival: 'CTS',
            returnDeparture: 'CTS',
            returnArrival: 'ICN',
        },
    }),
    false,
    '시간을 읽지 못한 후보를 실제 예약 가능한 항공권으로 저장하면 안 된다.',
);

console.log('✅ 마이리얼트립 빠른 출발 날짜 시딩 테스트 통과');
