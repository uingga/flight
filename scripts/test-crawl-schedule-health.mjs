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
        fullCrawlUpdatedAt: '2026-08-28T07:49:59.902Z',
    }, cachePath => {
        const preflight = spawnSync(process.execPath, ['scripts/check-crawl-run.mjs'], {
            encoding: 'utf8',
            env: {
                ...process.env,
                TRIGGER_EVENT: 'schedule',
                TRIGGER_SCHEDULE: '31 8 * * *',
                CHECK_CACHE: '1',
                CHECK_NOW: '2026-08-28T10:45:00.000Z',
                CRAWL_CACHE_PATH: cachePath,
            },
        });
        assert.equal(preflight.status, 0, preflight.stderr);
        assert.match(preflight.stdout, /\[preflight\] cache_updated_at=2026-08-28T09:54:18\.225Z/);
        assert.match(preflight.stdout, /\[preflight\] last_completed_at=2026-08-28T07:49:59\.902Z/);
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
        assert.equal(health.expectedAt, '2026-08-28T08:31:00.000Z');
        assert.equal(health.shouldDispatch, true);
    });
});

test('warns 45 minutes after an uncovered crawl slot', () => {
    const health = getCrawlScheduleHealth('2026-08-27T15:50:00.000Z', {
        now: '2026-08-28T00:02:00.000Z',
    });

    assert.equal(health.status, 'late');
    assert.equal(health.expectedAt, '2026-08-27T23:17:00.000Z');
    assert.equal(health.delayMinutes, 45);
});

test('dispatch threshold starts at 60 minutes', () => {
    const health = getCrawlScheduleHealth('2026-08-27T15:50:00.000Z', {
        now: '2026-08-28T00:17:00.000Z',
    });

    assert.equal(health.status, 'overdue');
    assert.equal(health.delayMinutes, 60);
});

test('a newly due slot does not hide an older missed slot', () => {
    const health = getCrawlScheduleHealth('2026-08-27T15:50:00.000Z', {
        now: '2026-08-28T02:15:00.000Z',
    });

    assert.equal(health.status, 'overdue');
    assert.equal(health.expectedAt, '2026-08-27T23:17:00.000Z');
    assert.equal(health.pendingSlots, 2);
});

test('a completion covers all earlier slots and leaves only the next slot waiting', () => {
    const health = getCrawlScheduleHealth('2026-08-28T02:10:00.000Z', {
        now: '2026-08-28T02:15:00.000Z',
    });

    assert.equal(health.status, 'waiting');
    assert.equal(health.expectedAt, '2026-08-28T02:12:00.000Z');
    assert.equal(health.delayMinutes, 3);
});

test('health schedule stays in sync with daily-crawl.yml', () => {
    const workflow = fs.readFileSync('.github/workflows/daily-crawl.yml', 'utf8');
    const workflowCrons = [...workflow.matchAll(/^\s*- cron: '([^']+)'/gm)].map(match => match[1]);
    assert.deepEqual([...DAILY_CRAWL_CRONS].sort(), [...workflowCrons].sort());
    assert.equal(workflowCrons.length, 4);
    assert.deepEqual(workflowCrons, [
        '17 23 * * *',
        '12 2 * * *',
        '23 5 * * *',
        '31 8 * * *',
    ]);
});

