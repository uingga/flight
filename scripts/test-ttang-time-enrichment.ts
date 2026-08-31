import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import {
    prepareTtangTimeQueue,
    recordTtangTimeAttempts,
    TTANG_TIME_ADAPTER_VERSION,
    TTANG_TIME_REQUEST_LIMIT,
    type TtangTimeEnrichmentState,
} from '../src/lib/ttang-time-enrichment';
import type { EnrichData } from '../src/lib/utils/realtime-enrich';
import {
    enrichKeyOf,
    enrichWithRealtimeData,
    type RouteKey,
} from '../src/lib/utils/realtime-enrich';

const NOW = new Date('2026-08-31T03:00:00.000Z');
const data: EnrichData = {
    depTime: '09:00',
    arrTime: '10:30',
    retDepTime: '18:00',
    retArrTime: '19:30',
    seats: 4,
};

function flight(index: number, overrides: Partial<Flight> = {}): Flight {
    const dayNumber = (index % 20) + 1;
    const day = String(dayNumber).padStart(2, '0');
    return {
        id: `ttang-test-${index}`,
        source: 'ttang',
        airline: `테스트항공${index}`,
        departure: {
            city: '서울',
            airport: 'ICN',
            date: `2026-09-${day}`,
            time: '',
        },
        arrival: {
            city: `도시${index}`,
            airport: `T${String(index).padStart(2, '0')}`,
            date: `2026-09-${String(dayNumber + 1).padStart(2, '0')}`,
            time: '',
        },
        price: 100_000 + index,
        currency: 'KRW',
        link: 'https://example.com',
        ...overrides,
    };
}

function emptyState(): TtangTimeEnrichmentState {
    return { version: 1, entries: {} };
}

// 신규(상태 없음)는 재시도 가능 시각이 된 기존 실패보다 먼저 처리한다.
{
    const old = flight(1);
    const initial = prepareTtangTimeQueue([old], emptyState(), { now: NOW });
    const oldKey = initial.selected[0].key;
    const state = recordTtangTimeAttempts(
        initial.state,
        initial.selected,
        new Map([[oldKey, { status: 'transient_error' }]]),
        new Date('2026-08-31T00:00:00.000Z'),
    );
    state.entries[oldKey].nextAttemptAt = '2026-08-31T02:00:00.000Z';

    const fresh = flight(2);
    const queue = prepareTtangTimeQueue([old, fresh], state, { now: NOW, requestLimit: 1 });
    assert.equal(queue.selected.length, 1);
    assert.equal(queue.selected[0].flights[0].id, fresh.id);
}

// 성공값은 최종 목록에서 잠시 사라졌다 돌아와도 네트워크 없이 복구한다.
{
    const target = flight(3);
    const first = prepareTtangTimeQueue([target], emptyState(), { now: NOW });
    const key = first.selected[0].key;
    const state = recordTtangTimeAttempts(
        first.state,
        first.selected,
        new Map([[key, { status: 'success', data }]]),
        NOW,
    );
    const reappeared = flight(3);
    const restored = prepareTtangTimeQueue([reappeared], state, { now: NOW });
    assert.equal(restored.selected.length, 0);
    assert.equal(restored.stats.restoredFromState, 1);
    assert.equal(reappeared.departure.arrivalTime, '10:30');
    assert.equal(reappeared.arrival.arrivalTime, '19:30');
}

// 빈 결과는 처음 3일, 반복 확인 뒤에는 7일 동안 다시 조회하지 않는다.
{
    const target = flight(4);
    const first = prepareTtangTimeQueue([target], emptyState(), { now: NOW });
    const key = first.selected[0].key;
    const once = recordTtangTimeAttempts(
        first.state,
        first.selected,
        new Map([[key, { status: 'empty' }]]),
        NOW,
    );
    assert.equal(once.entries[key].nextAttemptAt, '2026-09-03T03:00:00.000Z');
    assert.equal(prepareTtangTimeQueue([flight(4)], once, {
        now: new Date('2026-09-02T03:00:00.000Z'),
    }).selected.length, 0);

    const due = prepareTtangTimeQueue([flight(4)], once, {
        now: new Date('2026-09-03T03:00:00.000Z'),
    });
    const twice = recordTtangTimeAttempts(
        due.state,
        due.selected,
        new Map([[key, { status: 'empty' }]]),
        new Date('2026-09-03T03:00:00.000Z'),
    );
    assert.equal(twice.entries[key].nextAttemptAt, '2026-09-10T03:00:00.000Z');
}

