import assert from 'node:assert/strict';
import {
    diversifyFlightDestinations,
    diversifyFlightDestinationsWithDecisions,
    diversifyRecommendationOrder,
    createsAlternatingDestinationPattern,
    excludePinnedDestination,
    sortFirstBlockByNewestArrival,
    trailingDestinationStreak,
} from '../src/lib/flight-diversity';
import {
    buildRecommendationPresentation,
    buildRecommendationScoreState,
    compareRecommendedFlights,
    getAllowedNaverPriceGap,
} from '../src/lib/flight-recommendation';
import { getRoutePriceCompetitivenessTier } from '../src/lib/price-quality';
import type { Flight } from '../src/types/flight';

function flight(id: string, departureCity: string, arrivalCity: string, score: number): Flight & { testScore: number } {
    return {
        id,
        source: 'ybtour',
        airline: '테스트항공',
        departure: { city: departureCity, airport: departureCity === '부산' ? 'PUS' : 'ICN', date: '2026-09-01', time: '08:00' },
        arrival: { city: arrivalCity, airport: 'TST', date: '2026-09-05', time: '18:00' },
        price: 100_000,
        currency: 'KRW',
        seats: '9석',
        region: '일본',
        testScore: score,
    };
}

const candidates = [
    flight('a-1', '인천', '오사카', 1),
    flight('a-2', '부산', '오사카(간사이)', 2),
    flight('a-3', '인천', '오사카', 3),
    flight('b-1', '인천', '후쿠오카', 100),
    flight('c-1', '인천', '도쿄', 101),
    flight('d-1', '인천', '나고야', 102),
    flight('e-1', '인천', '삿포로', 103),
    flight('f-1', '인천', '오키나와', 104),
    flight('g-1', '인천', '다낭', 105),
    flight('h-1', '인천', '방콕', 106),
];
const ordered = diversifyFlightDestinations(candidates, {
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
    balanceIncheon: false,
});
const orderedWithDecisions = diversifyFlightDestinationsWithDecisions(candidates, {
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
    balanceIncheon: false,
});

assert.deepEqual(
    orderedWithDecisions.flights.map(item => item.id),
    ordered.map(item => item.id),
    '설명 객체를 계산해도 기존 목적지 분산 순서가 달라지면 안 된다.',
);
assert.equal(orderedWithDecisions.decisions.length, ordered.length, '모든 진열 카드에 다양성 결정 기록이 있어야 한다.');
assert.deepEqual(
    orderedWithDecisions.decisions.map(decision => decision.flightId),
    ordered.map(item => item.id),
    '다양성 설명은 실제 진열 순서와 같은 순서여야 한다.',
);

assert.deepEqual(ordered.slice(0, 3).map(item => item.id), ['a-1', 'a-2', 'b-1'],
    '같은 목적지는 두 번째까지 연속 허용하고 세 번째 앞에는 다른 목적지를 배치해야 한다.');
assert.equal(
    ordered.slice(0, 9).filter(item => item.id.startsWith('a-')).length,
    2,
    '첫 9개에는 같은 목적지가 총 2개까지만 들어가야 한다.',
);
assert.equal(ordered[9].id, 'a-3', '같은 목적지 세 번째 카드는 첫 9개 뒤로 미뤄야 한다.');
assert.equal(
    trailingDestinationStreak(['오사카', '오사카'], '오사카'),
    2,
    '출발지가 달라도 도착지가 같으면 같은 연속 목적지로 세야 한다.',
);

