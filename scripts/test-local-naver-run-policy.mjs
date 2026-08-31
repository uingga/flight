import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildLocalNaverState,
    evaluateLocalNaverRun,
} from './local-naver-run-policy.mjs';

const generalSources = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang'];
const sourceUpdatedAt = Object.fromEntries(generalSources.map(source => [source, '2026-08-29T02:40:00.000Z']));
const readyCache = {
    fullCrawlUpdatedAt: '2026-08-29T02:42:00.000Z', // 11:42 KST
    sourceUpdatedAt: {
        ...sourceUpdatedAt,
        myrealtrip: '2026-08-29T01:57:00.000Z',
    },
    flights: generalSources.flatMap(source => Array.from({ length: 20 }, (_, index) => ({ source, id: `${source}-${index}` }))),
};

test('runs every fresh source as soon as the post-11:12 crawl is ready', () => {
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T02:44:00.000Z',
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
            modetour: '2026-08-28T02:40:00.000Z',
        },
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T02:44:00.000Z',
        cache,
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'partial_general_crawl_ready');
    assert.equal(result.sources.includes('modetour'), false);
    assert.deepEqual(result.pendingSources, ['modetour']);
    assert.equal(result.deferTodayPick, true);
    assert.equal(result.navigationBudget, 160);
});

test('waits for the 14:23 crawl after a partial first phase', () => {
    const state = buildLocalNaverState('partial_waiting', {
        now: new Date('2026-08-29T03:30:00.000Z'),
        completedSources: ['ybtour', 'hanatour', 'onlinetour', 'ttang', 'myrealtrip'],
        pendingSources: ['modetour'],
        navigationIncrement: 143,
    });
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T04:30:00.000Z', // 13:30 KST
        cache: readyCache,
        state,
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.shouldFinalize, false);
    assert.equal(result.reason, 'recovery_upstream_pending');
});

test('runs only a recovered source with the remaining daily budget', () => {
    const state = buildLocalNaverState('partial_waiting', {
        now: new Date('2026-08-29T03:30:00.000Z'),
        completedSources: ['ybtour', 'hanatour', 'onlinetour', 'ttang', 'myrealtrip'],
        pendingSources: ['modetour'],
        navigationIncrement: 143,
    });
    const cache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-29T05:45:00.000Z',
        sourceUpdatedAt: {
            ...readyCache.sourceUpdatedAt,
            modetour: '2026-08-29T05:44:00.000Z',
        },
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T05:46:00.000Z',
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
        now: new Date('2026-08-29T03:30:00.000Z'),
        completedSources: ['ybtour', 'hanatour', 'onlinetour', 'ttang', 'myrealtrip'],
        pendingSources: ['modetour'],
        navigationIncrement: 143,
    });
    const cache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-29T05:45:00.000Z',
        sourceUpdatedAt: {
            ...readyCache.sourceUpdatedAt,
            modetour: '2026-08-29T03:50:00.000Z', // 12:50 KST PC fallback
        },
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T05:46:00.000Z',
        cache,
        state,
    });
    assert.equal(result.shouldRun, true);
    assert.deepEqual(result.sources, ['modetour']);
});

test('finalizes without opening a browser when the failed source did not recover', () => {
    const state = buildLocalNaverState('partial_waiting', {
        now: new Date('2026-08-29T03:30:00.000Z'),
        completedSources: ['ybtour', 'hanatour', 'onlinetour', 'ttang', 'myrealtrip'],
        pendingSources: ['modetour'],
        navigationIncrement: 143,
    });
    const cache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-29T05:45:00.000Z',
        sourceUpdatedAt: {
            ...readyCache.sourceUpdatedAt,
            modetour: '2026-08-28T02:40:00.000Z',
        },
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T05:46:00.000Z',
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
        now: '2026-08-29T11:30:00.000Z', // 20:30 KST
        cache: {
            ...readyCache,
            fullCrawlUpdatedAt: '2026-08-29T00:11:00.000Z',
            sourceUpdatedAt: { myrealtrip: '2026-08-29T03:57:00.000Z' },
        },
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'upstream_pending');
});

test('a completed session suppresses later triggers on the same KST day', () => {
    const state = buildLocalNaverState('success', {
        now: new Date('2026-08-29T05:30:00.000Z'),
        completedSources: generalSources,
        navigationIncrement: 200,
    });
    const result = evaluateLocalNaverRun({
        now: '2026-08-29T08:40:00.000Z',
        cache: readyCache,
        state,
    });
    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'already_attempted_today');
});

test('a legacy success deadline does not delay the next day once upstream is ready', () => {
    const nextCache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-30T02:42:00.000Z',
        sourceUpdatedAt: Object.fromEntries(
            Object.keys(readyCache.sourceUpdatedAt).map(source => [source, '2026-08-30T02:40:00.000Z']),
        ),
    };
    const result = evaluateLocalNaverRun({
        now: '2026-08-30T02:44:00.000Z',
        cache: nextCache,
        state: {
            kstDate: '2026-08-29',
            phase: 'success',
            nextEligibleAt: '2026-08-30T05:00:00.000Z',
        },
    });
    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'general_crawl_ready');
});

test('an explicit block prevents the recovery phase but allows the next KST day', () => {
    const state = buildLocalNaverState('blocked', {
        now: new Date('2026-08-29T03:30:00.000Z'),
        reason: '403',
    });
    const sameDay = evaluateLocalNaverRun({
        now: '2026-08-29T05:46:00.000Z',
        cache: readyCache,
        state,
    });
    assert.equal(sameDay.shouldRun, false);
    assert.equal(sameDay.reason, 'already_attempted_today');

    const nextCache = {
        ...readyCache,
        fullCrawlUpdatedAt: '2026-08-30T02:42:00.000Z',
        sourceUpdatedAt: Object.fromEntries(
            Object.keys(readyCache.sourceUpdatedAt).map(source => [source, '2026-08-30T02:40:00.000Z']),
        ),
    };
    const nextDay = evaluateLocalNaverRun({
        now: '2026-08-30T02:44:00.000Z',
        cache: nextCache,
        state,
    });
    assert.equal(nextDay.shouldRun, true);
});
