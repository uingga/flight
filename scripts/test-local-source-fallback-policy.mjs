import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateLocalSourceFallback } from './local-source-fallback-policy.mjs';

function circuit(overrides = {}) {
    return {
        reason: 'blocked',
        openedAt: '2026-08-30T01:00:00.000Z',
        nextProbeAt: '2026-08-31T01:00:00.000Z',
        resumePolicy: 'cooldown_or_adapter_change',
        adapterVersion: 'test-1',
        detail: 'soft block',
        ...overrides,
    };
}

test('waits until the matching GitHub crawl slot is complete', () => {
    const result = evaluateLocalSourceFallback({
        now: '2026-08-30T02:20:00.000Z', // 11:20 KST, 11:12 slot
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T01:50:00.000Z',
            sourceCircuits: { ttang: circuit() },
        },
    });

    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'upstream_pending');
    assert.equal(result.expectedAt, '2026-08-30T02:12:00.000Z');
    assert.equal(result.nextExpectedAt, '2026-08-30T05:23:00.000Z');
});

test('runs only sources whose GitHub circuit is active', () => {
    const result = evaluateLocalSourceFallback({
        now: '2026-08-30T02:20:00.000Z',
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T02:18:00.000Z',
            sourceCircuits: {
                ttang: circuit(),
                modetour: circuit({ nextProbeAt: '2026-08-30T02:19:59.000Z' }),
            },
        },
    });

    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'active_github_circuit');
    assert.deepEqual(result.sources, ['ttang']);
});

test('a PC-side block pauses only the local fallback', () => {
    const result = evaluateLocalSourceFallback({
        now: '2026-08-30T02:20:00.000Z',
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T02:18:00.000Z',
            sourceCircuits: {
                ttang: circuit({
                    localFallback: {
                        status: 'blocked',
                        lastAttemptAt: '2026-08-30T02:19:00.000Z',
                        nextProbeAt: '2026-08-31T02:19:00.000Z',
                        detail: 'CAPTCHA',
                    },
                }),
            },
        },
    });

    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'local_cooldown');
    assert.deepEqual(result.localCooldownSources, ['ttang']);
});

test('Modetour PC DOM runs only once on the same KST date', () => {
    const result = evaluateLocalSourceFallback({
        now: '2026-08-30T05:30:00.000Z', // 14:30 KST
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T05:25:00.000Z',
            sourceCircuits: {
                modetour: circuit({
                    nextProbeAt: '2026-08-31T05:00:00.000Z',
                    localFallback: {
                        status: 'success',
                        lastAttemptAt: '2026-08-30T02:25:00.000Z',
                        method: 'modetour-dom',
                        detail: 'DOM 수집 완료',
                    },
                }),
            },
        },
    });

    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'local_daily_limit');
    assert.deepEqual(result.localDailyLimitSources, ['modetour']);
});

test('Modetour PC DOM can run at the first slot of the next KST date', () => {
    const result = evaluateLocalSourceFallback({
        now: '2026-08-30T23:20:00.000Z', // 2026-08-31 08:20 KST
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T23:18:00.000Z',
            sourceCircuits: {
                modetour: circuit({
                    nextProbeAt: '2026-09-01T14:50:00.000Z',
                    localFallback: {
                        status: 'blocked',
                        lastAttemptAt: '2026-08-30T14:50:00.000Z', // 23:50 KST
                        nextProbeAt: '2026-08-31T14:50:00.000Z',
                        method: 'source-default',
                        detail: '예전 PC API 차단',
                    },
                }),
            },
        },
    });

    assert.equal(result.shouldRun, true);
    assert.equal(result.reason, 'active_github_circuit');
    assert.deepEqual(result.sources, ['modetour']);
});

test('does nothing when no GitHub source circuit is active', () => {
    const result = evaluateLocalSourceFallback({
        now: '2026-08-30T02:20:00.000Z',
        cache: {
            fullCrawlUpdatedAt: '2026-08-30T02:18:00.000Z',
            sourceCircuits: {},
        },
    });

    assert.equal(result.shouldRun, false);
    assert.equal(result.reason, 'no_active_circuits');
});

test('source merge keeps the GitHub circuit while publishing the PC result', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikitikit-source-fallback-'));
    const targetPath = path.join(tempDir, 'target.json');
    const overlayPath = path.join(tempDir, 'overlay.json');
    const baseCircuit = circuit();
    fs.writeFileSync(targetPath, JSON.stringify({
        timestamp: '2026-08-30T02:18:00.000Z',
        fullCrawlUpdatedAt: '2026-08-30T02:18:00.000Z',
        count: 2,
        flights: [{ id: 'old', source: 'ttang' }, { id: 'other', source: 'ybtour' }],
        sources: { ttang: 1, ybtour: 1 },
        sourceCircuits: { ttang: baseCircuit },
        integrityAlerts: ['⛔ 땡처리닷컴 이전 경고', '🚨 ybtour unrelated alert'],
    }));
    fs.writeFileSync(overlayPath, JSON.stringify({
        timestamp: '2026-08-30T02:25:00.000Z',
        count: 2,
        flights: [{ id: 'new', source: 'ttang' }, { id: 'other', source: 'ybtour' }],
        sources: { ttang: 1, ybtour: 1 },
        sourceCircuits: {
            ttang: {
                ...baseCircuit,
                localFallback: {
                    status: 'success',
                    lastAttemptAt: '2026-08-30T02:25:00.000Z',
                    detail: 'PC 대체 수집 완료',
                },
            },
        },
        integrityAlerts: ['⛔ ttang PC 대체 수집 상태'],
    }));

    try {
        const merged = spawnSync(process.execPath, [
            'scripts/merge-cache-source.mjs',
            targetPath,
            overlayPath,
            'ttang',
        ], { encoding: 'utf8' });
        assert.equal(merged.status, 0, merged.stderr);
        const result = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        assert.equal(result.fullCrawlUpdatedAt, '2026-08-30T02:18:00.000Z');
        assert.equal(result.sourceCircuits.ttang.nextProbeAt, baseCircuit.nextProbeAt);
        assert.equal(result.sourceCircuits.ttang.localFallback.status, 'success');
        assert.deepEqual(result.integrityAlerts, [
            '🚨 ybtour unrelated alert',
            '⛔ ttang PC 대체 수집 상태',
        ]);
        assert.deepEqual(result.flights.map(flight => flight.id).sort(), ['new', 'other']);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
