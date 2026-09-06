import assert from 'node:assert/strict';
import test from 'node:test';
import type { ListPage, ListScope } from '../src/lib/onlinetour-list-traversal';

// Synthetic offline fixture based on the pilot's sanitized public row shape.
const row = (id: string, extra: Record<string, unknown> = {}) => ({
    event_code: id, event_status_code: '00', dep_start_date: '20260907', arr_start_date: '09-10(목)',
    dep_start_time: '02:10', dep_end_time: '0535', arr_start_time: '1745', arr_end_time: '01:10',
    adult_price: '469000', adult_fee_price: '9000', res_cnt: '0',
    start_city_code: 'ICN', start_city_code_name: '인천', start_city_code2: 'PQC',
    start_city_code_name2: '푸꾸옥', end_city_code: 'PQC', end_city_code2: 'ICN',
    arr_city_code: 'PQC', arr_city_code_name: '푸꾸옥', transport_detail_name: '비엣젯항공', ...extra,
});
const scope: ListScope = { departure: 'ICN', city: 'PQC', month: '202609' };
const page = (pageNo: number, ids: string[], totalCount: number, lastPage: number, nextPageAvailable = pageNo < lastPage): ListPage =>
    ({ pageNo, totalCount, lastPage, nextPageAvailable, rawProducts: ids.map(id => row(id)) });
const offline = { wait: async (_ms: number) => {} };
test('validated rows dedupe across pages/scopes with first record atomic and detached from input', async () => {
    const { traverseOnlineTourLists } = await engine();
    const original: Record<string, unknown> = row('A', { nested: { keep: true } });
    const result = await traverseOnlineTourLists([scope, { ...scope, month: '202610' }], async (s, p) => {
        if (s.month === '202610') {
            (original.nested as { keep: boolean }).keep = false;
            return { ...page(1, [], 1, 1), rawProducts: [row('A', { adult_price: '1', res_cnt: '9' })] };
        }
        return p === 1 ? { ...page(1, [], 3, 2), rawProducts: [original, row('A', { adult_price: '2' })] }
            : page(2, ['B'], 3, 2);
    }, offline);
    assert.equal(result.status, 'review_ready_with_changes');
    assert.deepEqual([result.rawCount, result.uniqueCount, result.duplicateCount, result.failedRowCount], [4, 2, 2, 0]);
    assert.equal(result.flights[0].price, 469000); assert.equal(result.flights[0].availableSeats, 0);
    assert.deepEqual(result.rawProducts[0], row('A', { nested: { keep: true } }));
});

test('every row including duplicates is strictly validated; prior and same-page valid evidence survives', async () => {
    const { traverseOnlineTourLists } = await engine();
    for (const bad of [row('A', { adult_price: '-1' }), row('X', { dep_end_time: '99:99' }), null]) {
        const calls: number[] = [];
        const result = await traverseOnlineTourLists([scope, { ...scope, city: 'NRT' }], async (_s, p) => {
            calls.push(p);
            return p === 1 ? page(1, ['A'], 3, 2) : { ...page(2, [], 3, 2), rawProducts: [bad, row('B')] as never };
        }, offline);
        assert.equal(result.status, 'failed'); assert.deepEqual(calls, [1, 2]);
        assert.deepEqual([result.rawCount, result.uniqueCount, result.duplicateCount, result.failedRowCount], [3, 2, 0, 1]);
        assert.deepEqual(result.flights.map(f => f.id), ['online-A', 'online-B']);
        assert.ok(result.issues.some(i => i.reason === 'invalid_row' && i.row === 0));
    }
});

test('transient retries once on the same page with default delays and separate failure counters', async () => {
    const { traverseOnlineTourLists, ListReadError } = await engine();
    const calls: number[][] = []; const waits: number[] = [];
    const result = await traverseOnlineTourLists([scope], async (_s, p, a) => {
        calls.push([p, a]);
        if (p === 2 && a === 1) throw new ListReadError('transient', 'SECRET https://private');
        return page(p, [String(p)], 2, 2);
    }, { wait: async ms => { waits.push(ms); } });
    assert.deepEqual(calls, [[1, 1], [2, 1], [2, 2]]); assert.deepEqual(waits, [5000, 10000]);
    assert.equal(result.status, 'review_ready');
    assert.deepEqual([result.requestCount, result.retryCount, result.failedRequestCount, result.failedPageCount], [3, 1, 1, 0]);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
});

