import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildLocalNaverState,
    completePendingManualCapture,
    evaluateLocalNaverRun,
    planInterruptedNaverRecovery,
    readOption,
} from './local-naver-run-policy.mjs';

const generalSources = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang'];
const sourceUpdatedAt = Object.fromEntries(generalSources.map(source => [source, '2026-08-29T01:40:00.000Z']));
const readyCache = {
    fullCrawlUpdatedAt: '2026-08-29T01:42:00.000Z', // 11:42 KST
    sourceUpdatedAt: {
        ...sourceUpdatedAt,
        myrealtrip: '2026-08-29T00:57:00.000Z',
    },
    flights: generalSources.flatMap(source => Array.from({ length: 20 }, (_, index) => ({ source, id: `${source}-${index}` }))),
};

test('waits for PC completion before freezing recovery sources, then includes ttang', () => {
    const now = new Date('2026-08-29T04:43:00Z');
    const state = { kstDate: '2026-08-29', phase: 'partial_waiting', navigationsUsed: 120,
        completedSources: ['ybtour', 'hanatour', 'myrealtrip'], pendingSources: ['modetour', 'ttang'] };
    const cache = { ...readyCache, fullCrawlUpdatedAt: '2026-08-29T04:41:00Z',
        sourceUpdatedAt: { ...readyCache.sourceUpdatedAt, ttang: '2026-08-28T23:00:00Z' } };
    const waiting = evaluateLocalNaverRun({ now, cache, state, pcCollectionPending: true });
    assert.equal(waiting.reason, 'recovery_pc_pending');
    assert.equal(waiting.shouldRun, false);
    assert.equal(waiting.shouldFinalize, false);
    cache.sourceUpdatedAt.ttang = '2026-08-29T04:51:00Z';
    const ready = evaluateLocalNaverRun({ now: new Date('2026-08-29T04:52:00Z'), cache, state });
    assert.deepEqual(ready.sources, ['modetour', 'ttang']);
    assert.equal(ready.navigationBudget, 80);
});

test('approved late recovery retains 159 used, selects only pending ttang and leaves today pick', () => {
    const state = { kstDate: '2026-08-29', phase: 'success', navigationsUsed: 159,
        completedSources: ['ybtour', 'hanatour', 'myrealtrip', 'modetour'], pendingSources: ['ttang', 'onlinetour'] };
    const cache = { ...readyCache, sourceUpdatedAt: { ...readyCache.sourceUpdatedAt, ttang: '2026-08-29T04:51:00Z' } };
    const input = { now: new Date('2026-08-29T05:20:00Z'), cache, state, approvedRecoverySources: ['ttang'] };
    const result = evaluateLocalNaverRun(input);
    assert.equal(result.shouldRun, true);
    assert.deepEqual(result.sources, ['ttang']);
    assert.equal(result.navigationBudget, 41);
    assert.equal(result.skipTodayPick, true);
    assert.equal(evaluateLocalNaverRun({ ...input, approvedRecoverySources: ['modetour'] }).shouldRun, false);
    assert.equal(evaluateLocalNaverRun({ ...input, pcCollectionPending: true }).shouldRun, false);
    for (const phase of ['blocked', 'degraded', 'running']) {
        assert.equal(evaluateLocalNaverRun({ ...input, state: { ...state, phase } }).shouldRun, false);
    }
    assert.equal(evaluateLocalNaverRun({ ...input, state: { ...state, navigationsUsed: 200 } }).shouldRun, false);
    assert.equal(evaluateLocalNaverRun({ ...input, state: { ...state, navigationsUsed: undefined } }).shouldRun, false);
    assert.equal(evaluateLocalNaverRun({ ...input, state: { ...state, kstDate: '2026-08-28' } }).shouldRun, false);
});

test('does not consume the next option when a PowerShell argument is empty', () => {
    const args = ['--completed-sources', '--pending-sources', 'ttang'];
    assert.equal(readOption(args, '--completed-sources'), undefined);
    assert.equal(readOption(args, '--pending-sources'), 'ttang');
});

test('persists running sources so an interrupted phase can restore its queue', () => {
    const state = buildLocalNaverState('running', {
        now: new Date('2026-08-29T02:30:00.000Z'),
        completedSources: ['ybtour'],
        pendingSources: ['ttang'],
        runningSources: ['hanatour', 'modetour', 'myrealtrip'],
        navigationIncrement: 20,
        reason: 'browser_session_started_recovery',
    });
    assert.deepEqual(state.runningSources, ['hanatour', 'modetour', 'myrealtrip']);

    const plan = planInterruptedNaverRecovery({ state, requestsStarted: 0 });
    assert.equal(plan.outcome, 'partial_waiting');
    assert.equal(plan.reason, 'interrupted_recovery_before_requests');
    assert.deepEqual(plan.completedSources, ['ybtour']);
    assert.deepEqual(plan.pendingSources, ['ttang', 'hanatour', 'modetour', 'myrealtrip']);
    assert.equal(plan.navigationIncrement, 20);
});

