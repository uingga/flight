import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { latestMrtSlot, resolveMrtSlot, mrtClaimRef, reserveMrtSlot, checkMrtWatchdog } from '../src/lib/myrealtrip-schedule.mjs';
const now = Date.parse('2026-09-08T09:30:00Z');
const slot = latestMrtSlot(now);
function fake({ runs = [], claimed = false, readStatus, createStatus = 201 } = {}) {
    const calls = [];
    const api = async (path, method = 'GET', body) => {
        calls.push({ path, method, body });
        if (path.startsWith('git/ref/')) return { status: readStatus || (claimed ? 200 : 404), data: {} };
        if (path.includes('/runs?')) return { status: 200, data: { workflow_runs: runs } };
        if (path === 'git/refs') {
            if (claimed) return { status: 422, data: {} };
            if (createStatus === 201) claimed = true;
            return { status: createStatus, data: {} };
        }
        if (path.endsWith('/dispatches')) return { status: 204 };
        throw new Error('Unexpected call');
    };
    return { api, calls };
}
test('latest slot honors UTC/KST and midnight', () => {
    assert.equal(resolveMrtSlot({ schedule: '3 7 * * *', createdAt: new Date(now).toISOString(), now }), null);
    assert.equal(slot.expectedAt, '2026-09-08T06:03:00.000Z');
    assert.equal(latestMrtSlot(Date.parse('2026-09-07T23:00:00Z')).expectedAt, '2026-09-07T21:05:00.000Z');
});
test('late schedule and watchdog resolve to the same slot; stale/future input rejected', () => {
    assert.deepEqual(resolveMrtSlot({ schedule: '3 6 * * *', createdAt: '2026-09-08T09:00:00Z', now }), slot);
    assert.deepEqual(resolveMrtSlot({ expectedAt: slot.expectedAt, now }), slot);
    assert.equal(resolveMrtSlot({ expectedAt: '2026-09-07T06:03:00.000Z', now }), null);
    assert.equal(resolveMrtSlot({ expectedAt: '2026-09-09T06:03:00.000Z', now }), null);
    assert.equal(resolveMrtSlot({ schedule: '5 21 * * *', createdAt: '2026-09-07T23:00:00Z', now }), null);
});
test('parallel contenders can reserve exactly once, including subsequent reruns', async () => {
    const { api } = fake();
    const outcomes = await Promise.all([reserveMrtSlot(api, slot, 'sha', '1'), reserveMrtSlot(api, slot, 'sha', '2')]);
    assert.equal(outcomes.filter(Boolean).length, 1);
    assert.equal(await reserveMrtSlot(api, slot, 'sha', '1'), false);
});
test('API errors fail closed; failed reservation does not permit scraping', async () => {
    await assert.rejects(reserveMrtSlot(fake({ readStatus: 403 }).api, slot, 'sha', '1'));
    await assert.rejects(reserveMrtSlot(fake({ createStatus: 422 }).api, slot, 'sha', '1'));
    await assert.rejects(reserveMrtSlot(fake({ createStatus: 500 }).api, slot, 'sha', '1'));
});
test('pre-rollout completed scheduled run prevents re-collection', async () => {
    const runs = [{ id: 9, event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-09-08T07:00:00Z', display_title: 'MyRealTrip · 3 6 * * *' }];
    assert.equal(await reserveMrtSlot(fake({ runs }).api, slot, 'sha', '1'), false);
    assert.equal((await checkMrtWatchdog(fake({ runs }).api, now)).reason, 'slot_completed');
});
test('previous day success does not suppress today', async () => {
    const runs = [{ event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-09-07T07:00:00Z', display_title: '3 6 * * *' }];
    assert.equal((await checkMrtWatchdog(fake({ runs }).api, now)).action, 'dispatched');
});
test('grace period makes zero GitHub requests', async () => {
    const { api, calls } = fake();
    assert.equal((await checkMrtWatchdog(api, Date.parse(slot.expectedAt) + 4 * 60000)).reason, 'grace_period');
    assert.equal(calls.length, 0);
});
test('active job or failed-but-reserved slot never redispatches', async () => {
    assert.equal((await checkMrtWatchdog(fake({ runs: [{ status: 'queued' }] }).api, now)).reason, 'active_run');
    assert.equal((await checkMrtWatchdog(fake({ claimed: true }).api, now)).reason, 'slot_reserved');
});
test('recent preflight failure is rate-limited; unclaimed run can be recovered later', async () => {
    const runs = [{ status: 'completed', conclusion: 'failure', created_at: new Date(now - 60000).toISOString(), display_title: `watchdog ${slot.expectedAt}` }];
    assert.equal((await checkMrtWatchdog(fake({ runs }).api, now)).reason, 'dispatch_cooldown');
});
test('dispatch carries exact slot and durable ref is deterministic', async () => {
    const { api, calls } = fake();
    assert.equal((await checkMrtWatchdog(api, now)).action, 'dispatched');
    assert.deepEqual(calls.at(-1).body.inputs, { trigger_source: 'watchdog', expected_at: slot.expectedAt });
    assert.equal(mrtClaimRef(slot.expectedAt), 'tags/mrt-slot/20260908T060300000Z');
});
test('workflow gates every live collection stage behind durable reservation', () => {
    const text = fs.readFileSync('.github/workflows/myrealtrip-scrape.yml', 'utf8');
    for (const name of ['Install dependencies', 'Install Playwright browsers', 'Random delay (0~3분)', 'Run MyRealTrip price scraping']) {
        const block = text.slice(text.indexOf(`- name: ${name}`));
        assert.match(block.split(/\n\s+- name:/)[0], /if: steps.slot.outputs.should_run == 'true'/);
    }
    assert.match(text, /group: myrealtrip-price-scrape/);
    assert.match(text, /steps.scrape.outcome == 'success' \|\| steps.scrape.outcome == 'failure'/);
    const route = fs.readFileSync('src/app/api/internal/crawl-watchdog/route.ts', 'utf8');
    assert.ok(route.indexOf('if (!authorized(') < route.indexOf('await checkMrtWatchdog('));
    assert.ok(route.indexOf('await checkMrtWatchdog(') < route.indexOf("if (health.status !== 'overdue'"));
    assert.match(route, /\.catch\(\(error: Error\)/);
});
