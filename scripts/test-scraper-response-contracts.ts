import assert from 'node:assert/strict';
import {
    keepEarliestDepartureMonthByDestination,
    mapOnlineTourFlight,
} from '../src/lib/scrapers/onlinetour.ts';
import { fetchTtangPromotionInBrowser } from '../src/lib/scrapers/ttang.ts';
import {
    parseMyrealtripBulkPayload,
    parseMyrealtripCalendarPayload,
} from '../src/lib/scrapers/myrealtrip.ts';
import { parseModetourRegionPayload } from '../src/lib/scrapers/modetour.ts';
import {
    assertNoSourceAccessBlockText,
    isExplicitAccessRestrictionStatus,
    parseOnlineTourCities,
    parseOnlineTourJsonp,
    parseTtangPromotionXml,
    retrySourceOperation,
    SourceResponseError,
} from '../src/lib/scrapers/source-response.ts';

function assertSourceError(fn: () => unknown, kind: SourceResponseError['kind']) {
    assert.throws(fn, error => error instanceof SourceResponseError && error.kind === kind);
}

const onlineTourRegionHtml = `<!doctype html><html><body>
<label><input type="radio" name="city" onclick="javascript:goSelectedCity('BOR','20260827');"/> <em>보라카이</em></label>
<label><input name='city' onclick="goSelectedCity('CEB','20260923')"/> <em>세부</em></label>
</body></html>`;

assert.deepEqual(parseOnlineTourCities(onlineTourRegionHtml), [
    { code: 'BOR', name: '보라카이', firstDepartureDate: '20260827' },
    { code: 'CEB', name: '세부', firstDepartureDate: '20260923' },
]);

const onlineTourPayload = parseOnlineTourJsonp(
    'tikitikitTest({"status":200,"message":"OK","data":{"list":[],"count":0,"paging":{"curPage":1,"totalLastPage":1,"totalCount":0}}})',
    'tikitikitTest',
);
assert.equal(onlineTourPayload.status, 200);
assert.deepEqual(onlineTourPayload.data.list, []);
assertSourceError(
    () => parseOnlineTourJsonp('<html>blocked</html>', 'tikitikitTest'),
    'malformed-jsonp',
);
assert.equal(isExplicitAccessRestrictionStatus(403), true);
assert.equal(isExplicitAccessRestrictionStatus(429), true);
assert.equal(isExplicitAccessRestrictionStatus(503), false);
assertSourceError(
    () => assertNoSourceAccessBlockText('테스트 페이지', '<html>비정상적인 접근이 감지되었습니다</html>'),
    'html-response',
);
assert.doesNotThrow(() => assertNoSourceAccessBlockText('정상 페이지', '<html>특가 항공권</html>'));
assert.equal(parseMyrealtripBulkPayload({ lowestPriceInfoList: [{ arrivalCity: 'NRT' }] }).length, 1);
assert.equal(parseMyrealtripCalendarPayload({ flightCalendarInfoResults: [{ date: '2026-09-01' }] }).length, 1);
assertSourceError(() => parseMyrealtripBulkPayload({ result: [] }), 'schema-mismatch');
assertSourceError(() => parseMyrealtripCalendarPayload({ result: [] }), 'schema-mismatch');
assert.equal(parseModetourRegionPayload('{"result":[{"stockPackageNo":1}]}').length, 1);
assertSourceError(() => parseModetourRegionPayload('{"rows":[]}'), 'schema-mismatch');
assertSourceError(() => parseModetourRegionPayload('{broken}'), 'malformed-json');

async function testTtangBrowserRequestContract() {
    const xml = '<RESPONSE><HEAD><error>false</error><message></message></HEAD><RESULT><RECORD><CONTENS><![CDATA[{"code":"OK","desc":"SUCCESS","response":[]}]]></CONTENS></RECORD></RESULT></RESPONSE>';
    const successPage = {
        evaluate: async () => ({
            ok: true,
            status: 201,
            contentType: 'application/xml',
            finalUrl: 'https://mm.ttang.com/ttangair/search/promotion/allTtangListAct.do',
            text: xml,
        }),
    };
    const payload = await fetchTtangPromotionInBrowser(successPage as any, '20260831');
    assert.equal(payload.code, 'OK');
    assert.deepEqual(payload.response, []);

    const blockedPage = {
        evaluate: async () => ({
            ok: false,
            status: 403,
            contentType: 'text/html',
            finalUrl: 'https://mm.ttang.com/ttangair/search/promotion/allTtangListAct.do',
            text: '<html>blocked</html>',
        }),
    };
    await assert.rejects(
        fetchTtangPromotionInBrowser(blockedPage as any, '20260831'),
        error => error instanceof SourceResponseError && error.status === 403,
    );
}
assertSourceError(
    () => parseOnlineTourJsonp('tikitikitTest({"status":500,"message":"down","data":{"list":[]}})', 'tikitikitTest'),
    'api-error',
);

