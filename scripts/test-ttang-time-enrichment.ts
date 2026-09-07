import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import {
    applyTtangLegacyResults,
    nextTtangProductFailureGuard,
    prepareTtangTimeQueue,
    recordTtangTimeAttempts,
    ttangScheduleAttempt,
    ttangTimeKeyOf,
    TTANG_TIME_ADAPTER_VERSION,
    TTANG_TIME_REQUEST_LIMIT,
    type TtangTimeEnrichmentState,
} from '../src/lib/ttang-time-enrichment';
import { SourceResponseError } from '../src/lib/scrapers/source-response';
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

assert.deepEqual(ttangScheduleAttempt(null), { status: 'empty' });

// 동일한 결정적 API 오류는 세 번째 응답에서 남은 상세 요청을 중단한다.
{
    let guard: ReturnType<typeof nextTtangProductFailureGuard>['state'] | undefined;
    const stops: boolean[] = [];
    for (let index = 0; index < 3; index++) {
        const decision = nextTtangProductFailureGuard(
            guard,
            new SourceResponseError(
                'api-error',
                '땡처리닷컴 상품 일정 API 오류 E001',
                undefined,
                undefined,
                'E001',
            ),
        );
        guard = decision.state;
        stops.push(decision.shouldStop);
    }
    assert.deepEqual(stops, [false, false, true]);
}

// 반복 API 오류 중단은 접근 차단으로 둔갑시키지 않는다.
{
    let guard: ReturnType<typeof nextTtangProductFailureGuard>['state'] | undefined;
    let decision;
    for (let index = 0; index < 3; index++) {
        decision = nextTtangProductFailureGuard(
            guard,
            new SourceResponseError('api-error', '잘못된 상세 요청', undefined, undefined, 'E001'),
        );
        guard = decision.state;
    }
    assert.equal(decision?.stopKind, 'api-error');
}

// 같은 응답 형식 오류도 세 번째 응답에서 중단한다.
{
    let guard: ReturnType<typeof nextTtangProductFailureGuard>['state'] | undefined;
    const stops: boolean[] = [];
    for (let index = 0; index < 3; index++) {
        const decision = nextTtangProductFailureGuard(
            guard,
            new SourceResponseError('schema-mismatch', '일정 응답 형식 변경'),
        );
        guard = decision.state;
        stops.push(decision.shouldStop);
    }
    assert.deepEqual(stops, [false, false, true]);
}

// JSON 파싱 오류와 스키마 오류가 섞여도 같은 응답 형식 계열로 세어 조기에 중단한다.
{
    let guard: ReturnType<typeof nextTtangProductFailureGuard>['state'] | undefined;
    const errors = [
        new SourceResponseError('schema-mismatch', '필수 필드 누락'),
        new SourceResponseError('malformed-json', 'JSON 파싱 실패'),
        new SourceResponseError('schema-mismatch', '다른 필수 필드 누락'),
    ];
    const stops = errors.map(error => {
        const decision = nextTtangProductFailureGuard(guard, error);
        guard = decision.state;
        return decision.shouldStop;
    });
    assert.deepEqual(stops, [false, false, true]);
}

// 일시적인 네트워크 오류는 여덟 번째까지 허용하되 실패할수록 더 오래 쉰다.
{
    let guard: ReturnType<typeof nextTtangProductFailureGuard>['state'] | undefined;
    const stops: boolean[] = [];
    const delays: Array<[number, number] | null> = [];
    for (let index = 0; index < 8; index++) {
        const decision = nextTtangProductFailureGuard(
            guard,
            new SourceResponseError('network', '일시적인 연결 실패'),
        );
        guard = decision.state;
        stops.push(decision.shouldStop);
        delays.push(decision.delaySeconds);
    }
    assert.deepEqual(stops, [false, false, false, false, false, false, false, true]);
    assert.deepEqual(delays, [
        [4, 6.4],
        [8, 12.8],
        [16, 25.6],
        [30, 48],
        [30, 48],
        [30, 48],
        [30, 48],
        null,
    ]);
}

// 오류 종류가 섞여도 전체 연속 실패 횟수에 따라 대기를 늘리고 여덟 번째에 중단한다.
{
    let guard: ReturnType<typeof nextTtangProductFailureGuard>['state'] | undefined;
    const errors = Array.from({ length: 8 }, (_, index) => index % 2 === 0
        ? new SourceResponseError('api-error', `API 오류 E00${index}`, undefined, undefined, `E00${index}`)
        : new SourceResponseError('network', `연결 실패 ${index}`));
    const decisions = errors.map(error => {
        const decision = nextTtangProductFailureGuard(guard, error);
        guard = decision.state;
        return decision;
    });
    assert.deepEqual(decisions.map(decision => decision.delaySeconds), [
        [4, 6.4],
        [8, 12.8],
        [16, 25.6],
        [30, 48],
        [30, 48],
        [30, 48],
        [30, 48],
        null,
    ]);
    assert.equal(decisions.at(-1)?.shouldStop, true);
}

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
    return { version: 2, entries: {} };
}

