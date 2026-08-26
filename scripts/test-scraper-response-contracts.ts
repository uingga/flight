import assert from 'node:assert/strict';
import {
    parseOnlineTourCities,
    parseOnlineTourJsonp,
    parseTtangPromotionXml,
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
assertSourceError(
    () => parseOnlineTourJsonp('tikitikitTest({"status":500,"message":"down","data":{"list":[]}})', 'tikitikitTest'),
    'api-error',
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

console.log('스크래퍼 응답 계약 테스트 통과');
