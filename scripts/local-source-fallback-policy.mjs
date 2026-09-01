import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DAILY_CRAWL_CRONS,
    parseDailyCron,
} from '../src/lib/crawl-schedule-health.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE_KEYS = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang'];

function timestamp(value) {
    const parsed = new Date(value || '').getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function surroundingSlots(nowTimestamp, crons = DAILY_CRAWL_CRONS) {
    const dayStart = Math.floor(nowTimestamp / DAY_MS) * DAY_MS;
    const slots = [];
    for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
        const day = dayStart + dayOffset * DAY_MS;
        for (const cron of crons) {
            const parsed = parseDailyCron(cron);
            if (!parsed) continue;
            slots.push(day + (parsed.hour * 60 + parsed.minute) * 60_000);
        }
    }
    slots.sort((a, b) => a - b);
    const expectedAt = [...slots].reverse().find(slot => slot <= nowTimestamp) ?? null;
    const nextExpectedAt = expectedAt === null
        ? null
        : slots.find(slot => slot > expectedAt) ?? null;
    return { expectedAt, nextExpectedAt };
}

function scheduledSlotDistance(anchorAt, currentAt, crons = DAILY_CRAWL_CRONS) {
    if (anchorAt === null || currentAt === null || currentAt < anchorAt) return null;

    const firstDay = Math.floor(anchorAt / DAY_MS) * DAY_MS;
    const lastDay = Math.floor(currentAt / DAY_MS) * DAY_MS;
    let distance = 0;
    for (let day = firstDay; day <= lastDay; day += DAY_MS) {
        for (const cron of crons) {
            const parsed = parseDailyCron(cron);
            if (!parsed) continue;
            const slot = day + (parsed.hour * 60 + parsed.minute) * 60_000;
            if (slot > anchorAt && slot <= currentAt) distance += 1;
        }
    }
    return distance;
}

function isPcFallbackCollectionSlot(circuit, expectedAt, crons = DAILY_CRAWL_CRONS) {
    if (expectedAt === null) return false;

    const nextProbeAt = timestamp(circuit?.nextProbeAt);
    const openedAt = timestamp(circuit?.openedAt)
        ?? (nextProbeAt === null ? null : nextProbeAt - DAY_MS);
    if (openedAt === null) return false;

    const anchorAt = surroundingSlots(openedAt, crons).expectedAt;
    const distance = scheduledSlotDistance(anchorAt, expectedAt, crons);
    return distance !== null && distance % 2 === 0;
}

export function evaluateLocalSourceFallback({
    now = new Date(),
    cache,
    crons = DAILY_CRAWL_CRONS,
} = {}) {
    const nowTimestamp = now instanceof Date ? now.getTime() : timestamp(now);
    if (nowTimestamp === null || !Number.isFinite(nowTimestamp)) {
        return { shouldRun: false, reason: 'invalid_now', sources: [] };
    }

    const { expectedAt, nextExpectedAt } = surroundingSlots(nowTimestamp, crons);
    const base = {
        expectedAt: expectedAt === null ? null : new Date(expectedAt).toISOString(),
        nextExpectedAt: nextExpectedAt === null ? null : new Date(nextExpectedAt).toISOString(),
    };
    if (!cache || typeof cache !== 'object') {
        return { shouldRun: false, reason: 'cache_unreadable', sources: [], ...base };
    }

    const fullCrawlAt = timestamp(cache.fullCrawlUpdatedAt);
    if (expectedAt === null || fullCrawlAt === null || fullCrawlAt < expectedAt) {
        return {
            shouldRun: false,
            reason: 'upstream_pending',
            sources: [],
            fullCrawlUpdatedAt: fullCrawlAt === null ? null : new Date(fullCrawlAt).toISOString(),
            ...base,
        };
    }

    const sources = [];
    const localCooldownSources = [];
    const manualCaptureSources = [];
    const scheduleThrottledSources = [];
    for (const source of SOURCE_KEYS) {
        const circuit = cache.sourceCircuits?.[source];
        const githubNextProbeAt = timestamp(circuit?.nextProbeAt);
        if (githubNextProbeAt === null || nowTimestamp >= githubNextProbeAt) continue;

        // 모두투어는 GitHub 실패 뒤 PC 자동 수집으로 넘기지 않는다. 사용자가 일반 Chrome에서
        // 화면을 확인해 캡처를 전달하고, 검증된 카드만 부분 병합한다.
        if (source === 'modetour') {
            manualCaptureSources.push(source);
            continue;
        }

        const localNextProbeAt = timestamp(circuit?.localFallback?.nextProbeAt);
        if (localNextProbeAt !== null && nowTimestamp < localNextProbeAt) {
            localCooldownSources.push(source);
            continue;
        }
        // GitHub 실패가 발생한 회차는 PC가 대체하고, 그 다음 회차는 쉬는 식으로
        // 소스별 차단 회로가 열려 있는 24시간 동안 수집/휴식을 번갈아 적용한다.
        if (!isPcFallbackCollectionSlot(circuit, expectedAt, crons)) {
            scheduleThrottledSources.push(source);
            continue;
        }
        sources.push(source);
    }
    if (
        Number(cache.staleStreak?.modetour || 0) > 0
        && !manualCaptureSources.includes('modetour')
    ) {
        manualCaptureSources.push('modetour');
    }

    return {
        shouldRun: sources.length > 0,
        reason: sources.length > 0
            ? 'active_github_circuit'
            : manualCaptureSources.length > 0
                ? 'manual_capture_required'
            : localCooldownSources.length > 0
                ? 'local_cooldown'
                : scheduleThrottledSources.length > 0
                    ? 'source_schedule_throttled'
                : 'no_active_circuits',
        sources,
        manualCaptureSources,
        localCooldownSources,
        scheduleThrottledSources,
        fullCrawlUpdatedAt: new Date(fullCrawlAt).toISOString(),
        ...base,
    };
}

function argValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const isDirectRun = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
    const command = process.argv[2] || 'check';
    if (command !== 'check') {
        console.error('사용법: node scripts/local-source-fallback-policy.mjs check --cache <cache.json>');
        process.exit(1);
    }
    const cachePath = argValue('--cache');
    if (!cachePath || !fs.existsSync(cachePath)) {
        console.error('읽을 수 있는 --cache 파일이 필요합니다.');
        process.exit(1);
    }
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const result = evaluateLocalSourceFallback({
        now: process.env.SOURCE_FALLBACK_NOW || new Date(),
        cache,
    });
    console.log(JSON.stringify(result));
}
