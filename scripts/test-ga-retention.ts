import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import Module from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { retentionPlan, parseRetention, loadRetention, shiftDay } from '../src/lib/ga-retention';
import type { ReportRequest, ReportResponse } from '../src/lib/ga4';

const today = '2026-09-21';
const zone = 'Asia/Seoul';
type Person = { id: string; first: string; sessions: string[] };
const people: Person[] = [
    { id: 'repeat', first: '2026-09-10', sessions: ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-12', '2026-09-17'] },
    { id: 'same-day', first: '2026-09-10', sessions: ['2026-09-10', '2026-09-10'] },
    { id: 'late', first: '2026-09-10', sessions: ['2026-09-10', '2026-09-18'] },
    { id: 'immature', first: '2026-09-14', sessions: ['2026-09-14', '2026-09-15'] },
    { id: 'month', first: '2026-08-21', sessions: ['2026-08-21', '2026-09-20'] },
    { id: 'too-late', first: '2026-08-20', sessions: ['2026-08-20', '2026-09-20'] },
];
function fixture(request: ReportRequest, users = people): ReportResponse {
    const expressions = (request.dimensionFilter as any).andGroup.expressions;
    assert.equal(expressions[0].filter.stringFilter.value, 'session_start');
    assert.deepEqual(request.metrics, [{ name: 'totalUsers' }]);
    const filter = expressions[1].filter;
    const eligible = users.filter(user => {
        const date = user.first.replace(/-/g, '');
        return (filter.inListFilter?.values.includes(date) || filter.stringFilter?.value === date)
            && user.sessions.some(session => session >= request.dateRanges[0].startDate && session <= request.dateRanges[0].endDate);
    });
    const metadata = { timeZone: zone };
    if (request.dimensions) {
        const dates = Array.from(new Set(eligible.map(user => user.first)));
        return { metadata, rows: dates.map(date => ({ dimensionValues: [{ value: date.replace(/-/g, '') }],
            metricValues: [{ value: String(new Set(eligible.filter(user => user.first === date).map(user => user.id)).size) }] })) };
    }
    assert.equal(request.dimensions, undefined, 'Never sum per-day user counts');
    return { metadata, rows: [{ metricValues: [{ value: String(new Set(eligible.map(user => user.id)).size) }] }] };
}
test('full-window distinct returns, same-day exclusion, immature exclusion and inclusive day30', () => {
    const plan = retentionPlan(today);
    const result = parseRetention(plan, plan.requests.map(request => fixture(request)), zone);
    assert.deepEqual(result.windows.map(({ users, returnedUsers, rate }) => ({ users, returnedUsers, rate })), [
        { users: 5, returnedUsers: 1, rate: 20 }, // Aug15–Sep13: both August visitors and the three Sep10 visitors.
        { users: 2, returnedUsers: 1, rate: 50 },
    ]);
    assert.equal(result.windows[0].cohortEnd, '2026-09-13');
    assert.equal(result.windows[1].cohortEnd, '2026-08-21');
    assert.equal(result.asOf, '2026-09-20');
});
test('leap day and year boundary use calendar days', () => {
    assert.equal(shiftDay('2024-03-01', -1), '2024-02-29');
    assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
    assert.throws(() => shiftDay('2026-02-30', 1));
});
test('empty cohort is unavailable, not zero percent', () => {
    const plan = retentionPlan(today);
    assert.ok(parseRetention(plan, plan.requests.map(request => fixture(request, [])), zone).windows.every(window => window.rate === null));
});
test('missing, suppressed, sampled, timezone mismatch and inconsistent reports rejected', () => {
    const plan = retentionPlan(today);
    const reports = plan.requests.map(request => fixture(request));
    assert.throws(() => parseRetention(plan, reports.slice(1), zone));
    for (const metadata of [{ subjectToThresholding: true }, { dataLossFromOtherRow: true }, { samplingMetadatas: [{}] }, { timeZone: 'UTC' }]) {
        assert.throws(() => parseRetention(plan, [{ ...reports[0], metadata }, ...reports.slice(1)], zone));
    }
    assert.throws(() => parseRetention(plan, [reports[0], { rows: [{ metricValues: [{ value: '9999' }] }] }, ...reports.slice(2)], zone));
});
test('batch size, single flight and cache; retry after failure', async () => {
    let calls = 0;
    const batch = async (requests: ReportRequest[]) => { calls++; assert.ok(requests.length <= 5); return requests.map(request => fixture(request)); };
    const [a, b] = await Promise.all([loadRetention('test-cache', today, zone, batch), loadRetention('test-cache', today, zone, batch)]);
    assert.deepEqual(a, b);
    assert.equal(calls, 13);
    await loadRetention('test-cache', today, zone, batch);
    assert.equal(calls, 13);
    await assert.rejects(loadRetention('test-failure', today, zone, async () => { throw new Error('offline failure'); }));
    await loadRetention('test-failure', today, zone, batch);
});
test('actual admin API wiring: auth first, totalUsers denominators; retention batch transport', async () => {
    // All authentication is synthetic and in memory. No .env is loaded, no external I/O.
    const oldFetch = globalThis.fetch;
    const originalLoad = (Module as any)._load;
    // Next replaces this build-time poison pill; emulate only that marker in Node tests.
    (Module as any)._load = function (id: string, ...args: unknown[]) {
        return id === 'server-only' ? {} : originalLoad.call(this, id, ...args);
    };
    const names = ['ADMIN_KEY', 'GA4_PROPERTY_ID', 'GA4_CLIENT_EMAIL', 'GA4_PRIVATE_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const old = names.map(name => process.env[name]);
    process.env.ADMIN_KEY = 'offline-admin';
    process.env.GA4_PROPERTY_ID = '123456';
    process.env.GA4_CLIENT_EMAIL = 'offline@example.invalid';
    process.env.GA4_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const requests: ReportRequest[] = [];
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'offline-token', expires_in: 3600 });
        if (!url.startsWith('https://analyticsdata.googleapis.com/')) throw new Error('Unexpected network target blocked');
        const body = JSON.parse(String(init?.body));
        if (url.endsWith(':batchRunReports')) {
            assert.ok(body.requests.length <= 5);
            return Response.json({ reports: body.requests.map(() => ({ rows: [], metadata: { timeZone: zone } })) });
        }
        requests.push(body);
        return Response.json({ rows: [], metadata: { timeZone: zone } });
    };
    try {
        const retention = await import('../src/app/api/ga-retention/route');
        assert.equal((await retention.GET(new NextRequest('http://localhost/api/ga-retention'))).status, 401);
        assert.equal(requests.length, 0);
        const result = await retention.GET(new NextRequest('http://localhost/api/ga-retention', { headers: { 'x-admin-key': 'offline-admin' } }));
        assert.equal((await result.json()).available, true);
        const stats = await import('../src/app/api/ga-stats/route');
        const response = await stats.GET(new NextRequest('http://localhost/api/ga-stats?key=offline-admin'));
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.returning.current.rate, null);
        const segments = requests.filter(request => request.dimensions?.length === 1 && request.dimensions[0].name === 'newVsReturning');
        assert.equal(segments.length, 3);
        assert.ok(segments.every(request => request.metrics[0].name === 'totalUsers'));
        const summaries = requests.filter(request => request.metrics.some(metric => metric.name === 'userEngagementDuration'));
        assert.equal(summaries.length, 5);
        assert.ok(summaries.every(request => request.metrics[0].name === 'totalUsers'));
    } finally {
        globalThis.fetch = oldFetch;
        (Module as any)._load = originalLoad;
        names.forEach((name, i) => { if (old[i] === undefined) delete process.env[name]; else process.env[name] = old[i]; });
    }
});

test('retention view shows both mature cohort counts and no disabled alert metric', async () => {
    const extensions = (Module as any)._extensions;
    const previous = extensions['.css'];
    extensions['.css'] = (module: any) => { module.exports = {}; };
    try {
        const { AdminRetentionView } = await import('../src/components/AdminRetention');
        const plan = retentionPlan(today);
        const data = parseRetention(plan, plan.requests.map(request => fixture(request)), zone);
        const html = renderToStaticMarkup(React.createElement(AdminRetentionView, { data, message: '' }));
        assert.ok(html.includes('7일 이내 재방문율'));
        assert.ok(html.includes('30일 이내 재방문율'));
        assert.ok(html.includes('5명 중 1명 재방문'));
        assert.ok(html.includes('2026-09-13'));
        assert.ok(!html.includes('알림 등록'));
        const empty = renderToStaticMarkup(React.createElement(AdminRetentionView, { data: null, message: '조회 불가' }));
        assert.ok(empty.includes('조회 불가'));
        assert.ok(!empty.includes('0%'));
    } finally { if (previous) extensions['.css'] = previous; else delete extensions['.css']; }
});
