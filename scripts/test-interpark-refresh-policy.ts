import assert from 'node:assert/strict';
import { planInterparkCityRefresh, type InterparkBenchmark } from '../src/lib/scrapers/interpark';

const month = {
    '2026-09': {
        lowest: 100_000,
        avg: 200_000,
        depDate: '2026-09-01',
        arrDate: '2026-09-04',
    },
};

const previous: InterparkBenchmark = {
    timestamp: '2026-08-01T00:00:00.000Z',
    prices: {
        BKK: month,
        FUK: month,
        OSA: month,
    },
    cityCheckedAt: {
        BKK: '2026-08-03T00:00:00.000Z',
        FUK: '2026-08-02T00:00:00.000Z',
        OSA: '2026-08-04T00:00:00.000Z',
    },
};

assert.deepEqual(
    planInterparkCityRefresh(['OSA', 'BKK', 'FUK', 'DAD', 'DAD'], previous, 3),
    ['DAD', 'FUK', 'BKK'],
    '데이터가 없는 도시를 먼저 고르고, 기존 도시는 오래 확인하지 않은 순서여야 한다.',
);

const migrated: InterparkBenchmark = {
    timestamp: '2026-08-10T00:00:00.000Z',
    prices: { BKK: month, FUK: month },
};

assert.deepEqual(
    planInterparkCityRefresh(['FUK', 'BKK'], migrated, 1),
    ['BKK'],
    '도시별 시각이 없는 기존 파일은 전체 timestamp를 기준으로 안정적으로 순환해야 한다.',
);

assert.deepEqual(
    planInterparkCityRefresh(['FUK', 'FUK'], migrated, 25),
    ['FUK'],
    '같은 도시를 한 회차에 중복 요청하면 안 된다.',
);

console.log('✅ 인터파크 순환 갱신 정책 테스트 통과');