async function testSourceRetries() {
    let transientAttempts = 0;
    const retriedResult = await retrySourceOperation('온라인투어 테스트', async () => {
        transientAttempts++;
        if (transientAttempts < 3) throw new SourceResponseError('network', 'fetch failed', undefined, undefined, 'ECONNRESET');
        return 'ok';
    }, { maxAttempts: 3, delaysMs: [0, 0] });
    assert.equal(retriedResult, 'ok');
    assert.equal(transientAttempts, 3);

    let schemaAttempts = 0;
    await assert.rejects(
        retrySourceOperation('온라인투어 형식 테스트', async () => {
            schemaAttempts++;
            throw new SourceResponseError('schema-mismatch', '필드 변경');
        }, { maxAttempts: 3, delaysMs: [0, 0] }),
        error => error instanceof SourceResponseError && error.kind === 'schema-mismatch',
    );
    assert.equal(schemaAttempts, 1);

    let rateLimitedAttempts = 0;
    await assert.rejects(
        retrySourceOperation('요청 제한 테스트', async () => {
            rateLimitedAttempts++;
            throw new SourceResponseError('http-status', 'HTTP 429', 429);
        }, { maxAttempts: 3, delaysMs: [0, 0] }),
        error => error instanceof SourceResponseError && error.status === 429,
    );
    assert.equal(rateLimitedAttempts, 1);
}

let apiError: SourceResponseError | null = null;
try {
    parseOnlineTourJsonp('tikitikitTest({"status":503,"message":"down","data":{"list":[]}})', 'tikitikitTest');
} catch (error) {
    if (error instanceof SourceResponseError) apiError = error;
}
assert.equal(apiError?.status, 503);

const onlineTourBaseRow = {
    event_code: '260901833163',
    dep_start_date: '20260901',
    arr_start_date: '20260904',
    adult_price: 170_000,
    adult_fee_price: 20_000,
    start_city_code: 'ICN',
    start_city_code_name: '인천',
    start_city_code2: 'PQC',
    start_city_code_name2: '푸꾸옥',
    end_city_code: 'PQC',
    end_city_code2: 'ICN',
    transport_detail_name: '테스트항공',
};
const fallbackDestination = mapOnlineTourFlight(onlineTourBaseRow);
assert.equal(fallbackDestination?.arrival.airport, 'PQC');
assert.equal(fallbackDestination?.arrival.city, '푸꾸옥');

const boracayDestination = mapOnlineTourFlight({
    ...onlineTourBaseRow,
    event_code: '260901833164',
    arr_city_code: 'BOR',
    arr_city_code_name: '보라카이',
    start_city_code2: 'KLO',
    start_city_code_name2: '칼리보',
    end_city_code: 'KLO',
});
assert.equal(boracayDestination?.arrival.airport, 'BOR');
assert.equal(boracayDestination?.routeAirports?.outboundArrival, 'KLO');

const earliestMonthRows = keepEarliestDepartureMonthByDestination([
    {
        ...onlineTourBaseRow,
        event_code: 'pqc-aug',
        dep_start_date: '20260831',
        adult_price: 300_000,
        arr_city_code: 'PQC',
    },
    {
        ...onlineTourBaseRow,
        event_code: 'pqc-aug-no-search-code',
        dep_start_date: '20260830',
        adult_price: 310_000,
        arr_city_code: null,
    },
    {
        ...onlineTourBaseRow,
        event_code: 'pqc-sep-cheaper',
        dep_start_date: '20260901',
        adult_price: 100_000,
        arr_city_code: 'PQC',
    },
    {
        ...onlineTourBaseRow,
        event_code: 'ceb-sep',
        dep_start_date: '20260923',
        arr_city_code: 'CEB',
        start_city_code2: 'CEB',
    },
]);
assert.deepEqual(
    earliestMonthRows.map(row => row.event_code),
    ['pqc-aug', 'pqc-aug-no-search-code', 'ceb-sep'],
);

const ttangPayload = parseTtangPromotionXml(
    '<RESPONSE><HEAD><error>false</error><message></message></HEAD><RESULT><RECORD><CONTENS><![CDATA[{"code":"OK","desc":"SUCCESS","response":[]}]]></CONTENS></RECORD></RESULT></RESPONSE>',
);
assert.equal(ttangPayload.code, 'OK');
assert.deepEqual(ttangPayload.response, []);
assertSourceError(
    () => parseTtangPromotionXml('<!doctype html><html><title>blocked</title></html>'),
    'html-response',
);
assertSourceError(
    () => parseTtangPromotionXml('<RESPONSE><CONTENS><![CDATA[{broken}]]></CONTENS></RESPONSE>'),
    'malformed-json',
);
assertSourceError(
    () => parseTtangPromotionXml('<RESPONSE><CONTENS><![CDATA[{"code":"ERROR","desc":"blocked","response":[]}]]></CONTENS></RESPONSE>'),
    'api-error',
);

Promise.all([testSourceRetries(), testTtangBrowserRequestContract()])
    .then(() => console.log('스크래퍼 응답 계약 테스트 통과'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