const sameOfferOnDifferentDates = [
    {
        ...flight('bandar-1', '인천', '반다르세리베가완', 1),
        airline: '로열브루나이항공',
        price: 469_900,
        departure: { city: '인천', airport: 'ICN', date: '2026-09-15', time: '08:00' },
        arrival: { city: '반다르세리베가완', airport: 'BWN', date: '2026-09-19', time: '18:00' },
    },
    {
        ...flight('bandar-2', '인천', '반다르세리베가완', 2),
        airline: '로열브루나이항공',
        price: 469_900,
        departure: { city: '인천', airport: 'ICN', date: '2026-10-13', time: '08:00' },
        arrival: { city: '반다르세리베가완', airport: 'BWN', date: '2026-10-17', time: '18:00' },
    },
    ...Array.from({ length: 8 }, (_, index) => flight(
        `different-${index + 1}`,
        '인천',
        `다른도시${index + 1}`,
        index + 10,
    )),
];
const deduplicatedFirstNine = diversifyFlightDestinations(sameOfferOnDifferentDates, {
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
    balanceIncheon: false,
});
assert.equal(
    deduplicatedFirstNine.slice(0, 9).filter(item => item.arrival.city === '반다르세리베가완').length,
    1,
    '40만원 초과 항공권은 같은 최저가 일정이 여러 개여도 첫 9개에 한 장만 보여야 한다.',
);
assert.equal(
    deduplicatedFirstNine.find(item => item.arrival.city === '반다르세리베가완')?.id,
    'bandar-1',
    '40만원 초과 항공권 중에서는 기존 추천순이 가장 높은 한 장을 유지해야 한다.',
);

const differentOriginSameDestination = diversifyFlightDestinations([
    flight('taipei-incheon', '인천', '타이베이', 1),
    flight('taipei-busan', '부산', '타이베이', 2),
    flight('fukuoka', '인천', '후쿠오카', 3),
], {
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
    balanceIncheon: false,
});
assert.deepEqual(
    differentOriginSameDestination.slice(0, 2).map(item => item.id),
    ['taipei-incheon', 'taipei-busan'],
    '목적지가 같아도 출발지가 다르면 서로 다른 선택지로 첫 9개에 함께 남아야 한다.',
);

const differentPriceSameDestination = diversifyFlightDestinations([
    { ...flight('osaka-expensive', '인천', '오사카', 1), price: 129_000 },
    flight('osaka-cheap', '인천', '오사카', 2),
    ...Array.from({ length: 8 }, (_, index) => flight(
        `price-different-${index + 1}`,
        '인천',
        `가격다른도시${index + 1}`,
        index + 3,
    )),
], {
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
    balanceIncheon: false,
});
assert.equal(
    differentPriceSameDestination.slice(0, 9).some(item => item.id === 'osaka-cheap'),
    true,
    '같은 출발권역·목적지에서는 추천 점수가 뒤여도 가장 싼 표를 대표로 보여야 한다.',
);
assert.equal(
    differentPriceSameDestination.slice(0, 9).some(item => item.id === 'osaka-expensive'),
    false,
    '가격이 다르다는 이유만으로 더 비싼 같은 노선 표를 첫 9개에 넣으면 안 된다.',
);
assert.equal(
    differentPriceSameDestination.findIndex(item => item.id === 'osaka-expensive'),
    9,
    '더 비싼 같은 노선 표는 삭제하지 않고 첫 9개 뒤에서 보여야 한다.',
);

const differentTierSameRoute = diversifyRecommendationOrder([
    { ...flight('route-cheap-but-bad', '인천', '사이판', 1), price: 169_900 },
    { ...flight('route-higher-but-competitive', '인천', '사이판', 20), price: 199_000 },
    ...Array.from({ length: 8 }, (_, index) => flight(
        `tier-other-${index + 1}`,
        '인천',
        `구간다른도시${index + 1}`,
        index + 2,
    )),
], {
    tierOf: () => 0,
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
    routeCompetitivenessTierOf: item => item.id === 'route-cheap-but-bad' ? 2 : 0,
    balanceIncheon: false,
});
assert.equal(
    differentTierSameRoute.slice(0, 9).some(item => item.id === 'route-higher-but-competitive'),
    true,
    '같은 노선에서는 절대가격보다 네이버 가격 경쟁력이 좋은 일정이 첫 9개 대표가 되어야 한다.',
);
assert.equal(
    differentTierSameRoute.slice(0, 9).some(item => item.id === 'route-cheap-but-bad'),
    false,
    '더 싸더라도 네이버보다 확실히 비싼 일정은 경쟁력 있는 같은 노선을 밀어내면 안 된다.',
);

