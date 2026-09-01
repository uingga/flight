import assert from 'node:assert/strict';
import { parseMyrealtripRouteAirports } from './lib/myrealtrip-search-page';
import {
    buildNaverPriceKey,
    buildNaverSearchUrl,
    getExactRouteAirports,
} from '../src/lib/naver-route';
import {
    classifyNaverAvailability,
    classifyNaverPageState,
    classifyNaverProbeAvailability,
    combineNaverProbeResults,
    shouldAbortNaverCrawlForSystemicFailures,
    shouldAbortNaverCrawlForZeroSuccess,
} from '../src/lib/naver-crawl-page-state';
import {
    getRecommendationNaverComparison,
    getUsableNaverComparison,
} from '../src/lib/naver-comparison';
import {
    getComparisonFreshness,
    getRecommendationComparisonFreshness,
} from '../src/lib/price-quality';

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
assert.equal(classifyNaverPageState({ url: 'https://flight.naver.com/error', bodyText: '일시적으로 서비스를 이용할 수 없습니다' }), 'transient_error');
assert.equal(classifyNaverPageState({ httpStatus: 429, bodyText: 'Too Many Requests' }), 'blocked');
assert.equal(classifyNaverPageState({ bodyText: '검색 결과를 불러오는 중입니다.' }), 'transient_error');
assert.equal(classifyNaverPageState({
    url: 'https://flight.naver.com/flights/international/ICN-TSN-20261001/TSN-ICN-20261006',
    httpStatus: 200,
    searchPageReached: true,
    graphqlResponseCount: 2,
    graphqlSuccessCount: 2,
    graphqlProblemStatus: null,
    isLoading: false,
    priceCount: 0,
}), 'no_result');
assert.equal(classifyNaverAvailability({
    url: 'https://flight.naver.com/flights/international/ICN-FUK-20260910/FUK-ICN-20260913',
    httpStatus: 200,
    searchPageReached: true,
    graphqlResponseCount: 1,
    graphqlSuccessCount: 1,
    isLoading: true,
}), 'unknown');
assert.equal(classifyNaverAvailability({
    httpStatus: 200,
    searchPageReached: true,
    graphqlResponseCount: 1,
    graphqlSuccessCount: 0,
    graphqlProblemStatus: 503,
}), 'unavailable');
assert.equal(classifyNaverAvailability({
    httpStatus: 429,
    searchPageReached: true,
}), 'blocked');
assert.equal(classifyNaverPageState({
    httpStatus: 200,
    searchPageReached: true,
    graphqlResponseCount: 1,
    graphqlSuccessCount: 0,
    graphqlErrorCount: 1,
    isLoading: false,
}), 'transient_error');
assert.equal(shouldAbortNaverCrawlForZeroSuccess(9, 0), false);
assert.equal(shouldAbortNaverCrawlForZeroSuccess(10, 0), true);
assert.equal(shouldAbortNaverCrawlForZeroSuccess(10, 1), false);
assert.equal(shouldAbortNaverCrawlForSystemicFailures(19, 0, 19, 0), false);
assert.equal(shouldAbortNaverCrawlForSystemicFailures(20, 4, 16, 0), true);
assert.equal(shouldAbortNaverCrawlForSystemicFailures(20, 5, 15, 0), false);
assert.equal(shouldAbortNaverCrawlForSystemicFailures(20, 4, 3, 0), false);