for (const mode of ['transient', 'access', 'validation', 'unknown', 'transient-access', 'transient-validation'] as const) {
    test(`read failure ${mode} stops run, no later scopes or unsafe retries`, async () => {
        const { traverseOnlineTourLists, ListReadError } = await engine();
        const calls: number[][] = [];
        const result = await traverseOnlineTourLists([scope, { ...scope, city: 'NRT' }], async (_s, p, a) => {
            calls.push([p, a]);
            if (p === 1) return page(1, ['A'], 2, 2);
            if (mode === 'unknown') throw { kind: 'transient', message: 'SECRET' };
            const kind = mode.startsWith('transient-') ? (a === 1 ? 'transient' : mode.split('-')[1]) : mode;
            throw new ListReadError(kind as 'transient' | 'access' | 'validation', 'SECRET');
        }, offline);
        const retried = mode.startsWith('transient');
        assert.deepEqual(calls, retried ? [[1, 1], [2, 1], [2, 2]] : [[1, 1], [2, 1]]);
        assert.equal(result.status, 'failed'); assert.equal(result.uniqueCount, 1);
        assert.equal(result.failedPageCount, 1); assert.equal(result.retryCount, retried ? 1 : 0);
        assert.ok(!JSON.stringify(result).includes('SECRET'));
    });
}

test('hard request/page budgets preserve evidence and stop later scopes', async () => {
    const { traverseOnlineTourLists, ListReadError } = await engine();
    for (const limit of [{ maxRequests: 1 }, { maxPagesPerScope: 1 }]) {
        let calls = 0;
        const result = await traverseOnlineTourLists([scope, { ...scope, city: 'NRT' }], async (_s, p) => {
            if (++calls > 3) throw new Error('test guard');
            return page(p, [String(p)], 3, 3);
        }, { ...offline, ...limit });
        assert.equal(calls, 1); assert.equal(result.status, 'failed'); assert.equal(result.uniqueCount, 1);
        assert.ok(result.issues.some(i => i.reason.endsWith('_budget_exhausted')));
    }
    const result = await traverseOnlineTourLists([scope], async () => { throw new ListReadError('transient', 'secret'); },
        { ...offline, maxRequests: 1 });
    assert.equal(result.requestCount, 1); assert.equal(result.retryCount, 0); assert.equal(result.status, 'failed');
});

test('invalid options fail before calls, wait failures fail closed without retrying', async () => {
    const { traverseOnlineTourLists } = await engine();
    for (const options of [{ maxRequests: Infinity }, { maxPagesPerScope: 0 }, { maxRequests: 1.2 },
        { requestDelayMs: -1 }, { retryDelayMs: NaN }, { wait: 'bad' }]) {
        const result = await traverseOnlineTourLists([scope], async () => { assert.fail('must not read'); }, options as never);
        assert.equal(result.status, 'failed'); assert.equal(result.requestCount, 0);
    }
    const result = await traverseOnlineTourLists([scope], async () => page(1, ['A'], 2, 2),
        { wait: async () => { throw new Error('SECRET'); } });
    assert.equal(result.status, 'failed'); assert.equal(result.requestCount, 1); assert.equal(result.uniqueCount, 1);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
});