// 같은 노선·날짜·항공사라도 hanaFareId가 다르면 서로 다른 상세 상품이다.
{
    const cheaper = flight(30, {
        id: 'ttang-shared-100-2026-09-10',
        ttangProduct: { masterId: 'shared', fareId: '100' },
    });
    const expensive = flight(30, {
        id: 'ttang-shared-200-2026-09-10',
        price: 200_000,
        ttangProduct: { masterId: 'shared', fareId: '200' },
    });
    assert.notEqual(ttangTimeKeyOf(cheaper), ttangTimeKeyOf(expensive));
    const queue = prepareTtangTimeQueue([cheaper, expensive], emptyState(), { now: NOW });
    assert.equal(queue.selected.length, 2);
}

// 목록에서 저장한 운임 종류와 항공사 코드가 실제 상세 요청 정보로 이어진다.
{
    const target = flight(30, {
        ttangProduct: {
            masterId: '7C3211ICNSPN-G2',
            fareId: '189418',
            fareType: 'VV',
            carrierCode: '7C',
        },
    });
    const queue = prepareTtangTimeQueue([target], emptyState(), { now: NOW });
    assert.deepEqual(queue.selected[0].product, {
        masterId: '7C3211ICNSPN-G2',
        fareId: '189418',
        fareType: 'VV',
        carrierCode: '7C',
        depCode: 'ICN',
        arrCode: 'T30',
        departureDate: '20260911',
        arrivalDate: '20260912',
    });
}

// 상세 메타데이터가 불완전한 여러 상품은 노선 결과를 각 상품 키에 적용·저장한다.
{
    const first = flight(30, {
        id: 'ttang-legacy-product-100',
        ttangProduct: { masterId: 'shared', fareId: '100' },
    });
    const second = flight(30, {
        id: 'ttang-legacy-product-200',
        ttangProduct: { masterId: 'shared', fareId: '200' },
    });
    const queue = prepareTtangTimeQueue([first, second], emptyState(), { now: NOW });
    const routeKey = enrichKeyOf(queue.selected[0].route);
    const attempts = new Map();

    applyTtangLegacyResults(queue.selected, {
        attempts: new Map([[routeKey, { status: 'success', data }]]),
        enrichMap: new Map([[routeKey, data]]),
    }, attempts, NOW.toISOString());

    assert.deepEqual(
        Array.from(attempts.keys()).sort(),
        queue.selected.map(candidate => candidate.key).sort(),
    );
    assert.equal(first.departure.time, data.depTime);
    assert.equal(second.arrival.arrivalTime, data.retArrTime);
    assert.equal(first.availableSeats, data.seats);
    assert.equal(first.seats, `${data.seats}석`);
    assert.equal(first.detailCheckedAt, NOW.toISOString());

    const state = recordTtangTimeAttempts(queue.state, queue.selected, attempts, NOW);
    assert.deepEqual(state.entries[ttangTimeKeyOf(first)].data, data);
    assert.deepEqual(state.entries[ttangTimeKeyOf(second)].data, data);
}

// 새 상세 응답에서 좌석을 확인하지 못했으면 이전 항공편의 좌석 수를 지운다.
{
    const target = flight(30, {
        availableSeats: 7,
        seats: '7석',
    });
    const queue = prepareTtangTimeQueue([target], emptyState(), { now: NOW });
    const routeKey = enrichKeyOf(queue.selected[0].route);
    const noVerifiedSeats = { ...data, seats: 0 };

    applyTtangLegacyResults(queue.selected, {
        attempts: new Map([[routeKey, { status: 'success', data: noVerifiedSeats }]]),
        enrichMap: new Map([[routeKey, noVerifiedSeats]]),
    }, new Map(), NOW.toISOString());

    assert.equal(target.availableSeats, undefined);
    assert.equal(target.seats, undefined);
    assert.equal(target.detailCheckedAt, NOW.toISOString());
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

// 성공한 상세도 3일 뒤에는 다시 확인하고, 재확인이 실패해도 마지막 성공값은 보존한다.
{
    const target = flight(31, {
        ttangProduct: { masterId: 'refresh', fareId: '310' },
    });
    const first = prepareTtangTimeQueue([target], emptyState(), { now: NOW });
    const key = first.selected[0].key;
    const success = recordTtangTimeAttempts(first.state, first.selected, new Map([
        [key, { status: 'success', data }],
    ]), NOW);
    assert.equal(prepareTtangTimeQueue([flight(31, {
        ttangProduct: { masterId: 'refresh', fareId: '310' },
    })], success, {
        now: new Date('2026-09-02T03:00:00.000Z'),
    }).selected.length, 0);

    const staleFlight = flight(31, {
        ttangProduct: { masterId: 'refresh', fareId: '310' },
    });
    const due = prepareTtangTimeQueue([staleFlight], success, {
        now: new Date('2026-09-03T03:00:00.000Z'),
    });
    assert.equal(due.selected.length, 1);
    const failed = recordTtangTimeAttempts(due.state, due.selected, new Map([
        [key, { status: 'transient_error' }],
    ]), new Date('2026-09-03T03:00:00.000Z'));
    assert.deepEqual(failed.entries[key].data, data);
    assert.equal(failed.entries[key].lastSuccessAt, NOW.toISOString());
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

// Explicit staging scope removes only the count cap, not retry eligibility.
{
    const flights = Array.from({ length: 25 }, (_, index) => flight(index + 6));
    const queue = prepareTtangTimeQueue(flights, emptyState(), { now: NOW, allEligible: true });
    assert.equal(queue.stats.selected, 25);
    assert.equal(queue.stats.deferred, 0);
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
