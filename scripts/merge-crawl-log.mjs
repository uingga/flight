#!/usr/bin/env node
/**
 * 원격 최신 크롤 로그에 이번 세션이 측정했거나 명시적으로 건너뛴 소스 기록만 합친다.
 *
 *   node scripts/merge-crawl-log.mjs <target.json> <overlay.json> <source[,source...]>
 *
 * 긴 크롤 도중 다른 워크플로우가 남긴 로그를 파일 통째 복원으로 지우지 않도록
 * timestamp와 source 단위로 병합한다. 예약 정책상 건너뜀은 어드민에서 실패와 구분해야
 * 하므로 함께 옮기고, 아무 상태도 없는 단순 캐시 승계값만 제외한다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RETENTION_MS = 31 * 86_400_000;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasSessionEvent = (stat) => isObject(stat)
    && (stat.skipped === true || stat.scraped !== undefined || stat.preserved === true);

const timestampOf = (entry) => typeof entry?.timestamp === 'string'
    ? new Date(entry.timestamp).getTime()
    : Number.NaN;

export function mergeCrawlLogHistories(target, overlay, sourceKeys, now = Date.now()) {
    const selectedSources = Array.from(new Set(sourceKeys.map(source => source.trim()).filter(Boolean)));
    if (selectedSources.length === 0) throw new Error('병합할 source가 없습니다.');

    const targetEntries = Array.isArray(target?.entries) ? target.entries : [];
    const overlayEntries = Array.isArray(overlay?.entries) ? overlay.entries : [];
    const byTimestamp = new Map();

    for (const entry of targetEntries) {
        if (!Number.isFinite(timestampOf(entry)) || !isObject(entry?.sites)) continue;
        byTimestamp.set(entry.timestamp, {
            ...entry,
            sites: { ...entry.sites },
            alerts: Array.isArray(entry.alerts) ? [...entry.alerts] : [],
        });
    }

    let mergedSessions = 0;
    for (const entry of overlayEntries) {
        if (!Number.isFinite(timestampOf(entry)) || !isObject(entry?.sites)) continue;
        const measuredSites = Object.fromEntries(
            selectedSources
                .filter(source => hasSessionEvent(entry.sites[source]))
                .map(source => [source, { ...entry.sites[source] }]),
        );
        if (Object.keys(measuredSites).length === 0) continue;

        const current = byTimestamp.get(entry.timestamp);
        byTimestamp.set(entry.timestamp, {
            ...(current || {}),
            ...(entry.runKind ? { runKind: entry.runKind } : {}),
            timestamp: entry.timestamp,
            sites: {
                ...(current?.sites || {}),
                ...measuredSites,
            },
            alerts: Array.from(new Set([
                ...(Array.isArray(current?.alerts) ? current.alerts : []),
                ...(Array.isArray(entry.alerts) ? entry.alerts : []),
            ])),
        });
        mergedSessions += 1;
    }

    const cutoff = now - RETENTION_MS;
    const entries = [...byTimestamp.values()]
        .filter(entry => timestampOf(entry) > cutoff)
        .sort((left, right) => timestampOf(left) - timestampOf(right));

    return {
        history: {
            ...(isObject(target) ? target : {}),
            entries,
            lastEntry: entries[entries.length - 1],
        },
        mergedSessions,
    };
}

function runCli() {
    const [, , targetPath, overlayPath, sourceCsv] = process.argv;
    if (!targetPath || !overlayPath || !sourceCsv) {
        console.error('사용법: node merge-crawl-log.mjs <target.json> <overlay.json> <source[,source...]>');
        process.exit(1);
    }
    if (!fs.existsSync(targetPath)) {
        console.error(`❌ target 없음: ${targetPath}`);
        process.exit(1);
    }
    if (!fs.existsSync(overlayPath)) {
        console.error(`❌ overlay 없음: ${overlayPath}`);
        process.exit(1);
    }

    const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
    const sourceKeys = sourceCsv.split(',');
    const result = mergeCrawlLogHistories(target, overlay, sourceKeys);
    fs.writeFileSync(targetPath, JSON.stringify(result.history, null, 2));
    console.log(`✅ 크롤 로그 병합: ${sourceKeys.join(', ')} · 실제 회차 ${result.mergedSessions}개`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) runCli();
