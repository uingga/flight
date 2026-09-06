import assert from 'node:assert/strict';
import {
    buildTtangProductScheduleRequest,
    parseTtangProductSchedule,
} from '../src/lib/ttang-product-schedule';

const request = new URLSearchParams(buildTtangProductScheduleRequest({
    masterId: '7C3211ICNSPN-G2',
    fareId: '189418',
    fareType: 'VV',
    carrierCode: '7C',
    depCode: 'ICN',
    arrCode: 'SPN',
    departureDate: '2026-09-10',
    arrivalDate: '2026-09-14',
}));
assert.deepEqual(Object.fromEntries(request), {
    fareType: 'VV',
    trip: 'RT',
    dep0: 'ICN',
    arr0: 'SPN',
    dep1: 'SPN',
    arr1: 'ICN',
    fareRec1: '189418',
    depdate0: '20260910',
    depdate1: '20260914',
    hanaFareId: '',
    adt: '1',
    chd: '0',
    inf: '0',
    comp: 'Y',
    car: '7C',
    invArrDateType: 'ALL',
    popularGubun: '',
});

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

const emptyXml = '<RESPONSE><RESULT><RECORD><CONTENS><![CDATA['
    + '{"code":"OK","desc":"SUCCESS","response":[]}'
    + ']]></CONTENS></RECORD></RESULT></RESPONSE>';
assert.equal(parseTtangProductSchedule(emptyXml, '189418'), null);

for (const invalidPayload of [
    [],
    { response: [] },
    { code: '', response: [] },
    { code: 123, response: [] },
    { code: 'OK' },
]) {
    assert.throws(
        () => parseTtangProductSchedule(JSON.stringify(invalidPayload), '189418'),
        (error: any) => {
            assert.equal(error.kind, 'schema-mismatch');
            return true;
        },
    );
}

assert.throws(
    () => parseTtangProductSchedule(JSON.stringify({
        code: 'E001',
        desc: 'INVALID REQUEST',
    }), '189418'),
    (error: any) => {
        assert.equal(error.kind, 'api-error');
        assert.equal(error.causeCode, 'E001');
        return true;
    },
);

assert.throws(
    () => parseTtangProductSchedule(payload, 'missing'),
    /요청한 fareRec1\(missing\)/,
);
assert.throws(
    () => parseTtangProductSchedule('<html>CAPTCHA access denied</html>', '19858335'),
    /접근 제한 안내/,
);

console.log('✅ 땡처리 상품 일정 파서 테스트 통과');