test('returns interrupted initial sources to the next phase and keeps the used budget', () => {
    const state = buildLocalNaverState('running', {
        now: new Date('2026-08-29T02:30:00.000Z'),
        pendingSources: ['ttang'],
        runningSources: ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'myrealtrip'],
        reason: 'browser_session_started_initial',
    });
    const plan = planInterruptedNaverRecovery({ state, requestsStarted: 20 });
    assert.equal(plan.outcome, 'partial_waiting');
    assert.equal(plan.reason, 'interrupted_initial_after_20_requests');
    assert.deepEqual(plan.pendingSources, [
        'ttang',
        'ybtour',
        'hanatour',
        'modetour',
        'onlinetour',
        'myrealtrip',
    ]);
    assert.equal(plan.navigationIncrement, 20);
});

test('keeps a recovery interruption terminal after Naver requests already started', () => {
    const state = buildLocalNaverState('running', {
        now: new Date('2026-08-29T05:00:00.000Z'),
        pendingSources: ['ttang'],
        runningSources: ['modetour'],
        navigationIncrement: 120,
        reason: 'browser_session_started_recovery',
    });
    const plan = planInterruptedNaverRecovery({ state, requestsStarted: 3 });
    assert.equal(plan.outcome, 'degraded');
    assert.equal(plan.reason, 'interrupted_recovery_after_3_requests');
    assert.deepEqual(plan.pendingSources, ['ttang']);
    assert.equal(plan.navigationIncrement, 123);
});

test('does not retry when an interrupted request count is unavailable', () => {
    const state = buildLocalNaverState('running', {
        now: new Date('2026-08-29T05:00:00.000Z'),
        pendingSources: ['ttang'],
        runningSources: ['modetour'],
        navigationIncrement: 120,
        reason: 'browser_session_started_recovery',
    });
    const plan = planInterruptedNaverRecovery({ state });
    assert.equal(plan.outcome, 'degraded');
    assert.equal(plan.reason, 'interrupted_recovery_requests_unknown');
    assert.deepEqual(plan.pendingSources, ['ttang']);
    assert.equal(plan.navigationIncrement, 200);
});

test('repairs a legacy interrupted initial state that did not save running sources', () => {
    const cache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-29T04:45:00.000Z',
        sourceUpdatedAt: {
            ...readyCache.sourceUpdatedAt,
            ttang: '2026-08-28T01:40:00.000Z',
        },
    };
    const state = {
        version: 2,
        kstDate: '2026-08-29',
        phase: 'partial_waiting',
        updatedAt: '2026-08-29T03:00:00.000Z',
        navigationsUsed: 20,
        completedSources: [],
        pendingSources: ['ttang'],
        reason: 'interrupted_initial_after_20_requests',
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T04:46:00.000Z',
        cache,
        state,
    });
    assert.equal(result.shouldRun, true);
    assert.deepEqual(result.sources, ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'myrealtrip']);
    assert.equal(result.navigationBudget, 180);
});

test('runs every fresh source as soon as the post-10:12 crawl is ready', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T01:44:00.000Z',
        cache: readyCache,
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'general_crawl_ready');
    assert.deepEqual(result.sources, [...generalSources, 'myrealtrip']);
    assert.equal(result.navigationBudget, 200);
    assert.equal(result.deferTodayPick, false);
});

test('starts fresh sources and reserves budget when one source was preserved', () => {
    const cache = {
        ...readyCache,
        sourceUpdatedAt: {
            ...readyCache.sourceUpdatedAt,
            modetour: '2026-08-28T01:40:00.000Z',
        },
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T01:44:00.000Z',
        cache,
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'partial_general_crawl_ready');
    assert.equal(result.sources.includes('modetour'), false);
    assert.deepEqual(result.pendingSources, ['modetour']);
    assert.equal(result.deferTodayPick, true);
    assert.equal(result.navigationBudget, 160);
});

test('waits for the 13:23 crawl after a partial first phase', () => {
    const state = buildLocalNaverState('partial_waiting', {
        now: new Date('2026-08-29T02:30:00.000Z'),
        completedSources: ['ybtour', 'hanatour', 'onlinetour', 'ttang', 'myrealtrip'],
        pendingSources: ['modetour'],
        navigationIncrement: 143,
    });
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T03:30:00.000Z', // 13:30 KST
        cache: readyCache,
        state,
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.shouldFinalize, false);
    assert.equal(result.reason, 'recovery_upstream_pending');
});