const recentlyAddedCandidates = ordered.map((item, index) => ({
    ...item,
    firstSeen: index === 5 ? '2026-08-28' : index === 2 ? '2026-08-27' : index === 9 ? '2026-08-29' : '2026-08-26',
}));
const recentlyAddedFirst = sortFirstBlockByNewestArrival(recentlyAddedCandidates, 9);
assert.deepEqual(
    recentlyAddedFirst.slice(0, 2).map(item => item.id),
    [ordered[5].id, ordered[2].id],
    '첫 9개는 처음 발견한 날짜가 최신인 항공권부터 보여야 한다.',
);
assert.deepEqual(
    new Set(recentlyAddedFirst.slice(0, 9).map(item => item.id)),
    new Set(ordered.slice(0, 9).map(item => item.id)),
    '새 항공권 우선 정렬은 첫 9개의 구성 자체를 바꾸면 안 된다.',
);
assert.equal(recentlyAddedFirst[9].id, ordered[9].id, '첫 9개 밖의 순서는 바꾸면 안 된다.');

const newlyArrivedUniqueCandidates = Array.from({ length: 10 }, (_, index) => ({
    ...flight(`new-${index + 1}`, '인천', `신규도시${index + 1}`, index + 1),
    firstSeen: index === 5 ? '2026-08-30' : index === 2 ? '2026-08-29' : '2026-08-20',
}));
const newlyArrivedRecommendation = diversifyRecommendationOrder(newlyArrivedUniqueCandidates, {
    tierOf: () => 0,
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
    balanceIncheon: false,
    maxConsecutiveDestinations: 1,
});
assert.deepEqual(
    newlyArrivedRecommendation.slice(0, 2).map(item => item.id),
    ['new-1', 'new-2'],
    '진열 단계는 추천 본체가 정한 후보 순서를 신규순으로 다시 뒤집으면 안 된다.',
);
assert.deepEqual(
    new Set(newlyArrivedRecommendation.slice(0, 9).map(item => item.id)),
    new Set(newlyArrivedUniqueCandidates.slice(0, 9).map(item => item.id)),
    '최신 등록 우선은 가격 품질로 선발한 첫 9개의 구성 자체를 바꾸면 안 된다.',
);

const onlyOneDestination = diversifyFlightDestinations(candidates.slice(0, 3), {
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
    balanceIncheon: false,
});
assert.equal(onlyOneDestination.length, 3, '대체 목적지가 없을 때도 항공권을 목록에서 버리면 안 된다.');

const todayPick = flight('today-pick', '인천', '오사카', 0);
assert.deepEqual(
    excludePinnedDestination(candidates, todayPick).map(item => item.id),
    ['b-1', 'c-1', 'd-1', 'e-1', 'f-1', 'g-1', 'h-1'],
    '오늘의 표와 같은 정규화 목적지는 일반 추천 배열에서 모두 제외해야 한다.',
);

const recommendationNow = new Date('2026-08-28T12:00:00+09:00').getTime();
const verifiedQuality = {
    ...flight('verified-quality', '인천', '타이베이', 0),
    price: 180_000,
    naverLowest: 200_000,
    naverCheckedAt: '2026-08-28T08:00:00+09:00',
    priceCheckedAt: '2026-08-28T08:00:00+09:00',
};
const unverifiedCheap = {
    ...flight('unverified-cheap', '인천', '홍콩', 0),
    price: 80_000,
    priceCheckedAt: '2026-08-28T08:00:00+09:00',
};
const tierState = buildRecommendationScoreState([unverifiedCheap, verifiedQuality], {}, recommendationNow);
const tierRanked = [unverifiedCheap, verifiedQuality]
    .sort((a, b) => compareRecommendedFlights(
        a,
        b,
        tierState.scores,
        recommendationNow,
        tierState.explanations,
    ));
