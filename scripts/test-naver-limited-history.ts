import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNaverCrawlHistoryEntry } from '../src/lib/utils/naver-crawl-history';

test('ledger-only interruption receipts do not invent zero deferred candidates', () => {
    const row: any = { id: 'terminal-fixture', timestamp: '2026-09-26T00:00:00.000Z',
        runner: 'local', sourceFilter: 'myrealtrip', metricsScope: 'ledger-only',
        attempted: 2, success: 1, misses: 1, abortedEarly: true };
    assert.deepEqual(normalizeNaverCrawlHistoryEntry(row), row);
    assert.equal(normalizeNaverCrawlHistoryEntry(row).deferredNeverChecked, undefined);
});

test('normal histories still correct the legacy zero deferred count', () => {
    const row: any = { deferredNeverChecked: 0, newRoutes: 12, newRoutesAttempted: 3 };
    assert.equal(normalizeNaverCrawlHistoryEntry(row).deferredNeverChecked, 9);
});

test('normal histories preserve a higher measured deferred count', () => {
    const row: any = { deferredNeverChecked: 14, newRoutes: 12, newRoutesAttempted: 3 };
    assert.equal(normalizeNaverCrawlHistoryEntry(row).deferredNeverChecked, 14);
});
