#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
    countFreshTtangDetails,
    isTtangStagingReady,
    readTtangPartialSummary,
} from './ttang-staging-validation.mjs';

const ROOT = process.cwd();
const runStartedAt = new Date();
const runId = randomUUID();
const SOURCE_DATA_DIR = path.join(ROOT, 'data');
const DEFAULT_CDP = 'http://127.0.0.1:9222';
const INPUT_FILES = [
    'all-flights-cache.json',
    'crawl-log.json',
    'price-history.json',
    'interpark-prices.json',
    'naver-prices.json',
    'naver-crawl-history.json',
    'gid-map.json',
    'today-pick.json',
    'booking-link-health.json',
];

function argValue(prefix) {
    const arg = process.argv.slice(2).find(value => value.startsWith(`${prefix}=`));
    return arg ? arg.slice(prefix.length + 1) : null;
}

function compactTimestamp(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function comparableKey(flight) {
    return [
        flight?.airline || '',
        flight?.departure?.airport || flight?.departure?.city || '',
        flight?.arrival?.airport || flight?.arrival?.city || '',
        flight?.departure?.date || '',
        flight?.arrival?.date || '',
        Number(flight?.price) || 0,
    ].join('|');
}

const cdpEndpoint = argValue('--cdp') || DEFAULT_CDP;
const requestedDir = argValue('--output');
const fallbackMode = process.argv.includes('--fallback');
const allDetails = process.argv.includes('--all-details');
if (allDetails && fallbackMode) throw new Error('--all-details는 명시적 staging 파일럿 전용입니다.');
const execution = { detailScope: allDetails ? 'all_eligible' : 'capped_20', timeoutMinutes: allDetails ? 60 : 30 };
const stagingDir = requestedDir
    ? path.resolve(requestedDir)
    : path.join(ROOT, '.local-crawler', 'staging', `ttang-${compactTimestamp()}`);

if (fs.existsSync(stagingDir)) {
    throw new Error(`기존 staging 폴더를 덮어쓰지 않습니다: ${stagingDir}`);
}
fs.mkdirSync(stagingDir, { recursive: true });

for (const filename of INPUT_FILES) {
    const source = path.join(SOURCE_DATA_DIR, filename);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(stagingDir, filename));
}

const cachePath = path.join(stagingDir, 'all-flights-cache.json');
if (!fs.existsSync(cachePath)) {
    throw new Error('운영 all-flights-cache.json 복사본을 만들지 못했습니다.');
}
const before = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!fs.existsSync(tsxCli)) {
    throw new Error('tsx가 설치되어 있지 않습니다. 먼저 npm install을 실행해주세요.');
}
const result = spawnSync(process.execPath, [tsxCli, 'scripts/crawl-all.ts', '--sources=ttang', ...(allDetails ? ['--ttang-all-details'] : [])], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: execution.timeoutMinutes * 60 * 1_000,
    killSignal: 'SIGTERM',
    env: {
        ...process.env,
        TIKITIKIT_DATA_DIR: stagingDir,
        TTANG_DETAIL_CHECKPOINT: '1',
        TTANG_STAGING_RUN_ID: runId,
        TTANG_STAGING_STARTED_AT: runStartedAt.toISOString(),
        TTANG_BROWSER_CDP_URL: cdpEndpoint,
        ...(fallbackMode
            ? { LOCAL_SOURCE_FALLBACK: '1' }
            : { LOCAL_BROWSER_PILOT: '1' }),
        SOURCE_START_JITTER_MAX_MS: '0',
    },
});

const partialDetails = readTtangPartialSummary(stagingDir, runId, { timedOut: result.error?.code === 'ETIMEDOUT' });

if (result.status !== 0) {
    const summary = {
        status: 'failed',
        execution,
        runId,
        partialDetails,
        completedAt: new Date().toISOString(),
        stagingDir,
        mode: fallbackMode ? 'fallback' : 'pilot',
        exitCode: result.status,
        error: result.error?.code === 'ETIMEDOUT'
            ? `땡처리 staging이 ${execution.timeoutMinutes}분 안에 종료되지 않아 중단했습니다.`
            : result.error?.message,
        operationalDataChanged: false,
    };
    fs.writeFileSync(path.join(stagingDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.error(JSON.stringify(summary, null, 2));
    process.exit(result.status || 1);
}

const after = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const beforeFlights = (before.flights || []).filter(flight => flight?.source === 'ttang');
const afterFlights = (after.flights || []).filter(flight => flight?.source === 'ttang');
const beforeKeys = new Set(beforeFlights.map(comparableKey));
const afterKeys = new Set(afterFlights.map(comparableKey));
const beforeUpdatedAt = Date.parse(before.sourceUpdatedAt?.ttang || '');
const afterUpdatedAt = Date.parse(after.sourceUpdatedAt?.ttang || '');
const productIdentified = afterFlights.filter(flight => flight.ttangProduct?.fareId).length;
const { timeVerified, seatVerified } = countFreshTtangDetails(afterFlights, runStartedAt, { runId, partialDetails });
const sourceAccepted = Number.isFinite(afterUpdatedAt)
    && (!Number.isFinite(beforeUpdatedAt) || afterUpdatedAt > beforeUpdatedAt)
    && afterFlights.length > 0
    && productIdentified > 0;
const validationPassed = isTtangStagingReady({ sourceAccepted, timeVerified, seatVerified, partialDetails });
const summary = {
    status: validationPassed ? 'ready_for_review' : 'failed_validation',
    execution,
    runId,
    partialDetails,
    completedAt: new Date().toISOString(),
    stagingDir,
    mode: fallbackMode ? 'fallback' : 'pilot',
    operationalDataChanged: false,
    ttang: {
        scraped: Number(after.scrapedCounts?.ttang || 0),
        visibleBefore: beforeFlights.length,
        visibleAfter: afterFlights.length,
        added: [...afterKeys].filter(key => !beforeKeys.has(key)).length,
        removed: [...beforeKeys].filter(key => !afterKeys.has(key)).length,
        productIdentified,
        timeVerified,
        seatVerified,
        minimumTwoPeople: afterFlights.filter(flight => Number(flight.minPax) > 1).length,
    },
    reviewFiles: {
        cache: cachePath,
        crawlLog: path.join(stagingDir, 'crawl-log.json'),
    },
};

fs.writeFileSync(path.join(stagingDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('\n=== 땡처리 로컬 브라우저 staging 완료 ===');
console.log(JSON.stringify(summary, null, 2));
if (!validationPassed) {
    console.error('땡처리 목록·상세 시간·좌석을 모두 확인하지 못해 운영 후보로 사용할 수 없습니다.');
    process.exit(1);
}
