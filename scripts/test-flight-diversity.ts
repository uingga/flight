import assert from 'node:assert/strict';
import {
    diversifyFlightDestinations,
    excludePinnedDestination,
    sortFirstBlockByNewestArrival,
    trailingDestinationStreak,
} from '../src/lib/flight-diversity';
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

console.log('✅ 오늘의 표 우선 · 2회 연속 허용 · 첫 9개 목적지당 최대 2개');