test('runs only a recovered source with the remaining daily budget', () => {
    const state = buildLocalNaverState('partial_waiting', {
        now: new Date('2026-08-29T02:30:00.000Z'),
        completedSources: ['ybtour', 'hanatour', 'onlinetour', 'ttang', 'myrealtrip'],
        pendingSources: ['modetour'],
        navigationIncrement: 143,
    });
    const cache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-29T04:45:00.000Z',
        sourceUpdatedAt: {
            ...readyCache.sourceUpdatedAt,
            modetour: '2026-08-29T04:44:00.000Z',
        },
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T04:46:00.000Z',
        cache,
        state,
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'recovery_sources_ready');
    assert.deepEqual(result.sources, ['modetour']);
    assert.equal(result.navigationBudget, 57);
    assert.equal(result.shouldFinalizeAfterRun, true);
});

test('accepts a PC fallback recovered between the initial and recovery slots', () => {
    const state = buildLocalNaverState('partial_waiting', {
        now: new Date('2026-08-29T02:30:00.000Z'),
        completedSources: ['ybtour', 'hanatour', 'onlinetour', 'ttang', 'myrealtrip'],
        pendingSources: ['modetour'],
        navigationIncrement: 143,
    });
    const cache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-29T04:45:00.000Z',
        sourceUpdatedAt: {
            ...readyCache.sourceUpdatedAt,
            modetour: '2026-08-29T02:50:00.000Z', // 12:50 KST PC fallback
        },
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T04:46:00.000Z',
        cache,
        state,
    });
    assert.equal(result.shouldRun, true);
    assert.deepEqual(result.sources, ['modetour']);
});

test('finalizes without opening a browser when the failed source did not recover', () => {
    const state = buildLocalNaverState('partial_waiting', {
        now: new Date('2026-08-29T02:30:00.000Z'),
        completedSources: ['ybtour', 'hanatour', 'onlinetour', 'ttang', 'myrealtrip'],
        pendingSources: ['modetour'],
        navigationIncrement: 143,
    });
    const cache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-29T04:45:00.000Z',
        sourceUpdatedAt: {
            ...readyCache.sourceUpdatedAt,
            modetour: '2026-08-28T01:40:00.000Z',
        },
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T04:46:00.000Z',
        cache,
        state,
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.shouldFinalize, true);
    assert.equal(result.reason, 'recovery_sources_unavailable');
    assert.equal(result.allowedTodayPickSources.includes('modetour'), false);
});

test('does not use a late MyRealTrip-only fallback when the general crawl is missing', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T10:30:00.000Z', // 20:30 KST
        cache: {
            ...readyCache,
            fullCrawlUpdatedAt: '2026-08-28T23:11:00.000Z',
            sourceUpdatedAt: { myrealtrip: '2026-08-29T02:57:00.000Z' },
        },
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'upstream_pending');
});

test('a completed session suppresses later triggers on the same KST day', () => {
    const state = buildLocalNaverState('success', {
        now: new Date('2026-08-29T04:30:00.000Z'),
        completedSources: generalSources,
        navigationIncrement: 200,
    });
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T07:40:00.000Z',
        cache: readyCache,
        state,
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'already_attempted_today');
});

test('a legacy success deadline does not delay the next day once upstream is ready', () => {
    const nextCache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-30T01:42:00.000Z',
        sourceUpdatedAt: Object.fromEntries(
            Object.keys(readyCache.sourceUpdatedAt).map(source => [source, '2026-08-30T01:40:00.000Z']),
        ),
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-30T01:44:00.000Z',
        cache: nextCache,
        state: {
            kstDate: '2026-08-29',
            phase: 'success',
            nextEligibleAt: '2026-08-30T04:00:00.000Z',
        },
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'general_crawl_ready');
});

test('an explicit block prevents the recovery phase but allows the next KST day', () => {
    const state = buildLocalNaverState('blocked', {
        now: new Date('2026-08-29T02:30:00.000Z'),
        reason: '403',
    });
    const sameDay = evaluateLocalNaverRun({
        now: '2026-08-29T04:46:00.000Z',
        cache: readyCache,
        state,
    });
    assert.equal(sameDay.shouldRun, false);
    assert.equal(sameDay.reason, 'already_attempted_today');

    const nextCache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-30T01:42:00.000Z',
        sourceUpdatedAt: Object.fromEntries(
            Object.keys(readyCache.sourceUpdatedAt).map(source => [source, '2026-08-30T01:40:00.000Z']),
        ),
    };
    const nextDay = evaluateLocalNaverRun({
        now: '2026-08-30T01:44:00.000Z',
        cache: nextCache,
        state,
    });
    assert.equal(nextDay.shouldRun, true);
});

