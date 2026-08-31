import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildLocalNaverState,
    evaluateLocalNaverRun,
} from './local-naver-run-policy.mjs';

const readyCache = {
    fullCrawlUpdatedAt: '2026-08-29T02:42:00.000Z', // 11:42 KST
    sourceUpdatedAt: { myrealtrip: '2026-08-28T09:57:00.000Z' },
};

test('runs as soon as the post-11:12 general crawl is ready', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T02:44:00.000Z', // 11:44 KST
        cache: readyCache,
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'general_crawl_ready');
});

test('waits after 10:00 when the post-11:12 full crawl is still pending', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T01:12:00.000Z',
        cache: {
            ...readyCache,
            fullCrawlUpdatedAt: '2026-08-29T00:11:00.000Z',
        },
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'upstream_pending');
});

test('the 20:30 fallback may use the ready upstream without a second browser session', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T11:30:00.000Z', // 20:30 KST
        cache: {
            ...readyCache,
            fullCrawlUpdatedAt: '2026-08-29T00:11:00.000Z',
            sourceUpdatedAt: { myrealtrip: '2026-08-29T03:57:00.000Z' },
        },
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'fallback_with_partial_upstream');
});

test('the partial-upstream fallback does not start before 20:30', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T11:29:00.000Z', // 20:29 KST
        cache: {
            ...readyCache,
            fullCrawlUpdatedAt: '2026-08-29T00:11:00.000Z',
            sourceUpdatedAt: { myrealtrip: '2026-08-29T03:57:00.000Z' },
        },
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'upstream_pending');
});

test('a completed session suppresses every later trigger on the same KST day', () => {
    const state = buildLocalNaverState('success', {
        now: new Date('2026-08-29T05:30:00.000Z'),
    });
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T11:30:00.000Z',
        cache: readyCache,
        state,
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'already_attempted_today');
});

test('a legacy success deadline does not delay the next day once upstream is ready', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-30T02:44:00.000Z', // 11:44 KST
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T02:42:00.000Z',
            sourceUpdatedAt: { myrealtrip: '2026-08-29T09:57:00.000Z' },
        },
        state: {
            kstDate: '2026-08-29',
            phase: 'success',
            nextEligibleAt: '2026-08-30T05:00:00.000Z', // legacy 14:00 KST
        },
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'general_crawl_ready');
});

test('an explicit block waits only until the next scheduled KST-day run', () => {
    const state = buildLocalNaverState('blocked', {
        now: new Date('2026-08-29T11:30:00.000Z'),
        reason: '403',
    });
    const sameDay = evaluateLocalNaverRun({
        now: '2026-08-29T11:31:00.000Z',
        cache: readyCache,
        state,
    });
    assert.equal(sameDay.shouldRun, false);
    assert.equal(sameDay.reason, 'already_attempted_today');

    const nextScheduledRun = evaluateLocalNaverRun({
        // Only 15h 14m elapsed, but this is the next day's regular run.
        now: '2026-08-30T02:44:00.000Z',
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T02:42:00.000Z',
            sourceUpdatedAt: { myrealtrip: '2026-08-29T09:57:00.000Z' },
        },
        state,
    });
    assert.equal(nextScheduledRun.shouldRun, true);
    assert.equal(nextScheduledRun.reason, 'general_crawl_ready');
});

test('a legacy exact-24h block marker cannot skip the next scheduled run', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-30T02:44:00.000Z',
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T02:42:00.000Z',
            sourceUpdatedAt: { myrealtrip: '2026-08-29T09:57:00.000Z' },
        },
        state: {
            kstDate: '2026-08-29',
            phase: 'blocked',
            nextEligibleAt: '2026-08-30T11:30:00.000Z',
        },
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'general_crawl_ready');
});
