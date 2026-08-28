import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    DAILY_CRAWL_CRONS,
    getCrawlScheduleHealth,
    getFullCrawlUpdatedAt,
} from '../src/lib/crawl-schedule-health.mjs';
import { getCrawlDispatchBlocker } from '../src/lib/crawl-watchdog-dispatch.mjs';

function withTempCache(cache, callback) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikitikit-crawl-health-'));
    const cachePath = path.join(tempDir, 'all-flights-cache.json');
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    try {
        return callback(cachePath);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

test('an explicit full-crawl marker is not replaced by a newer partial cache timestamp', () => {
    const result = getFullCrawlUpdatedAt({
        timestamp: '2026-08-28T09:54:18.225Z',
        fullCrawlUpdatedAt: '2026-08-28T08:49:59.902Z',
        sourceUpdatedAt: { ttang: '2026-08-28T09:54:18.205Z' },
    });

    assert.equal(result, '2026-08-28T08:49:59.902Z');
});

test('legacy caches use the oldest general-source update instead of a partial cache timestamp', () => {
    const result = getFullCrawlUpdatedAt({
        timestamp: '2026-08-28T09:54:18.225Z',
        sourceUpdatedAt: {
            ybtour: '2026-08-28T08:48:58.176Z',
            hanatour: '2026-08-28T08:48:58.176Z',
            modetour: '2026-08-28T08:48:58.176Z',
            onlinetour: '2026-08-28T08:48:58.176Z',
            ttang: '2026-08-28T09:54:18.205Z',
            myrealtrip: '2026-08-28T01:24:45.202Z',
        },
    });

    assert.equal(result, '2026-08-28T08:48:58.176Z');
});

test('preflight and watchdog recover a slot hidden by a partial source refresh', () => {
    withTempCache({
        timestamp: '2026-08-28T09:54:18.225Z',
        fullCrawlUpdatedAt: '2026-08-28T08:49:59.902Z',
    }, cachePath => {
        const preflight = spawnSync(process.execPath, ['scripts/check-crawl-run.mjs'], {
            encoding: 'utf8',
            env: {
                ...process.env,
                TRIGGER_EVENT: 'schedule',
                TRIGGER_SCHEDULE: '29 9 * * *',
                CHECK_CACHE: '1',
                CHECK_NOW: '2026-08-28T10:45:00.000Z',
                CRAWL_CACHE_PATH: cachePath,
            },
        });
        assert.equal(preflight.status, 0, preflight.stderr);
        assert.match(preflight.stdout, /\[preflight\] cache_updated_at=2026-08-28T09:54:18\.225Z/);
        assert.match(preflight.stdout, /\[preflight\] last_completed_at=2026-08-28T08:49:59\.902Z/);
        assert.match(preflight.stdout, /\[preflight\] should_run=true/);

        const watchdog = spawnSync(process.execPath, ['scripts/check-crawl-watchdog.mjs'], {
            encoding: 'utf8',
            env: {
                ...process.env,
                WATCHDOG_NOW: '2026-08-28T10:45:00.000Z',
                CRAWL_CACHE_PATH: cachePath,
            },
        });
        assert.equal(watchdog.status, 0, watchdog.stderr);
        const health = JSON.parse(watchdog.stdout);
        assert.equal(health.status, 'overdue');
        assert.equal(health.expectedAt, '2026-08-28T09:29:00.000Z');
        assert.equal(health.shouldDispatch, true);
    });
});

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

test('full crawls advance the marker while partial crawls preserve it', () => {
    const crawler = fs.readFileSync('scripts/crawl-all.ts', 'utf8');
    assert.match(
        crawler,
        /fullCrawlUpdatedAt:\s*requestedSources\s*\?\s*prevCache\?\.fullCrawlUpdatedAt\s*:\s*cacheUpdatedAt/,
    );
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

test('the general crawl never dispatches the GitHub Naver workflow', () => {
    const dailyWorkflow = fs.readFileSync('.github/workflows/daily-crawl.yml', 'utf8');
    const naverWorkflow = fs.readFileSync('.github/workflows/naver-crawl.yml', 'utf8');

    assert.doesNotMatch(dailyWorkflow, /workflow_id: 'naver-crawl\.yml'/);
    assert.doesNotMatch(dailyWorkflow, /^\s+actions:\s*write\b/m);
    assert.doesNotMatch(naverWorkflow, /^\s+workflow_run:/m);
});

test('only the successful 07:05 MyRealTrip schedule dispatches Naver for 200 flights', () => {
    const workflow = fs.readFileSync('.github/workflows/myrealtrip-scrape.yml', 'utf8');
    const dispatchStart = workflow.indexOf('- name: Start Naver price crawl after 07:05 MyRealTrip scrape');
    const nextStep = workflow.indexOf('\n      - name:', dispatchStart + 1);

    assert.notEqual(dispatchStart, -1);
    const dispatchStep = workflow.slice(dispatchStart, nextStep === -1 ? workflow.length : nextStep);
    assert.match(workflow, /^\s+actions:\s*write\b/m);
    assert.match(dispatchStep, /if: success\(\)/);
    assert.match(dispatchStep, /steps\.scrape\.outcome == 'success'/);
    assert.match(dispatchStep, /github\.event_name == 'schedule'/);
    assert.match(dispatchStep, /github\.event\.schedule == '5 22 \* \* \*'/);
    assert.match(dispatchStep, /workflow_id: 'naver-crawl\.yml'/);
    assert.match(dispatchStep, /inputs: \{ max_flights: '200' \}/);
    assert.doesNotMatch(dispatchStep, /3 9 \* \* \*/);
});

test('GitHub Naver stays limited to MyRealTrip routes', () => {
    const workflow = fs.readFileSync('.github/workflows/naver-crawl.yml', 'utf8');
    assert.match(workflow, /^\s+SOURCE_FILTER:\s*myrealtrip\s*$/m);
});

test('the Windows Naver task keeps the 14:30 all-source 280-flight follow-up', () => {
    const runner = fs.readFileSync('scripts/run-naver-crawl.ps1', 'utf8');
    const installer = fs.readFileSync('scripts/install-naver-crawl-task.ps1', 'utf8');

    assert.match(installer, /New-ScheduledTaskTrigger -Daily -At '14:30'/);
    assert.match(runner, /\$env:SOURCE_FILTER = 'all'/);
    assert.match(runner, /\$env:MAX_FLIGHTS = '280'/);
    assert.match(runner, /git pull --rebase --autostash/);
});

test('a successful Windows Naver filter repairs today pick with conflict-safe push retries', () => {
    const runner = fs.readFileSync('scripts/run-naver-crawl.ps1', 'utf8');
    const filterIndex = runner.indexOf('npx --no-install tsx scripts/filter-by-naver.ts');
    const waitIndex = runner.indexOf('node scripts/wait-for-flight-api-cache.mjs');
    const repairIndex = runner.indexOf('node scripts/select-today-pick.mjs --repair');

    assert.notEqual(filterIndex, -1);
    assert.ok(waitIndex > filterIndex);
    assert.ok(repairIndex > waitIndex);
    assert.match(runner, /if \(-not \$DataPublished\)[\s\S]*today pick repair was skipped/);
    assert.match(runner, /for \(\$repairAttempt = 1; \$repairAttempt -le 2; \$repairAttempt\+\+\)/);
    assert.match(runner, /git pull --ff-only origin main/);
    assert.match(runner, /git commit --only -m 'chore\(data\): repair today pick after naver crawl \[local\]' -- \$TodayPickPath/);
    assert.match(runner, /git push origin main/);
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