test('includes a pending manual Modetour capture in the initial phase', () => {
    const cache = {
        ...readyCache,
        sourceUpdatedAt: {
            ...readyCache.sourceUpdatedAt,
            modetour: '2026-08-28T01:40:00.000Z',
        },
        manualCaptureStatus: {
            modetour: {
                naverPending: true,
                naverPendingAt: '2026-08-29T00:30:00.000Z', // 10:30 KST
            },
        },
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T01:44:00.000Z',
        cache,
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.sources.includes('modetour'), true);
});

test('runs a capture imported after the first phase in the 13:23 phase', () => {
    const state = buildLocalNaverState('success', {
        now: new Date('2026-08-29T02:00:00.000Z'), // 12:00 KST
        completedSources: ['ybtour', 'hanatour', 'onlinetour', 'ttang'],
        navigationIncrement: 120,
    });
    const cache = {
        ...readyCache,
        manualCaptureStatus: {
            modetour: {
                naverPending: true,
                naverPendingAt: '2026-08-29T02:30:00.000Z', // 12:30 KST
            },
        },
    };
    const beforeSlot = evaluateLocalNaverRun({ now: '2026-08-29T04:22:00.000Z', cache, state });
    assert.equal(beforeSlot.shouldRun, false);
    assert.equal(beforeSlot.reason, 'manual_capture_waiting_for_next_slot');

    const atSlot = evaluateLocalNaverRun({ now: '2026-08-29T04:24:00.000Z', cache, state });
    assert.equal(atSlot.shouldRun, true);
    assert.equal(atSlot.runPhase, 'manual_recovery');
    assert.deepEqual(atSlot.sources, ['modetour']);
    assert.equal(atSlot.navigationBudget, 80);
});

test('runs a capture imported after 13:23 in the 16:31 third phase', () => {
    const state = buildLocalNaverState('success', {
        now: new Date('2026-08-29T05:00:00.000Z'), // 15:00 KST
        completedSources: generalSources,
        navigationIncrement: 150,
    });
    const cache = {
        ...readyCache,
        manualCaptureStatus: {
            modetour: {
                naverPending: true,
                naverPendingAt: '2026-08-29T05:05:00.000Z', // 15:05 KST
            },
        },
    };
    const result = evaluateLocalNaverRun({ now: '2026-08-29T07:32:00.000Z', cache, state });
    assert.equal(result.shouldRun, true);
    assert.equal(result.runPhase, 'manual_recovery');
    assert.deepEqual(result.sources, ['modetour']);
    assert.equal(result.navigationBudget, 50);
});

test('does not grant a new daily budget when a legacy completed state has no usage count', () => {
    const cache = {
        ...readyCache,
        manualCaptureStatus: {
            modetour: {
                naverPending: true,
                naverPendingAt: '2026-08-29T05:05:00.000Z',
            },
        },
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T07:32:00.000Z',
        cache,
        state: {
            version: 1,
            kstDate: '2026-08-29',
            phase: 'success',
            updatedAt: '2026-08-29T06:00:00.000Z',
        },
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'daily_budget_exhausted');
    assert.equal(result.navigationBudget, 0);
});

test('keeps a manual capture pending when the Naver phase still has deferred routes', () => {
    const cache = {
        manualCaptureStatus: {
            modetour: {
                naverPending: true,
                naverPendingAt: '2026-08-29T05:05:00.000Z',
            },
        },
    };
    const result = completePendingManualCapture({
        cache,
        sources: ['modetour'],
        history: {
            entries: [{
                runner: 'local',
                sourceFilter: 'modetour',
                timestamp: '2026-08-29T07:40:00.000Z',
                deferred: 17,
                blocked: 0,
                abortedEarly: false,
            }],
        },
    });
    assert.equal(result.changed, true);
    assert.equal(result.cache.manualCaptureStatus.modetour.naverPending, true);
    assert.equal(result.cache.manualCaptureStatus.modetour.naverDeferred, 17);
    assert.equal(result.cache.manualCaptureStatus.modetour.naverLastAttemptAt, '2026-08-29T07:40:00.000Z');
});

test('clears a manual capture only after every eligible route is processed', () => {
    const cache = {
        manualCaptureStatus: {
            modetour: {
                naverPending: true,
                naverPendingAt: '2026-08-29T05:05:00.000Z',
            },
        },
    };
    const result = completePendingManualCapture({
        cache,
        sources: ['modetour'],
        history: {
            entries: [{
                runner: 'local',
                sourceFilter: 'ybtour,modetour',
                timestamp: '2026-08-29T07:40:00.000Z',
                deferred: 0,
                blocked: 0,
                abortedEarly: false,
            }],
        },
    });
    assert.equal(result.changed, true);
    assert.equal(result.cache.manualCaptureStatus.modetour.naverPending, false);
    assert.equal(result.cache.manualCaptureStatus.modetour.naverProcessedAt, '2026-08-29T07:40:00.000Z');
});