assert.deepEqual(
    tierRanked.map(item => item.id),
    ['verified-quality', 'unverified-cheap'],
    '검증된 외부 비교가 이하 구간은 점수가 더 낮은 비교 불가 표보다 먼저여야 한다.',
);

const routeCheapButBad = {
    ...flight('route-cheap-but-bad-score', '인천', '후쿠오카', 0),
    price: 169_900,
    naverLowest: 128_540,
    naverCheckedAt: '2026-08-28T08:00:00+09:00',
    priceCheckedAt: '2026-08-28T08:00:00+09:00',
};
const routeHigherButCompetitive = {
    ...flight('route-higher-but-competitive-score', '인천', '후쿠오카', 0),
    price: 199_000,
    naverLowest: 197_400,
    naverCheckedAt: '2026-08-28T08:00:00+09:00',
    priceCheckedAt: '2026-08-28T08:00:00+09:00',
};
const routeCompetitivenessState = buildRecommendationScoreState(
    [routeCheapButBad, routeHigherButCompetitive],
    {},
    recommendationNow,
);
assert.equal(getRoutePriceCompetitivenessTier(routeCheapButBad, recommendationNow), 2);
assert.equal(getRoutePriceCompetitivenessTier(routeHigherButCompetitive, recommendationNow), 0);
assert.ok(
    routeCompetitivenessState.scores.get(routeHigherButCompetitive.id)!
        < routeCompetitivenessState.scores.get(routeCheapButBad.id)!,
    '같은 노선의 싼 항공권이 네이버보다 확실히 비싸면 경쟁력 있는 다른 날짜의 점수를 가져가면 안 된다.',
);
assert.deepEqual(
    [routeCheapButBad, routeHigherButCompetitive]
        .sort((a, b) => compareRecommendedFlights(
            a,
            b,
            routeCompetitivenessState.scores,
            recommendationNow,
            routeCompetitivenessState.explanations,
        ))
        .map(item => item.id),
    [routeHigherButCompetitive.id, routeCheapButBad.id],
    '같은 노선은 더 싼 날짜보다 네이버 가격 경쟁력이 좋은 날짜를 먼저 보여야 한다.',
);

const manadoLowerPrice = {
    ...flight('manado-lower-price', '인천', '마나도', 0),
    price: 495_000,
    naverLowest: 510_000,
    naverCheckedAt: '2026-08-28T08:00:00+09:00',
    priceCheckedAt: '2026-08-28T08:00:00+09:00',
};
const manadoHigherPrice = {
    ...flight('manado-higher-price', '인천', '마나도', 0),
    price: 515_000,
    naverLowest: 800_000,
    naverCheckedAt: '2026-08-28T08:00:00+09:00',
    priceCheckedAt: '2026-08-28T08:00:00+09:00',
};
const sameLaneRouteState = buildRecommendationScoreState(
    [manadoLowerPrice, manadoHigherPrice],
    {},
    recommendationNow,
);
assert.deepEqual(
    [manadoHigherPrice, manadoLowerPrice]
        .sort((a, b) => compareRecommendedFlights(
            a,
            b,
            sameLaneRouteState.scores,
            recommendationNow,
            sameLaneRouteState.explanations,
        ))
        .map(item => item.id),
    [manadoLowerPrice.id, manadoHigherPrice.id],
    '같은 노선·같은 경쟁력 구간의 최종 추천순도 실제 가격이 낮은 항공권부터여야 한다.',
);