for (const [label, patch] of Object.entries({ page_mismatch: { pageNo: 8 }, fractional_page: { pageNo: 1.2 },
    negative_total: { totalCount: -1 }, fractional_total: { totalCount: 1.5 }, unsafe_total: { totalCount: Number.MAX_SAFE_INTEGER + 1 },
    string_total: { totalCount: '1' }, zero_last_nonempty: { lastPage: 0 }, negative_last: { lastPage: -1 },
    missing_screen: { nextPageAvailable: undefined }, inferred_screen: { nextPageAvailable: 0 }, missing_rows: { rawProducts: null },
    oversized_rows: { rawProducts: Array.from({ length: 21 }, (_, i) => row(String(i))) }, empty_positive_total: { rawProducts: [] },
    nonempty_zero_total: { totalCount: 0 }, empty_zero_has_next: { totalCount: 0, rawProducts: [], nextPageAvailable: true },
})) {
    test(`schema ${label} fails without retry or change classification`, async () => {
        const { traverseOnlineTourLists } = await engine();
        const result = await traverseOnlineTourLists([scope], async () => ({ ...page(1, ['A'], 1, 1), ...patch }) as never, offline);
        assert.equal(result.status, 'failed'); assert.equal(result.requestCount, 1); assert.equal(result.retryCount, 0);
        assert.equal(result.uniqueCount, 0); assert.ok(result.issues.some(i => i.reason === 'invalid_page'));
        assert.ok(result.issues.every(i => i.severity === 'error'));
    });
}

test('explicit empty scopes only total0 page1 last0/1 and screen next=false', async () => {
    const { traverseOnlineTourLists } = await engine();
    for (const last of [0, 1]) {
        const result = await traverseOnlineTourLists([scope], async () => page(1, [], 0, last, false), offline);
        assert.equal(result.status, 'review_ready'); assert.equal(result.rawCount, 0);
        assert.equal(result.scopes[0].terminalVerified, true); assert.equal(result.requestCount, 1);
    }
});

test('metadata count changes never restart and shrinking ends early with an explicit warning', async () => {
    const { traverseOnlineTourLists } = await engine();
    for (const last of [2, 3]) {
        const calls: number[] = [];
        const result = await traverseOnlineTourLists([scope], async (_s, p) => {
            calls.push(p); return p === 1 ? page(1, ['A'], 5, 3) : page(2, ['B'], 2, last, false);
        }, offline);
        assert.deepEqual(calls, [1, 2]); assert.equal(result.status, 'review_ready_with_changes');
        assert.equal(result.uniqueCount, 2); assert.equal(result.scopes[0].plannedLastPage, 3);
        assert.equal(result.scopes[0].metadataChanged, true); assert.equal(result.scopes[0].terminalVerified, true);
        assert.ok(result.issues.some(i => i.reason === 'list_metadata_changed'));
    }
});

test('growing page counts freeze the first bound, allow one screen-enabled confirmation and defer further growth', async () => {
    const { traverseOnlineTourLists } = await engine();
    const calls: number[] = [];
    const result = await traverseOnlineTourLists([scope], async (_s, p) => {
        calls.push(p); return page(p, [String(p)], p === 1 ? 2 : 100 + p, p === 1 ? 2 : 100 + p, true);
    }, offline);
    assert.deepEqual(calls, [1, 2, 3]); assert.equal(result.status, 'review_ready_with_changes');
    assert.equal(result.uniqueCount, 3); assert.equal(result.scopes[0].plannedLastPage, 2);
    assert.equal(result.scopes[0].confirmationPage, 3); assert.equal(result.scopes[0].deferredGrowth, true);
    assert.equal(result.scopes[0].terminalVerified, false);
});

test('terminal confirmation is only UI-supported; empty confirmation is not an empty scope', async () => {
    const { traverseOnlineTourLists } = await engine();
    for (const beyond of [[], ['B']]) {
        const result = await traverseOnlineTourLists([scope], async (_s, p) =>
            p === 1 ? page(1, ['A'], 1, 1, true) : page(2, beyond, 1, 1, false), offline);
        assert.equal(result.requestCount, 2); assert.equal(result.scopes[0].terminalVerified, true);
        assert.equal(result.scopes[0].confirmationPage, 2);
        assert.equal(result.uniqueCount, 1 + beyond.length);
        assert.equal(result.status, beyond.length ? 'review_ready_with_changes' : 'review_ready');
    }
    const result = await traverseOnlineTourLists([scope], async () => page(1, ['A'], 1, 1, false), offline);
    assert.equal(result.requestCount, 1); assert.equal(result.scopes[0].confirmationPage, null);
});

