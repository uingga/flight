import assert from 'node:assert/strict';
import { parseMyrealtripRouteAirports } from './lib/myrealtrip-search-page';
import {
    buildNaverPriceKey,
    buildNaverSearchUrl,
    getExactRouteAirports,
} from '../src/lib/naver-route';
import { classifyNaverPageState } from '../src/lib/naver-crawl-page-state';

const symmetricSummary = [
    '이스타항공',
    '22:30',
    'ICN T1',
    '2시간',
    '직항',
    '23:30',
    'PVG T2',
    '00:30',
    'PVG T2',
    '2시간',
    '직항',
    '03:30',
    'ICN T1',
].join('\n');

const mixedSummary = [
    '중국동방항공',
    '12:00',
    'GMP TI',
    '12:55',
    'SHA T1',
    '09:15',
    'PVG T1',
    '11:55',
    'ICN T1',
].join('\n');

const symmetric = parseMyrealtripRouteAirports(symmetricSummary);
assert.deepEqual(symmetric, {
    outboundDeparture: 'ICN',
    outboundArrival: 'PVG',
    returnDeparture: 'PVG',
    returnArrival: 'ICN',
});

const mixed = parseMyrealtripRouteAirports(mixedSummary);
assert.deepEqual(mixed, {
    outboundDeparture: 'GMP',
    outboundArrival: 'SHA',
    returnDeparture: 'PVG',
    returnArrival: 'ICN',
});

const unverifiedMyrealtrip = {
    source: 'myrealtrip',
    departure: { airport: 'ICN' },
    arrival: { airport: 'SHA' },
};
assert.equal(getExactRouteAirports(unverifiedMyrealtrip), null);
assert.equal(buildNaverPriceKey(unverifiedMyrealtrip, '2026-09-09', '2026-09-15'), null);

const verifiedMyrealtrip = { ...unverifiedMyrealtrip, routeAirports: symmetric };
assert.equal(
    buildNaverPriceKey(verifiedMyrealtrip, '2026-09-09', '2026-09-15'),
    'ICN-PVG_2026-09-09_2026-09-15',
);
assert.equal(
    buildNaverSearchUrl(symmetric!, '2026-09-09', '2026-09-15'),
    'https://flight.naver.com/flights/international/ICN-PVG-20260909/PVG-ICN-20260915?adult=1&fareType=Y',
);

assert.equal(
    buildNaverPriceKey({ ...unverifiedMyrealtrip, routeAirports: mixed }, '2026-09-09', '2026-09-15'),
    'GMP-SHA__PVG-ICN_2026-09-09_2026-09-15',
);
assert.equal(
    buildNaverSearchUrl(mixed!, '2026-09-09', '2026-09-15'),
    'https://flight.naver.com/flights/international/GMP-SHA-20260909/PVG-ICN-20260915?adult=1&fareType=Y',
);

const legacy = {
    source: 'modetour',
    departure: { airport: 'PUS' },
    arrival: { airport: 'FUK' },
};
assert.equal(
    buildNaverPriceKey(legacy, '2026.09.17(목)', '2026.09.19(토)'),
    'PUS-FUK_2026-09-17_2026-09-19',
);

const unverifiedOnlineTour = {
    source: 'onlinetour',
    departure: { airport: 'ICN' },
    // 온라인투어의 BOR는 칼리보 실제 공항 KLO가 아니라 여행지 코드다.
    arrival: { airport: 'BOR' },
};
assert.equal(getExactRouteAirports(unverifiedOnlineTour), null);
assert.equal(buildNaverPriceKey(unverifiedOnlineTour, '2026-08-28', '2026-08-31'), null);

const verifiedOnlineTour = {
    ...unverifiedOnlineTour,
    routeAirports: {
        outboundDeparture: 'ICN',
        outboundArrival: 'KLO',
        returnDeparture: 'KLO',
        returnArrival: 'ICN',
    },
};
assert.equal(
    buildNaverPriceKey(verifiedOnlineTour, '2026-08-28', '2026-08-31'),
    'ICN-KLO_2026-08-28_2026-08-31',
);
assert.equal(
    buildNaverSearchUrl(getExactRouteAirports(verifiedOnlineTour)!, '2026-08-28', '2026-08-31').includes('BOR'),
    false,
);

assert.equal(classifyNaverPageState({ priceCount: 10, url: 'https://flight.naver.com/flights/international/...' }), 'results');
assert.equal(classifyNaverPageState({ bodyText: '조건에 맞는 항공권이 없습니다.' }), 'no_result');
assert.equal(classifyNaverPageState({ url: 'https://flight.naver.com/error', bodyText: '일시적으로 서비스를 이용할 수 없습니다' }), 'route_error');
assert.equal(classifyNaverPageState({ httpStatus: 429, bodyText: 'Too Many Requests' }), 'blocked');
assert.equal(classifyNaverPageState({ bodyText: '검색 결과를 불러오는 중입니다.' }), 'transient_error');

console.log('실제 공항 기반 네이버 비교 경로 테스트 통과');
