import assert from 'node:assert/strict';
import {
    diversifyFlightDestinations,
    diversifyFlightDestinationsWithDecisions,
    diversifyRecommendationOrder,
    excludePinnedDestination,
    sortFirstBlockByNewestArrival,
    trailingDestinationStreak,
} from '../src/lib/flight-diversity';
import {
    buildRecommendationPresentation,
    buildRecommendationScoreState,
    compareRecommendedFlights,
} from '../src/lib/flight-recommendation';
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
    2,
    '같은 출발권역·목적지라도 최저가가 같으면 첫 9개에 두 일정까지 보여야 한다.',
);
assert.deepEqual(
    deduplicatedFirstNine.slice(0, 2).map(item => item.id),
    ['bandar-1', 'bandar-2'],
    '같은 최저가의 다른 일정은 기존 추천순대로 연속 노출할 수 있어야 한다.',
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
    { ...flight('tier-expensive', '인천', '사이판', 1), price: 379_000 },
    flight('tier-cheap', '인천', '사이판', 20),
    ...Array.from({ length: 8 }, (_, index) => flight(
        `tier-other-${index + 1}`,
        '인천',
        `구간다른도시${index + 1}`,
        index + 2,
    )),
], {
    tierOf: item => item.id === 'tier-cheap' ? 1 : 0,
    scoreOf: item => (item as Flight & { testScore: number }).testScore,
    balanceIncheon: false,
});
assert.equal(
    differentTierSameRoute.slice(0, 9).some(item => item.id === 'tier-cheap'),
    true,
    '비교가 구간이 달라도 같은 노선의 최저가 대표가 첫 9개에 들어가야 한다.',
);
assert.equal(
    differentTierSameRoute.slice(0, 9).some(item => item.id === 'tier-expensive'),
    false,
    '비교가 구간이 앞선다는 이유로 더 비싼 같은 노선 표를 첫 9개에 남기면 안 된다.',
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
    .sort((a, b) => compareRecommendedFlights(a, b, tierState.scores, recommendationNow));
assert.deepEqual(
    tierRanked.map(item => item.id),
    ['verified-quality', 'unverified-cheap'],
    '검증된 외부 비교가 이하 구간은 점수가 더 낮은 비교 불가 표보다 먼저여야 한다.',
);

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
    nearbyPremiumState.explanations.get('expensive-for-nearby-dates')?.factors.at(-1)?.rule,
    'nearby-date-premium',
    '인접 일정 가격 감점이 추천 점수 설명에 남아야 한다.',
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
    .sort((a, b) => compareRecommendedFlights(a, b, balanceState.scores, recommendationNow));
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

console.log('✅ 추천 후보 판정 · 가격/신선도 점수 · 오늘의 표/목적지/출발지 진열 설명');
