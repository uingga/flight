import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import { rememberYbtourScheduleKey } from '../src/lib/scrapers/ybtour';
import { scheduleKeyOf, type ScheduleData, type ScheduleKey } from '../src/lib/scrapers/ybtour-schedule';
import {
    prepareYbtourTimeQueue,
    recordYbtourTimeAttempts,
    YBTOUR_TIME_ADAPTER_VERSION,
    type YbtourTimeEnrichmentState,
} from '../src/lib/ybtour-time-enrichment';

const NOW = new Date('2026-08-31T03:00:00.000Z');
const verified: ScheduleData = {
    flightNumber: 'TW101',
    depTime: '10:00',
    arrTime: '13:30',
    retDepTime: '15:00',
    retArrTime: '22:30',
    minPax: 2,
    baggage: '15 Kg',
};

function scheduleKey(index: number): ScheduleKey {
    return {
        inhId: `TW${index}`,
        inmSeqId: '1',
        inpId: '1',
        depDate: `202609${String((index % 20) + 1).padStart(2, '0')}`,
        bookingCls: 'T',
        remainingSeat: '4',
    };
}

function flight(index: number): Flight {
    const dayNumber = (index % 20) + 1;
    const day = String(dayNumber).padStart(2, '0');
    const value: Flight = {
        id: `ybtour-test-${index}`,
        source: 'ybtour',
        airline: `테스트항공${index}`,
        departure: {
            city: '인천',
            airport: 'ICN',
            date: `2026-09-${day}`,
            time: '',
        },
        arrival: {
            city: `도시${index}`,
            airport: `Y${String(index).padStart(2, '0')}`,
            date: `2026-09-${String(dayNumber + 1).padStart(2, '0')}`,
            time: '',
        },
        price: 100_000 + index,
        currency: 'KRW',
        link: 'https://example.com',
    };
    rememberYbtourScheduleKey(value, scheduleKey(index));
    return value;
}

function emptyState(): YbtourTimeEnrichmentState {
    return { version: 1, entries: {} };
}

// 한 번도 상세 요청하지 않은 후보가 재시도 시각이 된 기존 실패보다 먼저 처리된다.
{
    const old = flight(1);
    const initial = prepareYbtourTimeQueue([old], emptyState(), { now: NOW });
    const oldCandidate = initial.selected[0];
    const state = recordYbtourTimeAttempts(
        initial.state,
        initial.selected,
        new Map([[oldCandidate.scheduleId, { status: 'transient_error' }]]),
        new Date('2026-08-31T00:00:00.000Z'),
    );
    state.entries[oldCandidate.stateKey].nextAttemptAt = '2026-08-31T02:00:00.000Z';

    const fresh = flight(2);
    const queue = prepareYbtourTimeQueue([old, fresh], state, { now: NOW, requestLimit: 1 });
    assert.equal(queue.selected.length, 1);
    assert.equal(queue.selected[0].flights[0].id, fresh.id);
}

// 성공값은 최종 목록에서 잠시 빠졌다 돌아와도 상세 POST 없이 복구된다.
{
    const target = flight(3);
    const first = prepareYbtourTimeQueue([target], emptyState(), { now: NOW });
    const candidate = first.selected[0];
    const state = recordYbtourTimeAttempts(
        first.state,
        first.selected,
        new Map([[candidate.scheduleId, { status: 'success', data: verified }]]),
        NOW,
    );
    const reappeared = flight(3);
    const restored = prepareYbtourTimeQueue([reappeared], state, { now: NOW });
    assert.equal(restored.selected.length, 0);
    assert.equal(restored.stats.restoredFromState, 1);
    assert.equal(reappeared.departure.arrivalTime, '13:30');
    assert.equal(reappeared.arrival.arrivalTime, '22:30');
    assert.equal(reappeared.flightNumber, 'TW101');
}

// 일시 오류는 2시간 뒤, 응답 형식 실패는 처음 3일·반복 뒤 7일 간격으로 재확인한다.
{
    const transientFlight = flight(4);
    const transientQueue = prepareYbtourTimeQueue([transientFlight], emptyState(), { now: NOW });
    const transientCandidate = transientQueue.selected[0];
    const transient = recordYbtourTimeAttempts(
        transientQueue.state,
        transientQueue.selected,
        new Map([[transientCandidate.scheduleId, { status: 'transient_error' }]]),
        NOW,
    );
    assert.equal(transient.entries[transientCandidate.stateKey].nextAttemptAt, '2026-08-31T05:00:00.000Z');

    const formatFlight = flight(5);
    const first = prepareYbtourTimeQueue([formatFlight], emptyState(), { now: NOW });
    const candidate = first.selected[0];
    const once = recordYbtourTimeAttempts(
        first.state,
        first.selected,
        new Map([[candidate.scheduleId, { status: 'response_format', reason: 'missing-legs' }]]),
        NOW,
    );
    assert.equal(once.entries[candidate.stateKey].nextAttemptAt, '2026-09-03T03:00:00.000Z');
    const due = prepareYbtourTimeQueue([flight(5)], once, {
        now: new Date('2026-09-03T03:00:00.000Z'),
    });
    const twice = recordYbtourTimeAttempts(
        due.state,
        due.selected,
        new Map([[candidate.scheduleId, { status: 'response_format', reason: 'missing-legs' }]]),
        new Date('2026-09-03T03:00:00.000Z'),
    );
    assert.equal(twice.entries[candidate.stateKey].nextAttemptAt, '2026-09-10T03:00:00.000Z');
}

// 운영 상한은 외부 옵션으로 높일 수 없고, 형식 실패는 어댑터 변경 시 우선 재검증한다.
{
    const flights = Array.from({ length: 45 }, (_, index) => flight(index + 10));
    const queue = prepareYbtourTimeQueue(flights, emptyState(), { now: NOW, requestLimit: 999 });
    assert.equal(queue.stats.selectedRequests, 40);
    assert.equal(queue.stats.deferred, 5);

    const target = flight(6);
    const initial = prepareYbtourTimeQueue([target], emptyState(), { now: NOW });
    const candidate = initial.selected[0];
    const state = recordYbtourTimeAttempts(
        initial.state,
        initial.selected,
        new Map([[candidate.scheduleId, { status: 'response_format', reason: 'route-mismatch' }]]),
        NOW,
    );
    assert.equal(prepareYbtourTimeQueue([flight(6)], state, { now: NOW }).selected.length, 0);
    state.entries[candidate.stateKey].adapterVersion = `${YBTOUR_TIME_ADAPTER_VERSION}-old`;
    assert.equal(prepareYbtourTimeQueue([flight(6)], state, { now: NOW }).selected.length, 1);
    assert.equal(scheduleKeyOf(initial.selected[0].scheduleKey), candidate.scheduleId);
}

console.log('✅ 노랑풍선 최종 후보 시간 보강 대기열 테스트 통과');