assert.equal(getRoutePriceCompetitivenessTier({
    ...routeCheapButBad,
    price: 150_000,
    naverLowest: 135_000,
}, recommendationNow), 0, '2만원 이내 차이는 비슷한 가격으로 본다.');
assert.equal(getRoutePriceCompetitivenessTier({
    ...routeCheapButBad,
    price: 500_000,
    naverLowest: 455_000,
}, recommendationNow), 0, '10% 이내 차이는 비슷한 가격으로 본다.');
assert.equal(getRoutePriceCompetitivenessTier({
    ...routeCheapButBad,
    price: 250_000,
    naverLowest: 225_000,
}, recommendationNow), 2, '2만원과 10%를 모두 넘으면 확실히 비싼 가격으로 본다.');
const freshPrice = {
    ...flight('fresh-price', '인천', '싱가포르', 0),
    price: 200_000,
    priceCheckedAt: '2026-08-28T08:00:00+09:00',
};
const oldPrice = {
    ...flight('old-price', '인천', '방콕', 0),
    price: 200_000,
    priceCheckedAt: '2026-08-26T08:00:00+09:00',
};
const freshnessState = buildRecommendationScoreState([freshPrice, oldPrice], {}, recommendationNow);
assert.ok(
    freshnessState.scores.get('fresh-price')! < freshnessState.scores.get('old-price')!,
    '같은 가격 품질이면 최근 확인한 표의 추천 점수가 더 좋아야 한다.',
);
assert.equal(
    freshnessState.explanations.get('old-price')?.factors.at(-1)?.rule,
    'price-freshness',
    '추천 점수 설명에 신선도 규칙이 명시돼야 한다.',
);

const ordinaryAdjacentPrice = {
    ...flight('ordinary-adjacent-price', '인천', '구마모토', 0),
    price: 180_000,
    naverLowest: 200_000,
    naverCheckedAt: '2026-08-28T08:00:00+09:00',
    priceCheckedAt: '2026-08-28T08:00:00+09:00',
};
const expensiveForNearbyDates = {
    ...flight('expensive-for-nearby-dates', '인천', '가고시마', 0),
    price: 180_000,
    naverLowest: 200_000,
    naverCheckedAt: '2026-08-28T08:00:00+09:00',
    priceCheckedAt: '2026-08-28T08:00:00+09:00',
    nearbyNaverBaseline: 130_000,
    nearbyNaverSampleCount: 4,
    nearbyNaverRecommendationMultiplier: 1.3,
};
const nearbyPremiumState = buildRecommendationScoreState(
    [expensiveForNearbyDates, ordinaryAdjacentPrice],
    {},
    recommendationNow,
);
assert.ok(
    nearbyPremiumState.scores.get('expensive-for-nearby-dates')!
        > nearbyPremiumState.scores.get('ordinary-adjacent-price')!,
    '현재 일정만 유독 비싼 표는 동일 조건의 보통 표보다 추천 순위가 뒤로 가야 한다.',
);
assert.equal(
    nearbyPremiumState.explanations.get('expensive-for-nearby-dates')?.factors
        .some(factor => factor.rule === 'nearby-dates'),
    true,
    '앞뒤 7일 가격 근거가 추천 설명에 남아야 한다.',
);

const departureBalanceCandidates = Array.from({ length: 12 }, (_, index) => ({
    ...flight(
        `balance-${index + 1}`,
        index < 4 ? '부산' : '인천',
        `도시${index + 1}`,
        index + 1,
    ),
    price: 100_000 + index * 1_000,
    arrival: {
        city: `도시${index + 1}`,
        airport: `A${String(index).padStart(2, '0')}`,
        date: '2026-09-05',
        time: '18:00',
    },
    priceCheckedAt: '2026-08-28T08:00:00+09:00',
}));
const balanceState = buildRecommendationScoreState(departureBalanceCandidates, {}, recommendationNow);
const balanceRanked = departureBalanceCandidates
    .slice()
    .sort((a, b) => compareRecommendedFlights(
        a,
        b,
        balanceState.scores,
        recommendationNow,
        balanceState.explanations,
    ));