// 항공사/형식 불일치는 같은 어댑터로 반복하지 않고 구현 버전이 바뀔 때만 재검사한다.
{
    const target = flight(5);
    const first = prepareTtangTimeQueue([target], emptyState(), { now: NOW });
    const key = first.selected[0].key;
    const mismatch = recordTtangTimeAttempts(
        first.state,
        first.selected,
        new Map([[key, { status: 'airline_mismatch' }]]),
        NOW,
    );
    assert.equal(prepareTtangTimeQueue([flight(5)], mismatch, { now: NOW }).selected.length, 0);
    mismatch.entries[key].adapterVersion = `${TTANG_TIME_ADAPTER_VERSION}-old`;
    assert.equal(prepareTtangTimeQueue([flight(5)], mismatch, { now: NOW }).selected.length, 1);
}

// 환경값으로 상한을 높일 수 없으며 서로 다른 실시간 페이지는 회차당 20개까지만 연다.
{
    const flights = Array.from({ length: 25 }, (_, index) => flight(index + 6));
    const queue = prepareTtangTimeQueue(flights, emptyState(), { now: NOW, requestLimit: 999 });
    assert.equal(queue.stats.selectedRoutes, TTANG_TIME_REQUEST_LIMIT);
    assert.equal(queue.stats.deferred, 5);
}

class FakePage {
    private handler?: (response: any) => void;

    constructor(
        private readonly apiStatus: number,
        private readonly apiText: string,
    ) {}

    on(_event: string, handler: (response: any) => void) {
        this.handler = handler;
    }

    off(_event: string, handler: (response: any) => void) {
        if (this.handler === handler) this.handler = undefined;
    }

    async goto(url: string) {
        const handler = this.handler;
        if (handler) {
            await handler({
                url: () => 'https://mm.ttang.com/ttangair/search/realtime_V2/listAct.do',
                status: () => this.apiStatus,
                text: async () => this.apiText,
            });
        }
        return {
            status: () => 200,
            headers: () => ({ 'content-type': 'text/html' }),
            url: () => url,
        };
    }
}

async function testRealtimeOutcomes() {
    const route: RouteKey = {
        depCode: 'ICN',
        arrCode: 'KIX',
        depDate: '20260910',
        arrDate: '20260912',
        airline: '피치항공',
    };
    const key = enrichKeyOf(route);
    const entry = {
        skdset1Info: '20260910||0900||20260910||1050||ICN||KIX||MM||피치항공',
        skdset2Info: '20260912||1800||20260912||1950||KIX||ICN||MM||피치항공',
        skdset1Detail: 'MM||피치항공||0712||ICN||KIX||G||4',
    };

    const success = await enrichWithRealtimeData(
        new FakePage(200, JSON.stringify({ code: 'OK', response: [entry] })) as any,
        [route],
        '테스트',
    );
    assert.equal(success.attempts.get(key)?.status, 'success');
    assert.equal(success.enrichMap.get(key)?.retArrTime, '19:50');

    const empty = await enrichWithRealtimeData(
        new FakePage(200, JSON.stringify({ code: 'OK', response: [] })) as any,
        [route],
        '테스트',
    );
    assert.equal(empty.attempts.get(key)?.status, 'empty');

    const mismatch = await enrichWithRealtimeData(
        new FakePage(200, JSON.stringify({
            code: 'OK',
            response: [{ ...entry, skdset1Info: entry.skdset1Info.replace('피치항공', '제주항공') }],
        })) as any,
        [route],
        '테스트',
    );
    assert.equal(mismatch.attempts.get(key)?.status, 'airline_mismatch');

    await assert.rejects(
        enrichWithRealtimeData(new FakePage(429, '') as any, [route], '테스트'),
        /HTTP 429/,
    );

    await assert.rejects(
        enrichWithRealtimeData(
            new FakePage(200, '<html><body>CAPTCHA - access denied</body></html>') as any,
            [route],
            '테스트',
        ),
        /접근 제한 안내/,
    );
}

testRealtimeOutcomes()
    .then(() => console.log('✅ 땡처리 시간 보강 대기열 테스트 통과'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