test('anti-block safeguards keep source starts distributed and MyRealTrip serialized', () => {
    const crawler = fs.readFileSync('scripts/crawl-all.ts', 'utf8');
    const myrealtrip = fs.readFileSync('scripts/scrape-myrealtrip-prices.ts', 'utf8');

    assert.match(crawler, /process\.env\.CI[\s\S]*?90_000/);
    assert.match(crawler, /openSourceCircuit/);
    assert.match(crawler, /Promise\.allSettled\(activeTasks\.map\(async task/);
    assert.match(myrealtrip, /const WORKERS = 1;/);
    assert.match(myrealtrip, /const MAX_ISOLATED_RETRIES = 10;/);
    assert.match(myrealtrip, /assertNoSourceResponseCollapse/);
    assert.match(myrealtrip, /const BATCH_SIZE = 10;/);
    assert.doesNotMatch(myrealtrip, /disable-blink-features=AutomationControlled/);

    const workflow = fs.readFileSync('.github/workflows/myrealtrip-scrape.yml', 'utf8');
    assert.match(workflow, /^concurrency:\s*\n\s+group: myrealtrip-price-scrape/m);
    assert.match(workflow, /if: always\(\) && steps\.scrape\.outcome != 'skipped'/);
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

test('the standalone today-pick workflow is manual-only', () => {
    const workflow = fs.readFileSync('.github/workflows/today-pick.yml', 'utf8');
    assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
    assert.doesNotMatch(workflow, /^\s+schedule:\s*$/m);
    assert.doesNotMatch(workflow, /^\s*- cron:/m);
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

test('MyRealTrip never dispatches a GitHub-hosted Naver production crawl', () => {
    const workflow = fs.readFileSync('.github/workflows/myrealtrip-scrape.yml', 'utf8');
    assert.doesNotMatch(workflow, /^\s+actions:\s*write\b/m);
    assert.doesNotMatch(workflow, /workflow_id: ['"]naver-crawl\.yml['"]/);
    assert.doesNotMatch(workflow, /createWorkflowDispatch/);
});

test('GitHub Naver is a read-only manual diagnostic capped at three routes', () => {
    const workflow = fs.readFileSync('.github/workflows/naver-crawl.yml', 'utf8');
    assert.doesNotMatch(workflow, /^\s+schedule:/m);
    assert.match(workflow, /^\s+SOURCE_FILTER:\s*myrealtrip\s*$/m);
    assert.match(workflow, /^\s+contents:\s*read\s*$/m);
    assert.match(workflow, /^concurrency:\s*\n\s+group:\s*naver-manual-diagnostic/m);
    assert.match(workflow, /Enforce 24-hour diagnostic cooldown/);
    assert.match(workflow, /github\.paginate\(github\.rest\.actions\.listWorkflowRuns/);
    assert.match(workflow, /github\.paginate\(github\.rest\.actions\.listJobsForWorkflowRun/);
    assert.match(workflow, /filter:\s*'all'/);
    assert.match(workflow, /new Date\(step\.started_at\)\.getTime\(\) > cutoff/);
    assert.match(workflow, /^\s+NAVER_LIVE_RUN:\s*'1'\s*$/m);
    assert.match(workflow, /^\s+MAX_NAVIGATIONS:\s*\$\{\{ inputs\.max_flights \}\}\s*$/m);
    assert.match(workflow, /^\s+default:\s*'3'\s*$/m);
    assert.match(workflow, /^\s+-\s*'3'\s*$/m);
    assert.doesNotMatch(workflow, /git push|filter-by-naver|Commit and push|Preserve failed run history/);
});

test('the Windows Naver task splits fresh and recovered sources under one daily budget', () => {
    const runner = fs.readFileSync('scripts/run-naver-crawl.ps1', 'utf8');
    const installer = fs.readFileSync('scripts/install-naver-crawl-task.ps1', 'utf8');
    const crawler = fs.readFileSync('scripts/crawl-naver.ts', 'utf8');

    for (const time of ['11:12', '14:23', '17:31']) {
        assert.match(installer, new RegExp(`New-ScheduledTaskTrigger -Daily -At '${time}'`));
    }
    assert.doesNotMatch(installer, /New-ScheduledTaskTrigger -Daily -At '20:30'/);
    assert.match(installer, /-Argument .* -Scheduled/);
    assert.match(installer, /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
    assert.doesNotMatch(installer, /-WorkingDirectory/);
    assert.match(installer, /\$env:USERPROFILE 'Tikitikit\\naver-crawler'/);
    assert.doesNotMatch(installer, /\$env:LOCALAPPDATA 'Tikitikit\\naver-crawler'/);
    assert.match(installer, /\$RunnerPath = Join-Path \$AutomationDir/);
    assert.match(installer, /-MultipleInstances IgnoreNew/);
    assert.match(installer, /-ExecutionTimeLimit \(New-TimeSpan -Hours 12\)/);
    assert.match(installer, /-WakeToRun/);
    assert.doesNotMatch(installer, /-RestartCount/);
    assert.match(runner, /\$env:SOURCE_FILTER = \$RunSourceCsv/);
    assert.match(runner, /\$env:MAX_FLIGHTS = \[string\]\$RunPolicy\.navigationBudget/);
    assert.match(runner, /\$env:MAX_NAVIGATIONS = \[string\]\$RunPolicy\.navigationBudget/);
    assert.match(runner, /--navigation-increment \$NavigationIncrement/);
    assert.match(runner, /waiting_for_14_23_recovery/);
    assert.match(runner, /\$env:TODAY_PICK_SOURCE_FILTER = \$AllowedTodayPickSources -join ','/);
    assert.match(runner, /\$env:MIN_SUCCESS_REFRESH_HOURS = '24'/);
    assert.match(runner, /\$env:TOP_CANDIDATE_COUNT = '50'/);
    assert.match(runner, /\$env:MAX_DEFER_DAYS = '7'/);
    assert.match(runner, /git pull --rebase --autostash origin main/);
    assert.match(runner, /Local\\TikitikitNaverCrawl/);
    assert.match(runner, /local-naver-run-policy\.mjs check/);
    assert.match(runner, /\$UpstreamPollSeconds = 120/);
    assert.match(runner, /Start-Sleep -Seconds \$SleepSeconds/);
    assert.match(runner, /Get-Random -Minimum 30 -Maximum 181/);
    assert.match(runner, /\$env:MAX_HEALTH_CHECKS = '1'/);
    assert.match(runner, /\$env:REQUEST_DELAY_MIN_MS = '5000'/);
    assert.match(runner, /\$env:BATCH_REST_MAX_MS = '120000'/);
    assert.match(runner, /\$env:MAX_TRANSIENT_RESUMES = '1'/);
    assert.match(runner, /\$env:TRANSIENT_RESUME_MIN_MS = '600000'/);
    assert.match(runner, /\$env:TRANSIENT_RESUME_MAX_MS = '1200000'/);
    assert.match(runner, /\$env:NAVER_RUN_STATUS_FILE = \$RunStatusFile/);
    assert.match(runner, /\$RequestsStarted -eq 0/);
    assert.match(runner, /\$PreRequestRetryCount -lt 1/);
    assert.match(runner, /Get-Random -Minimum 900 -Maximum 1801/);
    assert.match(runner, /\$PartialPricesAllowed = \$CrawlerExitCode -eq 2/);
    assert.match(runner, /publish partial naver prices \[local\]/);
    assert.match(runner, /partially published after transient errors; today pick selection skipped/);
    assert.match(runner, /\$env:NAVER_LIVE_RUN = '1'/);
    assert.match(runner, /npx\.cmd playwright install chromium/);
    assert.match(crawler, /pauseAndResumeAfterTransientFailure/);
    assert.match(crawler, /writeRunStatus\('preparing', 0\)/);
    assert.match(crawler, /writeRunStatus\('naver_request_started', navigationCount, routeLabel\)/);
    assert.match(crawler, /fs\.writeFileSync\(OUTPUT_FILE[\s\S]*?쉬고 다음 항공권부터 이어갑니다/);
    assert.match(crawler, /navigationCount >= MAX_NAVIGATIONS/);
    assert.match(crawler, /process\.exitCode = !explicitBlockDetected && successCount > 0 \? 2 : 3/);
});

test('the Windows blocked-source fallback uses the four general crawl slots', () => {
    const installer = fs.readFileSync('scripts/install-source-fallback-task.ps1', 'utf8');
    const runner = fs.readFileSync('scripts/run-source-fallback-crawl.ps1', 'utf8');

    for (const time of ['08:17', '11:12', '14:23', '17:31']) {
        assert.match(installer, new RegExp(`New-ScheduledTaskTrigger -Daily -At '${time}'`));
    }
    assert.match(installer, /TikitikitBlockedSourceCrawl/);
    assert.match(installer, /Register-ScheduledTask[\s\S]*?-Trigger \$Triggers/);
    assert.doesNotMatch(installer, /-Triggers \$Triggers/);
    assert.match(installer, /-MultipleInstances IgnoreNew/);
    assert.match(runner, /LOCAL_SOURCE_FALLBACK = '1'/);
    assert.match(runner, /local-source-fallback-policy\.mjs check/);
    assert.match(runner, /merge-cache-source\.mjs/);
    assert.match(runner, /--sources=/);
    assert.match(runner, /crawl-all\.ts \$SourceArgument/);
});

test('a successful Windows Naver filter selects today pick with conflict-safe push retries', () => {
    const runner = fs.readFileSync('scripts/run-naver-crawl.ps1', 'utf8');
    const filterIndex = runner.indexOf('npx --no-install tsx scripts/filter-by-naver.ts');
    const waitIndex = runner.indexOf('node scripts/wait-for-flight-api-cache.mjs');
    const selectionIndex = runner.indexOf('node scripts/select-today-pick.mjs 2>&1');

    assert.notEqual(filterIndex, -1);
    assert.ok(waitIndex > filterIndex);
    assert.ok(selectionIndex > waitIndex);
    assert.doesNotMatch(runner, /select-today-pick\.mjs --repair/);
    assert.match(runner, /if \(-not \$DataPublished\)[\s\S]*today pick selection was skipped/);
    assert.match(runner, /for \(\$selectionAttempt = 1; \$selectionAttempt -le 2; \$selectionAttempt\+\+\)/);
    assert.match(runner, /git pull --ff-only origin main/);
    assert.match(runner, /git commit --only -m 'chore\(data\): select today pick after naver crawl \[local\]' -- \$TodayPickPath/);
    assert.match(runner, /git push origin main/);
});

test('watchdog fallback keeps the missed crawl slot identity', () => {
    const result = spawnSync(process.execPath, ['scripts/check-crawl-run.mjs'], {
        encoding: 'utf8',
        env: {
            ...process.env,
            TRIGGER_EVENT: 'workflow_dispatch',
            TRIGGER_SOURCE: 'watchdog',
            EXPECTED_AT: '2026-08-28T02:12:00.000Z',
            CHECK_NOW: '2026-08-28T04:30:00.000Z',
        },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[trigger\] expected_at=2026-08-28T02:12:00\.000Z/);
});

test('general crawl never selects or repairs today pick', () => {
    const workflow = fs.readFileSync('.github/workflows/daily-crawl.yml', 'utf8');
    const selector = fs.readFileSync('scripts/select-today-pick.mjs', 'utf8');
    assert.match(workflow, /^\s+is_morning_pick_slot: \$\{\{ steps\.trigger\.outputs\.is_morning_pick_slot \}\}/m);
    assert.doesNotMatch(workflow, /wait-for-flight-api-cache\.mjs/);
    assert.doesNotMatch(workflow, /select-today-pick\.mjs/);
    assert.doesNotMatch(workflow, /is_today_pick_slot/);
    assert.match(selector, /storedPick\?\.date === kstDate && storedPick\?\.flightId/);
    assert.match(selector, /하루 1회 선정/);
});

test('watchdog fallback preserves the 08:17 morning-pick slot identity', () => {
    const result = spawnSync(process.execPath, ['scripts/check-crawl-run.mjs'], {
        encoding: 'utf8',
        env: {
            ...process.env,
            TRIGGER_EVENT: 'workflow_dispatch',
            TRIGGER_SOURCE: 'watchdog',
            EXPECTED_AT: '2026-08-27T23:17:00.000Z',
            CHECK_NOW: '2026-08-28T01:30:00.000Z',
        },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[preflight\] is_morning_pick_slot=true/);
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
