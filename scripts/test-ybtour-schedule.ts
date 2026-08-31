import assert from 'node:assert/strict';
import {
    describeScheduleResponse,
    fetchYbtourSchedules,
    isScheduleResponseFailureSpike,
    parseScheduleDetail,
    parseScheduleDetailWithReason,
} from '../src/lib/scrapers/ybtour-schedule';

const leg = (date: string, time: string, city: string) =>
    `'${date}'+'('+'월'+') '+'${time}'+' '+'${city}'`;

const validHtml = [
    '출국</td>',
    leg('08/21', '10:00', '인천'),
    leg('08/21', '13:30', '방콕'),
    '귀국</td>',
    leg('08/25', '15:00', '방콕'),
    leg('08/25', '22:30', '인천'),
    "carrier_logo/30/'+'TW'",
    "'101'+'편",
    "minpax = Number('2')",
    "'15 Kg'",
].join('\n');

const parsed = parseScheduleDetail(validHtml, '20260821');
assert.deepEqual(parsed, {
    flightNumber: 'TW101',
    depTime: '10:00',
    arrTime: '13:30',
    retDepTime: '15:00',
    retArrTime: '22:30',
    minPax: 2,
    baggage: '15 Kg',
});

assert.deepEqual(parseScheduleDetailWithReason('로그인 페이지', '20260821'), {
    reason: 'missing-sections',
});

const missingLegHtml = [
    '출국</td>',
    leg('08/21', '10:00', '인천'),
    '귀국</td>',
    leg('08/25', '15:00', '방콕'),
].join('\n');
assert.deepEqual(parseScheduleDetailWithReason(missingLegHtml, '20260821'), {
    reason: 'missing-legs',
});

assert.deepEqual(parseScheduleDetailWithReason(validHtml, '20260822'), {
    reason: 'departure-date-mismatch',
});

const wrongRouteHtml = validHtml.replace(
    leg('08/25', '15:00', '방콕'),
    leg('08/25', '15:00', '푸켓'),
);
assert.deepEqual(parseScheduleDetailWithReason(wrongRouteHtml, '20260821'), {
    reason: 'route-mismatch',
});

assert.deepEqual(describeScheduleResponse(validHtml), {
    characters: validHtml.length,
    hasOutbound: true,
    hasInbound: true,
    legMatches: 4,
    looksLikeLogin: false,
});
assert.equal(describeScheduleResponse('LOGIN').looksLikeLogin, true);

assert.equal(isScheduleResponseFailureSpike(29, 4), false);
assert.equal(isScheduleResponseFailureSpike(30, 3), false);
assert.equal(isScheduleResponseFailureSpike(30, 4), true);
assert.equal(isScheduleResponseFailureSpike(200, 20), true);

async function testNoImmediateRetry() {
    let calls = 0;
    const responses = [
        { status: 200, text: '로그인 페이지' },
        { status: 200, text: validHtml },
    ];
    const fakePage = {
        evaluate: async () => {
            calls++;
            return responses.shift() || { status: 500, text: '' };
        },
    };
    const result = await fetchYbtourSchedules(fakePage as never, [{
        inhId: 'TW0101ICNBKK-T3',
        inmSeqId: '1',
        inpId: '1',
        depDate: '20260821',
        bookingCls: 'T',
        remainingSeat: '4',
    }]);

    assert.equal(calls, 1);
    assert.equal(result.schedules.size, 0);
    assert.equal(result.stats.ok, 0);
    assert.equal(result.stats.retryAttempts, 0);
    assert.equal(result.stats.rejected, 1);
    assert.equal(result.attempts.values().next().value?.status, 'response_format');
}

async function testRequestLimit() {
    let calls = 0;
    const fakePage = {
        evaluate: async () => {
            calls++;
            return { status: 200, text: validHtml };
        },
    };
    const keys = ['A', 'B', 'C'].map(inhId => ({
        inhId,
        inmSeqId: '1',
        inpId: '1',
        depDate: '20260821',
        bookingCls: 'T',
        remainingSeat: '4',
    }));
    const result = await fetchYbtourSchedules(fakePage as never, keys, { requestLimit: 2 });

    assert.equal(calls, 2);
    assert.equal(result.schedules.size, 2);
    assert.equal(result.stats.requested, 3);
    assert.equal(result.stats.processed, 2);
    assert.equal(result.stats.httpRequests, 2);
    assert.equal(result.stats.requestLimit, 2);
    assert.equal(result.stats.skipped, 1);
    assert.equal(result.stats.stopReason, 'request-limit');
    assert.equal(result.stats.degraded, false);
    assert.equal(result.attempts.size, 2);
}

Promise.all([testNoImmediateRetry(), testRequestLimit()])
    .then(() => console.log('✅ 노랑풍선 시간 상세 응답 파서·요청 상한 테스트 통과'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
