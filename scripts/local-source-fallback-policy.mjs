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
    for (const source of SOURCE_KEYS) {
        const circuit = cache.sourceCircuits?.[source];
        const githubNextProbeAt = timestamp(circuit?.nextProbeAt);
        if (githubNextProbeAt === null || nowTimestamp >= githubNextProbeAt) continue;

        const localNextProbeAt = timestamp(circuit?.localFallback?.nextProbeAt);
        if (localNextProbeAt !== null && nowTimestamp < localNextProbeAt) {
            localCooldownSources.push(source);
            continue;
        }
        sources.push(source);
    }

    return {
        shouldRun: sources.length > 0,
        reason: sources.length > 0
            ? 'active_github_circuit'
            : localCooldownSources.length > 0
                ? 'local_cooldown'
                : 'no_active_circuits',
        sources,
        localCooldownSources,
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