test('unchanged metadata missing counts/pages fails; duplicates explain only unique deficits, not missing raw rows', async () => {
    const { traverseOnlineTourLists } = await engine();
    for (const pages of [[page(1, ['A'], 2, 1)], [page(1, ['A'], 1, 2, false)],
        [page(1, ['A'], 3, 2), page(2, ['A'], 3, 2)]]) {
        const result = await traverseOnlineTourLists([scope], async (_s, p) => pages[p - 1], offline);
        assert.equal(result.status, 'failed'); assert.ok(result.issues.some(i => i.reason.startsWith('expected_')));
    }
    const result = await traverseOnlineTourLists([scope], async (_s, p) => page(p, ['A'], 2, 2), offline);
    assert.equal(result.status, 'review_ready_with_changes'); assert.equal(result.uniqueCount, 1);
    assert.equal(result.scopes[0].uniqueCount, 1); assert.equal(result.scopes[0].duplicateCount, 1);
});

test('terminal shrink to empty is observed change, but unexpected empty intermediate is validation failure', async () => {
    const { traverseOnlineTourLists } = await engine();
    for (const [second, status] of [
        [page(2, [], 0, 0, false), 'review_ready_with_changes'],
        [page(2, [], 1, 1, false), 'review_ready_with_changes'],
        [page(2, [], 3, 3, true), 'failed'],
        [page(2, [], 3, 3, false), 'failed'],
        [page(9, [], 0, 0, false), 'failed'],
    ] as const) {
        const result = await traverseOnlineTourLists([scope], async (_s, p) => p === 1 ? page(1, ['A'], 3, 3) : second, offline);
        assert.equal(result.status, status); assert.equal(result.requestCount, 2); assert.equal(result.uniqueCount, 1);
    }
});

test('scope counters separate within-scope duplicates from cross-scope overlap and declare finite coverage', async () => {
    const { traverseOnlineTourLists } = await engine();
    const result = await traverseOnlineTourLists([scope, { ...scope, month: '202610' }], async (_s, p) => page(p, ['A'], 2, 2), offline);
    assert.equal(result.coverage, 'approved_scopes_only');
    assert.deepEqual([result.rawCount, result.uniqueCount, result.duplicateCount, result.failedRowCount], [4, 1, 3, 0]);
    for (const s of result.scopes) assert.deepEqual([s.rawCount, s.uniqueCount, s.duplicateCount], [2, 1, 1]);
});

test('identity cannot be silently normalized or coerced before dedupe, source JSON fields stay lossless', async () => {
    const { traverseOnlineTourLists } = await engine();
    for (const bad of [row(' A '), row(''), row('A', { event_code: 42 }), row('A', { event_code: {} }),
        row('A', { metadata: undefined }), row('A', { metadata: NaN }), row('A', { metadata: new Date(0) })]) {
        const result = await traverseOnlineTourLists([scope], async () => ({ ...page(1, [], 1, 1), rawProducts: [bad] }), offline);
        assert.equal(result.status, 'failed'); assert.equal(result.failedRowCount, 1); assert.equal(result.uniqueCount, 0);
    }
});

test('malformed row/schema after count change is still failed, no restart or later scopes', async () => {
    const { traverseOnlineTourLists } = await engine();
    for (const bad of [{ ...page(3, ['C'], 9, 9), rawProducts: [row('C', { adult_price: 'bad' })] },
        { ...page(3, ['C'], 9, 9), pageNo: 4 }]) {
        const result = await traverseOnlineTourLists([scope, { ...scope, city: 'NRT' }], async (_s, p) =>
            p === 1 ? page(1, ['A'], 3, 3) : p === 2 ? page(2, ['B'], 4, 4) : bad, offline);
        assert.equal(result.status, 'failed'); assert.equal(result.requestCount, 3); assert.equal(result.uniqueCount, 2);
        assert.equal(result.retryCount, 0);
    }
});

test('completed evidence does not retain adapter-owned references or mutate after result return', async () => {
    const { traverseOnlineTourLists } = await engine();
    const data = page(1, ['A'], 1, 1); const originalScope = { ...scope };
    const result = await traverseOnlineTourLists([originalScope], async s => { s.month = '200001'; return data; }, offline);
    const before = JSON.stringify(result);
    data.rawProducts[0].adult_price = '1'; data.rawProducts.push(row('B')); originalScope.month = '200001';
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(JSON.stringify(result), before);
});

