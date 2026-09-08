import test from 'node:test';
import assert from 'node:assert/strict';
import { createTtangRequestAudit, ttangListPageEvidence } from '../src/lib/ttang-request-audit.mjs';

test('counts automatic requests, explicit calls, retries, failures and pending requests separately', () => {
    const audit = createTtangRequestAudit();
    const req = (url, nav = false) => ({ url: () => url, isNavigationRequest: () => nav });
    const page = req('https://mm.ttang.com/page?private=value', true);
    const auto = req('https://mm.ttang.com/ttangair/search/promotion/allTtangListAct.do');
    const retry = req(auto.url());
    const detail = req('https://mm.ttang.com/ttangair/search/city/scheduleAct.do');
    const asset = req('https://example.org/a?secret=hidden');
    for (const r of [page, auto, retry, detail, asset]) audit.request(r);
    audit.request(auto);
    audit.response({ request: () => page, status: () => 200 }); audit.finished(page);
    audit.failed(auto);
    const blocked = { request: () => retry, status: () => 429 };
    audit.response(blocked); audit.response(blocked); audit.finished(retry);
    audit.response({ request: () => detail, status: () => 200 }); audit.failed(detail);
    assert.deepEqual(audit.snapshot(), { started: 5, responses: 3, failed: 2, pending: 1,
        promotion: 2, schedule: 1, documents: 1, other: 1, restrictedResponses: 1 });
    assert.doesNotMatch(JSON.stringify(audit.snapshot()), /secret|private|https/);
});
for (const count of [0, 5, 45, 199, 200, 201]) test(`client-array contract does not invent a limit at ${count}`, () => {
    const e = ttangListPageEvidence('20260907', count, 2);
    assert.equal(e.reason, 'client_array_pagination_20260907'); assert.equal(e.returnedCount, count);
    assert.equal(e.attempt, 2);
});
test('rejects malformed count and attempt evidence', () => {
    for (const n of [-1, NaN, 1.5]) assert.throws(() => ttangListPageEvidence('20260907', n, 1));
    assert.throws(() => ttangListPageEvidence('20260907', 1, 0));
});
