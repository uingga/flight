import assert from 'node:assert/strict';
import { parseTtangProductSchedule } from '../src/lib/ttang-product-schedule';

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
    () => parseTtangProductSchedule('<html>CAPTCHA access denied</html>', '19858335'),
    /접근 제한 안내/,
);

console.log('✅ 땡처리 상품 일정 파서 테스트 통과');