const balancePresentation = buildRecommendationPresentation(balanceRanked, balanceState, {
    balanceIncheon: true,
    now: recommendationNow,
});
const firstNine = balancePresentation.orderedFlights.slice(0, 9);
assert.equal(
    firstNine.filter(item => item.departure.airport === 'ICN').length,
    6,
    '전체 출발지를 볼 때 첫 9개에는 가능한 경우 인천권 표가 6개 들어가야 한다.',
);
assert.equal(
    balancePresentation.explanations.size,
    departureBalanceCandidates.length,
    '후보 판정 → 점수 → 최종 진열 설명이 모든 추천 후보에 있어야 한다.',
);
balancePresentation.orderedFlights.forEach((item, index) => {
    const explanation = balancePresentation.explanations.get(item.id);
    assert.equal(explanation?.candidate.rule, 'passed-current-filters');
    assert.equal(explanation?.display.displayPosition, index + 1);
    assert.ok(explanation?.display.diversityDecision, '진열된 추천 카드에는 적용된 다양성 규칙이 있어야 한다.');
});

const pinnedPresentation = buildRecommendationPresentation(balanceRanked, balanceState, {
    pinnedFlight: balanceRanked[0],
    balanceIncheon: true,
    now: recommendationNow,
});
assert.equal(
    pinnedPresentation.explanations.get(balanceRanked[0].id)?.candidate.rule,
    'today-pick-pinned',
    '오늘의 표는 일반 추천 후보가 아니라 별도 고정 단계로 설명해야 한다.',
);
assert.equal(
    pinnedPresentation.explanations.get(balanceRanked[0].id)?.display.displayPosition,
    1,
    '오늘의 표 설명 위치는 실제 화면처럼 첫 번째여야 한다.',
);
assert.equal(
    pinnedPresentation.orderedFlights.some(item => item.id === balanceRanked[0].id),
    false,
    '오늘의 표는 일반 추천 배열에 중복되면 안 된다.',
);

const visiblePinnedFirstNine = [balanceRanked[0], ...pinnedPresentation.orderedFlights.slice(0, 8)];
assert.equal(
    visiblePinnedFirstNine.filter(item => item.departure.airport === 'ICN').length,
    6,
    'TIKIT DROP도 첫 9개에 포함해 세었을 때 인천권 항공권이 6개여야 한다.',
);

const alternatingCandidates = [
    flight('alt-a1', '인천', '오사카', 1),
    flight('alt-b1', '인천', '후쿠오카', 2),
    flight('alt-a2', '부산', '오사카', 3),
    flight('alt-b2', '부산', '후쿠오카', 4),
    flight('alt-c1', '인천', '도쿄', 5),
];
const alternatingOrder = diversifyFlightDestinations(alternatingCandidates, {
    topWindow: 0,
    maxConsecutiveDestinations: 1,
    balanceIncheon: false,
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
});
assert.equal(
    createsAlternatingDestinationPattern(['오사카', '후쿠오카', '오사카'], '후쿠오카'),
    true,
);
assert.deepEqual(
    alternatingOrder.map(item => item.id),
    ['alt-a1', 'alt-b1', 'alt-a2', 'alt-c1', 'alt-b2'],
    'A-B-A-B 반복이 생길 때는 새로운 목적지를 먼저 보여야 한다.',
);

assert.equal(getAllowedNaverPriceGap(), 20_000);

