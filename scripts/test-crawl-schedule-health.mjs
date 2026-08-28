import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import {
    DAILY_CRAWL_CRONS,
    getCrawlScheduleHealth,
} from '../src/lib/crawl-schedule-health.mjs';
import { getCrawlDispatchBlocker } from '../src/lib/crawl-watchdog-dispatch.mjs';

test('warns 45 minutes after an uncovered crawl slot', () => {
    const health = getCrawlScheduleHealth('2026-08-27T15:50:00.000Z', {
        now: '2026-08-28T00:00:00.000Z',
    });

    assert.equal(health.status, 'late');
    assert.equal(health.expectedAt, '2026-08-27T23:13:00.000Z');
    assert.equal(health.delayMinutes, 47);
});

test('dispatch threshold starts at 60 minutes', () => {
    const health = getCrawlScheduleHealth('2026-08-27T15:50:00.000Z', {
        now: '2026-08-28T00:13:00.000Z',
    });

    assert.equal(health.status, 'overdue');
    assert.equal(health.delayMinutes, 60);
});

test('a newly due slot does not hide an older missed slot', () => {
    const health = getCrawlScheduleHealth('2026-08-27T15:50:00.000Z', {
        now: '2026-08-28T00:55:00.000Z',
    });

    assert.equal(health.status, 'overdue');
    assert.equal(health.expectedAt, '2026-08-27T23:13:00.000Z');
    assert.equal(health.pendingSlots, 2);
});

test('a completion covers all earlier slots and leaves only the next slot waiting', () => {
    const health = getCrawlScheduleHealth('2026-08-28T00:50:00.000Z', {
        now: '2026-08-28T00:55:00.000Z',
    });

    assert.equal(health.status, 'waiting');
    assert.equal(health.expectedAt, '2026-08-28T00:53:00.000Z');
    assert.equal(health.delayMinutes, 2);
});

test('health schedule stays in sync with daily-crawl.yml', () => {
    const workflow = fs.readFileSync('.github/workflows/daily-crawl.yml', 'utf8');
    const workflowCrons = [...workflow.matchAll(/^\s*- cron: '([^']+)'/gm)].map(match => match[1]);
    assert.deepEqual([...DAILY_CRAWL_CRONS].sort(), workflowCrons.sort());
});

test('watchdog dispatch inputs are declared by daily-crawl.yml', () => {
    const dailyWorkflow = fs.readFileSync('.github/workflows/daily-crawl.yml', 'utf8');
    const watchdogWorkflow = fs.readFileSync('.github/workflows/crawl-watchdog.yml', 'utf8');

    for (const input of ['trigger_source', 'expected_at']) {
        assert.match(dailyWorkflow, new RegExp(`^\\s{6}${input}:`, 'm'));
        assert.match(watchdogWorkflow, new RegExp(`^\\s{16}${input}:`, 'm'));
    }
});

test('today pick has a 06:17 KST selection slot', () => {
    const workflow = fs.readFileSync('.github/workflows/today-pick.yml', 'utf8');
    assert.match(workflow, /^\s*- cron: '17 21 \* \* \*'/m);
});

test('MyRealTrip runs once in the morning and once in the afternoon', () => {
    const workflow = fs.readFileSync('.github/workflows/myrealtrip-scrape.yml', 'utf8');
    const workflowCrons = [...workflow.matchAll(/^\s*- cron: '([^']+)'/gm)].map(match => match[1]);
    assert.deepEqual(workflowCrons.sort(), ['5 22 * * *', '3 9 * * *'].sort());
});

test('the 11:56 general crawl dispatches Naver immediately after saving data', () => {
    const dailyWorkflow = fs.readFileSync('.github/workflows/daily-crawl.yml', 'utf8');
    const naverWorkflow = fs.readFileSync('.github/workflows/naver-crawl.yml', 'utf8');

    assert.match(dailyWorkflow, /Start Naver price crawl after 11:56 crawl/);
    assert.match(dailyWorkflow, /needs\.preflight\.outputs\.is_today_pick_slot == 'true'/);
    assert.match(dailyWorkflow, /workflow_id: 'naver-crawl\.yml'/);
    assert.doesNotMatch(naverWorkflow, /^\s+workflow_run:/m);
});

test('watchdog fallback keeps the 11:56 today-pick slot identity', () => {
    const result = spawnSync(process.execPath, ['scripts/check-crawl-run.mjs'], {
        encoding: 'utf8',
        env: {
            ...process.env,
            TRIGGER_EVENT: 'workflow_dispatch',
            TRIGGER_SOURCE: 'watchdog',
            EXPECTED_AT: '2026-08-28T02:56:00.000Z',
            CHECK_NOW: '2026-08-28T04:30:00.000Z',
        },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[preflight\] is_today_pick_slot=true/);
});

test('every completed crawl validates today pick after the deployed cache catches up', () => {
    const workflow = fs.readFileSync('.github/workflows/daily-crawl.yml', 'utf8');
    assert.match(workflow, /^\s+is_today_pick_slot: \$\{\{ steps\.trigger\.outputs\.is_today_pick_slot \}\}/m);
    assert.match(workflow, /run: node scripts\/wait-for-flight-api-cache\.mjs/);
    assert.match(workflow, /node scripts\/select-today-pick\.mjs --repair/);
});

test('an active crawl blocks a fallback dispatch', () => {
    const blocker = getCrawlDispatchBlocker([
        { id: 101, status: 'in_progress', html_url: 'https://example.com/runs/101' },
    ], '2026-08-28T06:17:00.000Z', {
        now: '2026-08-28T07:20:00.000Z',
    });

    assert.equal(blocker?.reason, 'active_run');
    assert.equal(blocker?.runId, 101);
});

test('a recent fallback for the same slot blocks a duplicate dispatch', () => {
    const blocker = getCrawlDispatchBlocker([
        {
            id: 102,
            status: 'completed',
            event: 'workflow_dispatch',
            created_at: '2026-08-28T07:10:00.000Z',
            display_title: 'Daily Flight Crawl · watchdog · 2026-08-28T06:17:00.000Z',
        },
    ], '2026-08-28T06:17:00.000Z', {
        now: '2026-08-28T07:20:00.000Z',
    });

    assert.equal(blocker?.reason, 'recent_fallback');
    assert.equal(blocker?.runId, 102);
});

test('an old fallback or a different slot does not block recovery', () => {
    const runs = [
        {
            id: 103,
            status: 'completed',
            event: 'workflow_dispatch',
            created_at: '2026-08-28T06:20:00.000Z',
            display_title: 'Daily Flight Crawl · watchdog · 2026-08-28T06:17:00.000Z',
        },
        {
            id: 104,
            status: 'completed',
            event: 'workflow_dispatch',
            created_at: '2026-08-28T07:15:00.000Z',
            display_title: 'Daily Flight Crawl · watchdog · 2026-08-28T02:56:00.000Z',
        },
    ];

    assert.equal(getCrawlDispatchBlocker(runs, '2026-08-28T06:17:00.000Z', {
        now: '2026-08-28T07:20:00.000Z',
    }), null);
});