const comparisonNow = new Date('2026-08-27T03:00:00Z').getTime();
assert.deepEqual(getUsableNaverComparison({
    naverLowest: 150_000,
    crawledAt: '2026-08-26T03:00:00Z',
    lastAttemptStatus: 'success',
}, comparisonNow), { price: 150_000, checkedAt: '2026-08-26T03:00:00Z' });
assert.equal(getUsableNaverComparison({
    naverLowest: 150_000,
    crawledAt: '2026-08-26T02:59:59Z',
    lastAttemptStatus: 'success',
}, comparisonNow), null);
assert.equal(
    getComparisonFreshness('2026-08-26T02:59:59Z', comparisonNow).usable,
    false,
    '항공권 제거용 네이버 가격은 24시간을 넘기면 계속 무효여야 한다.',
);
assert.deepEqual(getRecommendationNaverComparison({
    naverLowest: 150_000,
    crawledAt: '2026-08-24T15:00:00Z',
    lastAttemptStatus: 'success',
}, comparisonNow), { price: 150_000, checkedAt: '2026-08-24T15:00:00Z' });
assert.equal(
    getRecommendationComparisonFreshness('2026-08-24T15:00:00Z', comparisonNow).reducedStrength,
    true,
    '48~72시간 네이버 가격은 추천에서 한 단계 완화해야 한다.',
);
assert.equal(
    getRecommendationComparisonFreshness('2026-08-25T03:00:00Z', comparisonNow).fullStrength,
    true,
    '정확히 48시간까지는 원래 추천 신뢰도를 유지해야 한다.',
);
assert.equal(
    getRecommendationComparisonFreshness('2026-08-25T02:59:59Z', comparisonNow).reducedStrength,
    true,
    '48시간을 넘긴 직후부터 완화 구간이어야 한다.',
);
assert.equal(
    getRecommendationComparisonFreshness('2026-08-24T03:00:00Z', comparisonNow).usable,
    true,
    '정확히 72시간까지는 추천 비교가를 유지해야 한다.',
);
assert.equal(getRecommendationNaverComparison({
    naverLowest: 150_000,
    crawledAt: '2026-08-24T02:59:59Z',
    lastAttemptStatus: 'success',
}, comparisonNow), null, '72시간을 넘긴 네이버 가격은 추천에도 사용하지 않아야 한다.');
assert.equal(getRecommendationNaverComparison({
    naverLowest: 150_000,
    crawledAt: '2026-08-24T15:00:00Z',
    lastAttemptStatus: 'no_result',
}, comparisonNow), null, '정상 빈 결과 뒤에는 72시간 안이어도 과거 가격을 사용하지 않아야 한다.');
assert.equal(getUsableNaverComparison({
    naverLowest: 150_000,
    crawledAt: '2026-08-26T03:00:00Z',
    lastAttemptStatus: 'no_result',
}, comparisonNow), null);
assert.equal(getUsableNaverComparison({
    naverLowest: 150_000,
    crawledAt: '2026-08-20T03:00:00Z',
    lastAttemptStatus: 'transient_error',
}, comparisonNow), null);
assert.equal(classifyNaverProbeAvailability({
    httpStatus: 200,
    searchPageReached: true,
    graphqlResponseCount: 0,
    graphqlSuccessCount: 0,
}), 'unavailable');
assert.equal(classifyNaverProbeAvailability({
    httpStatus: 200,
    searchPageReached: true,
    graphqlResponseCount: 1,
    graphqlSuccessCount: 0,
    graphqlErrorCount: 1,
}), 'unavailable');
assert.equal(classifyNaverProbeAvailability({
    httpStatus: 200,
    searchPageReached: true,
    graphqlResponseCount: 2,
    graphqlSuccessCount: 2,
    graphqlErrorCount: 0,
    isLoading: true,
}), 'unavailable');
assert.equal(combineNaverProbeResults(['unavailable', 'unavailable']), 'unavailable');
assert.equal(combineNaverProbeResults(['unavailable', 'unknown']), 'unknown');
assert.equal(classifyNaverAvailability({
    httpStatus: 200,
    searchPageReached: true,
    graphqlResponseCount: 2,
    graphqlSuccessCount: 1,
    graphqlErrorCount: 0,
    graphqlProblemStatus: 503,
}), 'available');
assert.equal(classifyNaverPageState({
    httpStatus: 200,
    searchPageReached: true,
    graphqlResponseCount: 2,
    graphqlSuccessCount: 1,
    graphqlProblemStatus: 503,
}), 'transient_error');
assert.equal(classifyNaverPageState({
    httpStatus: 200,
    bodyText: '일시적으로 서비스를 이용할 수 없습니다.',
}), 'transient_error');

console.log('실제 공항 기반 네이버 비교 경로 테스트 통과');
