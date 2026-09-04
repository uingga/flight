#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateLocalSourceFallback } from './local-source-fallback-policy.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCAL_ROOT = path.join(ROOT, '.local-crawler');
const HERMES_ROOT = path.join(LOCAL_ROOT, 'hermes');
const STAGING_ROOT = path.join(LOCAL_ROOT, 'staging');
const WORKER_PATH = path.join(HERMES_ROOT, 'worker.json');
const LOCK_PATH = path.join(HERMES_ROOT, 'ttang-run.lock.json');
const RESULT_PATH = path.join(HERMES_ROOT, 'latest-result.json');
const OPERATIONAL_CACHE_PATH = path.join(ROOT, 'data', 'all-flights-cache.json');
const OPERATIONAL_FILES = [
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

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function operationalHashes() {
    return Object.fromEntries(OPERATIONAL_FILES.map(filename => [
        filename,
        sha256(path.join(ROOT, 'data', filename)),
    ]));
}

function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

function readRunLock() {
    const lock = readJson(LOCK_PATH);
    if (!lock) return null;
    if (isProcessAlive(Number(lock.pid))) return lock;

    // Only this exact ignored lock file is removed; staging and operational data are untouched.
    fs.rmSync(LOCK_PATH, { force: true });
    return null;
}

function latestSummary() {
    if (!fs.existsSync(STAGING_ROOT)) return null;

    const candidates = fs.readdirSync(STAGING_ROOT, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.startsWith('ttang-'))
        .map(entry => {
            const summaryPath = path.join(STAGING_ROOT, entry.name, 'summary.json');
            if (!fs.existsSync(summaryPath)) return null;
            return {
                summaryPath,
                mtimeMs: fs.statSync(summaryPath).mtimeMs,
                summary: readJson(summaryPath),
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return candidates[0] || null;
}

function fallbackPolicy() {
    const cache = readJson(OPERATIONAL_CACHE_PATH);
    if (!cache) {
        return { shouldRun: false, sources: [], reason: '운영 캐시를 읽을 수 없습니다.' };
    }
    return evaluateLocalSourceFallback({ cache });
}

function workerRegistration() {
    const worker = readJson(WORKER_PATH);
    if (!worker) return { registered: false, reason: '이 PC는 크롤링 작업자로 등록되지 않았습니다.' };
    if (worker.hostname !== os.hostname()) {
        return {
            registered: false,
            reason: '작업자 등록표가 다른 PC에서 만들어졌습니다.',
            registeredHostname: worker.hostname,
            currentHostname: os.hostname(),
        };
    }
    return { registered: true, ...worker };
}

function statusPayload() {
    const latest = latestSummary();
    const policy = fallbackPolicy();
    return {
        action: 'status',
        checkedAt: new Date().toISOString(),
        worker: workerRegistration(),
        running: readRunLock(),
        scheduledEligibility: {
            shouldRun: Boolean(policy.shouldRun && policy.sources?.includes('ttang')),
            reason: policy.reason,
            sources: policy.sources || [],
        },
        latest: latest
            ? { summaryPath: latest.summaryPath, summary: latest.summary }
            : null,
        operationalDataChangedByThisCommand: false,
    };
}

function emit(payload, exitCode = 0, persist = true) {
    if (persist) writeJson(RESULT_PATH, payload);
    console.log('\n=== HERMES TTANG OPERATOR RESULT ===');
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = exitCode;
}

function enroll() {
    const current = workerRegistration();
    if (current.registered) {
        emit({ action: 'enroll', status: 'already_registered', worker: current });
        return;
    }

    const worker = {
        role: 'tikitikit-crawler-worker',
        hostname: os.hostname(),
        registeredAt: new Date().toISOString(),
        repositoryRoot: ROOT,
        stagingOnly: true,
    };
    writeJson(WORKER_PATH, worker);
    emit({ action: 'enroll', status: 'registered', worker });
}

function assertRegisteredWorker() {
    const worker = workerRegistration();
    if (!worker.registered) {
        const error = new Error(`${worker.reason} 크롤링 PC에서 먼저 npm run hermes:ttang:enroll 을 실행하세요.`);
        error.code = 'WORKER_NOT_REGISTERED';
        throw error;
    }
    return worker;
}

function acquireRunLock(mode) {
    const running = readRunLock();
    if (running) {
        const error = new Error(`이미 ${running.mode} 작업이 실행 중입니다 (PID ${running.pid}).`);
        error.code = 'RUN_ALREADY_ACTIVE';
        throw error;
    }

    const lock = {
        pid: process.pid,
        mode,
        hostname: os.hostname(),
        startedAt: new Date().toISOString(),
    };
    fs.mkdirSync(HERMES_ROOT, { recursive: true });
    const fd = fs.openSync(LOCK_PATH, 'wx');
    fs.writeFileSync(fd, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    fs.closeSync(fd);
    return lock;
}

function run(mode) {
    const worker = assertRegisteredWorker();
    const policy = fallbackPolicy();
    if (mode === 'scheduled' && !(policy.shouldRun && policy.sources?.includes('ttang'))) {
        emit({
            action: mode,
            status: 'skipped',
            reason: policy.reason,
            worker,
            operationalDataChangedByThisCommand: false,
        });
        return;
    }

    const lock = acquireRunLock(mode);
    const beforeSummaryPath = latestSummary()?.summaryPath || null;
    const hashesBefore = operationalHashes();
    const script = mode === 'pilot'
        ? path.join(ROOT, 'scripts', 'run-ttang-browser-pilot.mjs')
        : path.join(ROOT, 'scripts', 'run-ttang-browser-scheduled.mjs');

    let result;
    try {
        result = spawnSync(process.execPath, [script], {
            cwd: ROOT,
            stdio: 'inherit',
        });
    } finally {
        fs.rmSync(LOCK_PATH, { force: true });
    }

    const hashesAfter = operationalHashes();
    const operationalDataChangedFiles = OPERATIONAL_FILES.filter(
        filename => hashesBefore[filename] !== hashesAfter[filename],
    );
    const operationalDataChanged = operationalDataChangedFiles.length > 0;
    const latest = latestSummary();
    const producedNewSummary = Boolean(latest && latest.summaryPath !== beforeSummaryPath);
    const exitCode = result?.status ?? 1;
    const payload = {
        action: mode,
        status: operationalDataChanged
            ? 'safety_violation'
            : exitCode === 0
                ? (latest?.summary?.status || 'completed')
                : (latest?.summary?.status || 'failed'),
        completedAt: new Date().toISOString(),
        worker,
        lock,
        exitCode,
        producedNewSummary,
        summaryPath: producedNewSummary ? latest.summaryPath : null,
        summary: producedNewSummary ? latest.summary : null,
        operationalDataChangedByThisCommand: operationalDataChanged,
        operationalDataChangedFiles,
        error: result?.error?.message || null,
    };

    if (operationalDataChanged) {
        payload.error = '안전 조건과 달리 운영 캐시가 변경되었습니다. 자동 후속 작업을 중단하세요.';
    }
    emit(payload, operationalDataChanged ? 2 : exitCode);
}

const action = process.argv[2] || 'status';
try {
    if (action === 'status') emit(statusPayload(), 0, false);
    else if (action === 'enroll') enroll();
    else if (action === 'pilot' || action === 'scheduled') run(action);
    else throw new Error(`지원하지 않는 작업입니다: ${action}`);
} catch (error) {
    emit({
        action,
        status: 'failed',
        completedAt: new Date().toISOString(),
        errorCode: error?.code || null,
        error: error?.message || String(error),
        operationalDataChangedByThisCommand: false,
    }, 1);
}
