import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildLocalNaverState,
    evaluateLocalNaverRun,
} from './local-naver-run-policy.mjs';

const readyCache = {
    fullCrawlUpdatedAt: '2026-08-29T03:10:00.000Z', // 12:10 KST
    sourceUpdatedAt: { myrealtrip: '2026-08-29T03:57:00.000Z' },
};

test('runs as soon as both same-day upstream crawls are ready', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T04:12:00.000Z', // 13:12 KST
        cache: readyCache,
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'upstreams_ready');
});

test('waits after noon when the post-11:56 full crawl is still pending', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T03:12:00.000Z',
        cache: {
            ...readyCache,
            fullCrawlUpdatedAt: '2026-08-29T02:11:00.000Z',
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
            fullCrawlUpdatedAt: '2026-08-29T02:11:00.000Z',
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
            fullCrawlUpdatedAt: '2026-08-29T02:11:00.000Z',
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
        now: '2026-08-30T04:12:00.000Z', // 13:12 KST
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T03:10:00.000Z',
            sourceUpdatedAt: { myrealtrip: '2026-08-30T03:57:00.000Z' },
        },
        state: {
            kstDate: '2026-08-29',
            phase: 'success',
            nextEligibleAt: '2026-08-30T05:00:00.000Z', // legacy 14:00 KST
        },
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'upstreams_ready');
});

test('an explicit block opens the circuit for 24 hours', () => {
    const state = buildLocalNaverState('blocked', {
        now: new Date('2026-08-29T11:30:00.000Z'),
        reason: '403',
    });
    const duringCooldown = evaluateLocalNaverRun({
        now: '2026-08-30T05:30:00.000Z',
        cache: readyCache,
        state,
    });
    assert.equal(duringCooldown.shouldRun, false);
    assert.equal(duringCooldown.reason, 'cooldown');

    const afterCooldown = evaluateLocalNaverRun({
        now: '2026-08-30T11:31:00.000Z',
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T03:10:00.000Z',
            sourceUpdatedAt: { myrealtrip: '2026-08-30T03:57:00.000Z' },
        },
        state,
    });
    assert.equal(afterCooldown.shouldRun, true);
});
