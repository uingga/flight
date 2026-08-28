import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
    DAILY_CRAWL_CRONS,
    getCrawlScheduleHealth,
} from '../src/lib/crawl-schedule-health.mjs';

test('warns 45 minutes after an uncovered crawl slot', () => {
    const health = getCrawlScheduleHealth('2026-08-27T15:50:00.000Z', {
        now: '2026-08-28T00:00:00.000Z',
    });

    assert.equal(health.status, 'late');
    assert.equal(health.expectedAt, '2026-08-27T23:13:00.000Z');
    assert.equal(health.delayMinutes, 47);
});

test('dispatch threshold starts at 90 minutes', () => {
    const health = getCrawlScheduleHealth('2026-08-27T15:50:00.000Z', {
        now: '2026-08-28T00:43:00.000Z',
    });

    assert.equal(health.status, 'overdue');
    assert.equal(health.delayMinutes, 90);
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