test('scope runtime metadata and real year validation fail closed including sparse inputs', async () => {
    const { traverseOnlineTourLists } = await engine();
    for (const scopes of [[{ ...scope, month: '000009' }], [{ ...scope, sort: 1 }], [{ ...scope, filter: {} }],
        [scope, , scope]]) {
        const result = await traverseOnlineTourLists(scopes as ListScope[], async () => { assert.fail('no calls'); }, offline);
        assert.equal(result.status, 'failed'); assert.equal(result.requestCount, 0);
    }
});

test('combined replay policies: one transient, ignored presentation, changed duplicate, one confirmation', async () => {
    const { traverseOnlineTourLists, ListReadError } = await engine();
    const calls: number[][] = [];
    const result = await traverseOnlineTourLists([scope, { ...scope, sort: 'price', filter: 'local-only' }], async (_s, p, a) => {
        calls.push([p, a]);
        if (p === 1 && a === 1) throw new ListReadError('transient', 'offline');
        if (p === 1) return page(1, ['A', 'B'], 4, 2);
        if (p === 2) return { ...page(2, ['B', 'C'], 5, 3), rawProducts: [row('B', { adult_price: '1' }), row('C')] };
        return page(3, ['D'], 5, 3, false);
    }, offline);
    assert.deepEqual(calls, [[1, 1], [1, 2], [2, 1], [3, 1]]);
    assert.equal(result.status, 'review_ready_with_changes');
    assert.deepEqual([result.requestCount, result.retryCount, result.rawCount, result.uniqueCount, result.duplicateCount], [4, 1, 5, 4, 1]);
    assert.equal(result.flights[1].price, 469000); assert.equal(result.scopes[0].terminalVerified, true);
});

const engine = () => import('../src/lib/onlinetour-list-traversal');

test('baseline traverses a small first page, maps actual fields and verifies screen terminal without extra reads', async () => {
    const { traverseOnlineTourLists } = await engine();
    const calls: number[][] = [];
    const result = await traverseOnlineTourLists([scope], async (s, p, a) => {
        assert.deepEqual(s, scope); calls.push([p, a]);
        return p === 1 ? page(1, ['A', 'B'], 3, 2) : page(2, ['C'], 3, 2);
    }, offline);
    assert.deepEqual(calls, [[1, 1], [2, 1]]);
    assert.equal(result.status, 'review_ready');
    assert.equal(result.productionReady, false); assert.equal(result.snapshotComplete, false);
    assert.equal(result.requestCount, 2); assert.equal(result.retryCount, 0);
    assert.equal(result.rawCount, 3); assert.equal(result.uniqueCount, 3); assert.equal(result.duplicateCount, 0);
    assert.deepEqual(result.rawProducts, ['A', 'B', 'C'].map(id => row(id)));
    assert.equal(result.flights[0].price, 469000); assert.equal(result.flights[0].availableSeats, 0);
    assert.equal(result.flights[0].departure.arrivalTime, '05:35');
    assert.equal(result.scopes[0].terminalVerified, true);
});

test('scope dedupe ignores presentation; all scopes preflight before any reads', async () => {
    const { traverseOnlineTourLists } = await engine();
    const seen: ListScope[] = [];
    const result = await traverseOnlineTourLists([{ ...scope, sort: 'price', filter: 'direct' },
        { ...scope, sort: 'date' }, { ...scope, month: '202610' }], async s => {
        seen.push(s); return page(1, ['A'], 1, 1);
    }, offline);
    assert.deepEqual(seen, [scope, { ...scope, month: '202610' }]);
    assert.equal(result.scopes.length, 2);
    for (const invalid of [{ ...scope, departure: 'icn' }, { ...scope, city: 'PQC ' },
        { ...scope, month: '202600' }, { ...scope, month: '202613' }, { ...scope, month: '2026-09' }, null]) {
        let calls = 0;
        const failed = await traverseOnlineTourLists([scope, invalid as ListScope], async () => {
            calls++; return page(1, ['A'], 1, 1);
        }, offline);
        assert.equal(failed.status, 'failed'); assert.equal(calls, 0);
    }
});
