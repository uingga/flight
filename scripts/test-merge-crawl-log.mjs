import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mergeCrawlLogHistories } from './merge-crawl-log.mjs';

const NOW = new Date('2026-08-31T12:00:00Z').getTime();

const entry = (timestamp, sites, alerts = []) => ({ timestamp, sites, alerts });

test('MyRealTrip session is added without removing a newer regular crawl', () => {
    const remote = {
        entries: [
            entry('2026-08-31T08:00:00Z', { ybtour: { total: 80, scraped: 240 } }),
            entry('2026-08-31T10:00:00Z', { ttang: { total: 100, scraped: 900 } }),
        ],
    };
    const session = {
        entries: [
            entry('2026-08-31T08:00:00Z', { myrealtrip: { total: 170 } }),
            entry('2026-08-31T09:00:00Z', { myrealtrip: { total: 186, scraped: 214, added: 20, removed: 8 } }),
        ],
    };

    const { history, mergedSessions } = mergeCrawlLogHistories(remote, session, ['myrealtrip'], NOW);
    assert.equal(mergedSessions, 1, '캐시 승계 값은 빼고 실제 마이리얼트립 실행만 합쳐야 한다.');
    assert.deepEqual(history.entries.map(row => row.timestamp), [
        '2026-08-31T08:00:00Z',
        '2026-08-31T09:00:00Z',
        '2026-08-31T10:00:00Z',
    ]);
    assert.equal(history.entries[1].sites.myrealtrip.scraped, 214);
    assert.equal(history.entries[2].sites.ttang.scraped, 900, '원격에 먼저 들어온 일반 회차를 보존해야 한다.');
});

test('regular crawl merge keeps a concurrent MyRealTrip entry and ignores carried cache values', () => {
    const remote = {
        entries: [entry('2026-08-31T09:00:00Z', { myrealtrip: { total: 186, scraped: 214 } })],
    };
    const session = {
        entries: [entry('2026-08-31T10:00:00Z', {
            ybtour: { total: 80, scraped: 240 },
            hanatour: { total: 20, preserved: true },
            myrealtrip: { total: 177 },
        })],
    };

    const { history } = mergeCrawlLogHistories(
        remote,
        session,
        ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang'],
        NOW,
    );
    assert.equal(history.entries.length, 2);
    assert.equal(history.entries[0].sites.myrealtrip.scraped, 214);
    assert.equal(history.entries[1].sites.ybtour.scraped, 240);
    assert.equal(history.entries[1].sites.hanatour.preserved, true);
    assert.equal(history.entries[1].sites.myrealtrip, undefined, '실행하지 않은 마이리얼트립 승계값을 새 회차에 넣으면 안 된다.');
});

test('same timestamp merges source fields and alerts idempotently', () => {
    const timestamp = '2026-08-31T09:00:00Z';
    const remote = {
        entries: [entry(timestamp, { ybtour: { total: 80, scraped: 240 } }, ['일반 경고'])],
    };
    const session = {
        entries: [entry(timestamp, { myrealtrip: { total: 186, preserved: true } }, ['MRT 경고'])],
    };

    const first = mergeCrawlLogHistories(remote, session, ['myrealtrip'], NOW).history;
    const second = mergeCrawlLogHistories(first, session, ['myrealtrip'], NOW).history;
    assert.equal(second.entries.length, 1);
    assert.equal(second.entries[0].sites.ybtour.scraped, 240);
    assert.equal(second.entries[0].sites.myrealtrip.preserved, true);
    assert.deepEqual(second.entries[0].alerts, ['일반 경고', 'MRT 경고']);
});

test('scheduled source skips are merged as explicit non-failure events', () => {
    const timestamp = '2026-08-31T02:20:00Z';
    const session = {
        entries: [entry(timestamp, {
            ttang: {
                total: 91,
                skipped: true,
                skipReason: 'schedule',
                skippedUntil: '2026-08-31T05:23:00.000Z',
            },
        })],
    };
    const { history, mergedSessions } = mergeCrawlLogHistories(
        { entries: [] },
        session,
        ['ttang'],
        NOW,
    );
    assert.equal(mergedSessions, 1);
    assert.equal(history.entries[0].sites.ttang.skipped, true);
    assert.equal(history.entries[0].sites.ttang.skipReason, 'schedule');
    assert.equal(history.entries[0].sites.ttang.preserved, undefined);
});

test('PC fallback session keeps its runner marker and source result', () => {
    const timestamp = '2026-08-31T09:05:00Z';
    const session = {
        entries: [{
            ...entry(timestamp, {
                ttang: { total: 91, scraped: 730, localFallback: true, added: 4, removed: 2 },
            }),
            runKind: 'pc_fallback',
        }],
    };

    const { history, mergedSessions } = mergeCrawlLogHistories(
        { entries: [] },
        session,
        ['ttang'],
        NOW,
    );
    assert.equal(mergedSessions, 1);
    assert.equal(history.entries[0].runKind, 'pc_fallback');
    assert.equal(history.entries[0].sites.ttang.localFallback, true);
    assert.equal(history.entries[0].sites.ttang.scraped, 730);
});

test('entries older than 31 days are not revived from a session snapshot', () => {
    const old = entry('2026-07-01T00:00:00Z', { myrealtrip: { total: 100, scraped: 100 } });
    const fresh = entry('2026-08-31T09:00:00Z', { myrealtrip: { total: 186, scraped: 214 } });
    const { history } = mergeCrawlLogHistories({ entries: [] }, { entries: [old, fresh] }, ['myrealtrip'], NOW);
    assert.deepEqual(history.entries.map(row => row.timestamp), ['2026-08-31T09:00:00Z']);
    assert.equal(history.lastEntry.timestamp, '2026-08-31T09:00:00Z');
});

test('workflow CLI writes the merged history to the target file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikitikit-crawl-log-'));
    const targetPath = path.join(tempDir, 'target.json');
    const overlayPath = path.join(tempDir, 'overlay.json');
    try {
        fs.writeFileSync(targetPath, JSON.stringify({
            entries: [entry('2026-08-31T08:00:00Z', { ybtour: { total: 80, scraped: 240 } })],
        }));
        fs.writeFileSync(overlayPath, JSON.stringify({
            entries: [entry('2026-08-31T09:00:00Z', { myrealtrip: { total: 186, scraped: 214 } })],
        }));
        const result = spawnSync(
            process.execPath,
            ['scripts/merge-crawl-log.mjs', targetPath, overlayPath, 'myrealtrip'],
            { encoding: 'utf8' },
        );
        assert.equal(result.status, 0, result.stderr);
        const saved = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        assert.equal(saved.entries.length, 2);
        assert.equal(saved.lastEntry.sites.myrealtrip.scraped, 214);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