const qualityCandidates = [
    {
        ...flight('quality-all-three', '인천', '오사카', 1),
        price: 150_000,
        naverLowest: 160_000,
        naverCheckedAt: '2026-08-28T08:00:00+09:00',
        nearbyNaverBaseline: 155_000,
        nearbyNaverSampleCount: 5,
    },
    {
        ...flight('quality-no-naver', '인천', '도쿄', 2),
        price: 155_000,
        nearbyNaverBaseline: 160_000,
        nearbyNaverSampleCount: 5,
    },
    {
        ...flight('quality-small-gap', '인천', '나고야', 3),
        price: 157_500,
        naverLowest: 150_000,
        naverCheckedAt: '2026-08-28T08:00:00+09:00',
        nearbyNaverBaseline: 160_000,
        nearbyNaverSampleCount: 5,
    },
    {
        ...flight('quality-naver-only', '인천', '삿포로', 4),
        price: 300_000,
        naverLowest: 310_000,
        naverCheckedAt: '2026-08-28T08:00:00+09:00',
        nearbyNaverBaseline: 100_000,
        nearbyNaverSampleCount: 5,
    },
    {
        ...flight('quality-other-dates-cheaper', '인천', '후쿠오카', 5),
        price: 160_000,
        nearbyNaverBaseline: 100_000,
        nearbyNaverSampleCount: 5,
    },
];
const qualityHistory = Object.fromEntries(qualityCandidates.map((item, index) => [
    `인천-${item.arrival.city}`,
    Array.from({ length: 7 }, (_, historyIndex) => ({
        date: `2026-08-${String(historyIndex + 1).padStart(2, '0')}`,
        minPrice: index === 3 ? 100_000 + historyIndex * 10_000 : item.price + 10_000 + historyIndex * 10_000,
    })),
]));
const qualityState = buildRecommendationScoreState(
    qualityCandidates,
    {},
    recommendationNow,
    qualityHistory,
);
assert.equal(qualityState.explanations.get('quality-all-three')?.topRecommendationTier, 1);
assert.equal(qualityState.explanations.get('quality-no-naver')?.topRecommendationTier, 3);
assert.equal(qualityState.explanations.get('quality-small-gap')?.topRecommendationTier, 2);
assert.equal(qualityState.explanations.get('quality-naver-only')?.topRecommendationTier, 1);
assert.equal(qualityState.explanations.get('quality-other-dates-cheaper')?.topRecommendationTier, 3);

const seoulInterparkCandidate = {
    ...flight('seoul-interpark', '인천', '인터파크도시', 0),
    price: 205_000,
};
const busanInterparkCandidate = {
    ...flight('busan-interpark', '부산', '인터파크도시', 0),
    price: 205_000,
};
const interparkState = buildRecommendationScoreState(
    [seoulInterparkCandidate, busanInterparkCandidate],
    {
        인터파크도시: {
            '2026-09': { lowest: 200_000, avg: 260_000 },
        },
    },
    recommendationNow,
);
assert.equal(
    interparkState.explanations.get('seoul-interpark')?.interparkEvidenceStrength,
    1,
    '서울권 항공권은 해당 출발 월 인터파크 최저가와 비슷하면 다른 날짜 근거로 사용해야 한다.',
);
assert.equal(
    interparkState.explanations.get('busan-interpark')?.interparkMonthlyLowest,
    null,
    '출발지가 저장되지 않은 인터파크 기준을 부산 출발 항공권에 대입하면 안 된다.',
);

const olderSameGroup = {
    ...flight('older-same-group', '인천', '새도시A', 0),
    price: 180_000,
    firstSeen: '2026-08-20',
};
const newerSameGroup = {
    ...flight('newer-same-group', '인천', '새도시B', 0),
    price: 190_000,
    firstSeen: '2026-08-31',
};
const newnessState = buildRecommendationScoreState(
    [olderSameGroup, newerSameGroup],
    {},
    recommendationNow,
);
assert.deepEqual(
    [olderSameGroup, newerSameGroup]
        .sort((a, b) => compareRecommendedFlights(
            a,
            b,
            newnessState.scores,
            recommendationNow,
            newnessState.explanations,
        ))
        .map(item => item.id),
    ['newer-same-group', 'older-same-group'],
    '가격 근거와 가격 구간이 같은 다른 노선끼리만 신규 등록순을 적용해야 한다.',
);

