import assert from 'node:assert/strict';
import {
    buildTtangProductDetailUrl,
    parseTtangProductSchedule,
} from '../src/lib/ttang-product-schedule';

const payload = JSON.stringify({
    code: 'OK',
    response: [
        {
            fareRec2: '19858243',
            skdset1Info: '20260915||0900||20260915||1000||PUS||FUK||BX||에어부산',
            skdset2Info: '20260917||1400||20260917||1500||FUK||PUS||BX||에어부산',
            skdset1Detail: 'BX||에어부산||148||PUS||FUK||G||6',
        },
        {
            fareRec2: '19858335',
            skdset1Info: '20260915||0730||20260915||0830||PUS||FUK||BX||에어부산',
            skdset2Info: '20260917||1150||20260917||1300||FUK||PUS||BX||에어부산',
            skdset1Detail: 'BX||에어부산||148||PUS||FUK||G||10',
        },
    ],
});

const result = parseTtangProductSchedule(payload, '19858335');
assert.deepEqual(result, {
    depTime: '07:30',
    arrTime: '08:30',
    retDepTime: '11:50',
    retArrTime: '13:00',
    seats: 10,
});

assert.throws(
    () => parseTtangProductSchedule(payload, 'missing'),
    /요청한 hanaFareId/,
);
assert.throws(
    () => parseTtangProductSchedule(JSON.stringify({ code: 'E001', desc: 'invalid request', response: [] }), '19858335'),
    (error: any) => error?.kind === 'api-error' && error?.causeCode === 'E001',
);
assert.throws(
    () => parseTtangProductSchedule('<html>CAPTCHA access denied</html>', '19858335'),
    /접근 제한 안내/,
);

const detailUrl = new URL(buildTtangProductDetailUrl({
    masterId: 'PUS-FUK-RT-0-3-BX',
    fareId: '19858335',
    departureDate: '2026-09-15',
    returnDate: '2026-09-17',
    adultCount: 2,
}));
assert.equal(detailUrl.pathname, '/ttangair/search/city/detail.do');
assert.equal(detailUrl.searchParams.get('tripType'), 'RT');
assert.equal(detailUrl.searchParams.get('fromSupplyDate'), '20260915');
assert.equal(detailUrl.searchParams.get('toSupplyDate'), '20260917');
assert.equal(detailUrl.searchParams.get('adtCnt'), '2');
assert.equal(detailUrl.searchParams.get('minAdtCnt'), '2');
assert.equal(detailUrl.searchParams.get('masterId'), 'PUS-FUK-RT-0-3-BX');
assert.equal(detailUrl.searchParams.get('hanaFareId'), '19858335');

console.log('✅ 땡처리 상품 일정 파서 테스트 통과');