const priceCompositionCandidates = [
    ...Array.from({ length: 3 }, (_, index) => ({
        ...flight(`over-400-${index}`, '인천', `고가도시${index}`, index),
        price: 450_000,
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
        ...flight(`over-300-${index}`, '인천', `중가도시${index}`, index + 3),
        price: 350_000,
    })),
    ...Array.from({ length: 14 }, (_, index) => ({
        ...flight(`under-250-${index}`, '인천', `저가도시${index}`, index + 6),
        price: 200_000 + index * 1_000,
    })),
];
const priceCompositionOrder = diversifyRecommendationOrder(priceCompositionCandidates, {
    tierOf: () => 0,
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
    expensivePromotionEligibleOf: () => true,
    balanceIncheon: false,
    maxConsecutiveDestinations: 1,
});
const compositionFirstNine = priceCompositionOrder.slice(0, 9);
assert.ok(
    compositionFirstNine.filter(item => item.price <= 250_000).length >= 6,
    '첫 9개에는 25만원 이하 항공권이 최소 6개 있어야 한다.',
);
assert.ok(
    compositionFirstNine.filter(item => item.price >= 300_000 && item.price < 400_000).length <= 2,
    '30만원대 특가는 9개 구간에 최대 2개까지만 보여야 한다.',
);
assert.ok(
    compositionFirstNine.filter(item => item.price >= 400_000).length <= 1,
    '첫 9개에서 40만원 초과 특가는 최대 1개까지만 보여야 한다.',
);

const compositionSecondNine = priceCompositionOrder.slice(9, 18);
assert.ok(
    compositionSecondNine.filter(item => item.price >= 400_000).length <= 1,
    '두 번째 9개 구간도 40만원 초과 특가가 한꺼번에 몰리면 안 된다.',
);
assert.ok(
    priceCompositionOrder.slice(0, 18).filter(item => item.price >= 500_000).length <= 1,
    '50만원 이상 특가는 18개 구간에 최대 한 장만 보여야 한다.',
);

const consecutiveDestinationCandidates = [
    { ...flight('same-destination-a', '인천', '연속도시', 0), price: 170_000 },
    { ...flight('same-destination-b', '인천', '연속도시', 1), price: 175_000 },
    { ...flight('different-destination', '인천', '다른도시', 2), price: 180_000 },
];
const consecutiveDestinationOrder = diversifyRecommendationOrder(consecutiveDestinationCandidates, {
    tierOf: () => 0,
    scoreOf: item => item.price,
    expensivePromotionEligibleOf: () => true,
    balanceIncheon: false,
    maxConsecutiveDestinations: 1,
});
assert.deepEqual(
    consecutiveDestinationOrder.slice(0, 3).map(item => item.arrival.city),
    ['연속도시', '다른도시', '연속도시'],
    '같은 목적지는 바로 이어 붙이지 않아야 한다.',
);

const nonSeoulPinned = {
    ...flight('pinned-non-seoul', '대구', '고정도시', 0),
    departure: { city: '대구', airport: 'TAE', date: '2026-09-01', time: '08:00' },
    price: 190_000,
};
const pinnedDeparturePriorityCandidates = [
    ...Array.from({ length: 8 }, (_, index) => ({
        ...flight(`cheap-non-seoul-${index}`, '부산', `지방도시${index}`, index + 1),
        price: 180_000 + index * 1_000,
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
        ...flight(`seoul-priority-${index}`, '인천', `서울도시${index}`, index + 9),
        price: 350_000 + index * 1_000,
    })),
];
const pinnedDeparturePriorityOrder = diversifyRecommendationOrder(
    pinnedDeparturePriorityCandidates,
    {
        tierOf: () => 0,
        scoreOf: item => item.price,
        expensivePromotionEligibleOf: () => false,
        leadingFlights: [nonSeoulPinned],
        balanceIncheon: true,
        maxConsecutiveDestinations: 1,
    },
);
const visiblePriorityFirstNine = [nonSeoulPinned, ...pinnedDeparturePriorityOrder.slice(0, 8)];
assert.equal(
    visiblePriorityFirstNine.filter(item => item.departure.city === '인천').length,
    6,
    '비서울 TIKIT DROP이 고정돼도 가격 구성보다 인천·김포 6개 규칙을 먼저 지켜야 한다.',
);

console.log('✅ 추천 후보 판정 · 가격/신선도 점수 · 오늘의 표/목적지/출발지 진열 설명');
