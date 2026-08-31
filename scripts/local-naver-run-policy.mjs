import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const GENERAL_SOURCES = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang'];
const TOTAL_NAVIGATION_BUDGET = 200;
const INITIAL_SLOT = { hour: 11, minute: 12 };
const RECOVERY_SLOT = { hour: 14, minute: 23 };
const FINAL_SLOT = { hour: 17, minute: 31 };
const TERMINAL_SAME_DAY_PHASES = new Set(['running', 'success', 'blocked', 'degraded']);

function validTimestamp(value) {
    const timestamp = new Date(value || '').getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function kstDateKey(value) {
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return '';
    return new Date(timestamp + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function kstSlotTimestamp(now, hour, minute) {
    const shifted = new Date(now.getTime() + KST_OFFSET_MS);
    return Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
        hour - 9,
        minute,
    );
}

function uniqueSources(values = []) {
    return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

function sourceTimestamp(cache, source) {
    return validTimestamp(cache?.sourceUpdatedAt?.[source]);
}

function pendingManualCapture(cache, source) {
    if (source !== 'modetour') return null;
    const status = cache?.manualCaptureStatus?.modetour;
    if (!status?.naverPending) return null;
    const pendingAt = validTimestamp(status.naverPendingAt || status.lastImportedAt);
    if (pendingAt === null) return null;
    return {
        pendingAt,
        lastAttemptAt: validTimestamp(status.naverLastAttemptAt),
    };
}

function nextManualSlot(cache, source, now) {
    const pending = pendingManualCapture(cache, source);
    if (!pending) return null;
    const eventAt = pending.lastAttemptAt ?? pending.pendingAt;
    const strictAfter = pending.lastAttemptAt !== null;
    const shifted = new Date(eventAt + KST_OFFSET_MS);
    const slots = [INITIAL_SLOT, RECOVERY_SLOT, FINAL_SLOT];
    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
        for (const slot of slots) {
            const timestamp = Date.UTC(
                shifted.getUTCFullYear(),
                shifted.getUTCMonth(),
                shifted.getUTCDate() + dayOffset,
                slot.hour - 9,
                slot.minute,
            );
            if (strictAfter ? timestamp > eventAt : timestamp >= eventAt) return timestamp;
        }
    }
    return kstSlotTimestamp(now, INITIAL_SLOT.hour, INITIAL_SLOT.minute);
}

function manualCaptureReady(cache, source, now) {
    const slot = nextManualSlot(cache, source, now);
    return slot !== null && now.getTime() >= slot;
}

function sourceIsFreshAfter(cache, source, cutoff) {
    if (pendingManualCapture(cache, source)) return true;
    const updatedAt = sourceTimestamp(cache, source);
    return updatedAt !== null && updatedAt >= cutoff;
}

function sourceCounts(cache) {
    const counts = new Map();
    for (const flight of Array.isArray(cache?.flights) ? cache.flights : []) {
        const source = String(flight?.source || '');
        if (!source) continue;
        counts.set(source, (counts.get(source) || 0) + 1);
    }
    return counts;
}

function initialNavigationBudget(cache, runSources, pendingSources, totalBudget) {
    if (pendingSources.length === 0) return totalBudget;
    const counts = sourceCounts(cache);
    const activeCount = runSources.reduce((sum, source) => sum + (counts.get(source) || 0), 0);
    const pendingCount = pendingSources.reduce((sum, source) => sum + (counts.get(source) || 0), 0);
    const totalCount = activeCount + pendingCount;
    const proportionalReserve = totalCount > 0
        ? Math.round(totalBudget * pendingCount / totalCount)
        : 0;
    const reserve = Math.min(80, Math.max(20, proportionalReserve));
    return Math.max(1, totalBudget - reserve);
}

function usedNavigationBudget(state, totalBudget) {
    const raw = Number(state?.navigationsUsed);
    // 구형 상태에는 사용량이 없다. 이미 실행된 양을 알 수 없을 때 새 200회를 주지 않는다.
    return Number.isFinite(raw) && raw >= 0 ? raw : totalBudget;
}

export function evaluateLocalNaverRun({
    now = new Date(),
    cache,
    state = null,
    totalNavigationBudget = TOTAL_NAVIGATION_BUDGET,
}) {
    const current = now instanceof Date ? now : new Date(now);
    const currentTimestamp = current.getTime();
    const currentKstDate = kstDateKey(current);
    if (!Number.isFinite(currentTimestamp)) {
        return { shouldRun: false, shouldFinalize: false, reason: 'invalid_now' };
    }

    if (!cache || typeof cache !== 'object') {
        return { shouldRun: false, shouldFinalize: false, reason: 'cache_unreadable', kstDate: currentKstDate };
    }

    const sameDayState = state?.kstDate === currentKstDate ? state : null;
    const nextEligibleAt = validTimestamp(sameDayState?.nextEligibleAt);
    if (!['success', 'blocked', 'partial_waiting'].includes(sameDayState?.phase)
        && nextEligibleAt !== null
        && currentTimestamp < nextEligibleAt) {
        return {
            shouldRun: false,
            shouldFinalize: false,
            reason: 'cooldown',
            kstDate: currentKstDate,
            nextEligibleAt: new Date(nextEligibleAt).toISOString(),
        };
    }

    const manualPending = pendingManualCapture(cache, 'modetour');
    const manualReady = manualCaptureReady(cache, 'modetour', current);
    if (sameDayState?.phase === 'success' && manualPending && manualReady) {
        const navigationsUsed = usedNavigationBudget(sameDayState, totalNavigationBudget);
        const navigationBudget = Math.max(0, totalNavigationBudget - navigationsUsed);
        if (navigationBudget <= 0) {
            return {
                shouldRun: false,
                shouldFinalize: false,
                reason: 'daily_budget_exhausted',
                kstDate: currentKstDate,
                runPhase: 'manual_recovery',
                navigationBudget,
                navigationsUsed,
            };
        }
        const completedSources = uniqueSources(sameDayState.completedSources || []);
        return {
            shouldRun: true,
            shouldFinalize: false,
            shouldFinalizeAfterRun: true,
            reason: 'manual_capture_ready',
            kstDate: currentKstDate,
            runPhase: 'manual_recovery',
            sources: ['modetour'],
            pendingSources: [],
            completedSources,
            navigationBudget,
            navigationsUsed,
            allowedTodayPickSources: uniqueSources([...completedSources, 'modetour']),
        };
    }

    if (sameDayState?.phase === 'success' && manualPending && !manualReady) {
        return {
            shouldRun: false,
            shouldFinalize: false,
            reason: 'manual_capture_waiting_for_next_slot',
            kstDate: currentKstDate,
            nextManualSlotAt: new Date(nextManualSlot(cache, 'modetour', current)).toISOString(),
        };
    }

    if (sameDayState && TERMINAL_SAME_DAY_PHASES.has(sameDayState.phase)) {
        return {
            shouldRun: false,
            shouldFinalize: false,
            reason: 'already_attempted_today',
            kstDate: currentKstDate,
            phase: sameDayState.phase,
        };
    }

    const fullCrawlAt = validTimestamp(cache.fullCrawlUpdatedAt || cache.timestamp);
    const initialSlotAt = kstSlotTimestamp(current, INITIAL_SLOT.hour, INITIAL_SLOT.minute);
    const recoverySlotAt = kstSlotTimestamp(current, RECOVERY_SLOT.hour, RECOVERY_SLOT.minute);
    const myrealtripAt = sourceTimestamp(cache, 'myrealtrip');
    const myrealtripReady = myrealtripAt !== null && kstDateKey(myrealtripAt) === currentKstDate;

    if (sameDayState?.phase === 'partial_waiting') {
        const completedSources = uniqueSources(sameDayState.completedSources || []);
        const pendingSources = uniqueSources([
            ...(sameDayState.pendingSources || []),
            ...(manualReady ? ['modetour'] : []),
        ]);
        const navigationsUsed = usedNavigationBudget(sameDayState, totalNavigationBudget);
        const navigationBudget = Math.max(0, totalNavigationBudget - navigationsUsed);
        const recoveryReady = fullCrawlAt !== null && fullCrawlAt >= recoverySlotAt;

        if (!recoveryReady) {
            return {
                shouldRun: false,
                shouldFinalize: false,
                reason: 'recovery_upstream_pending',
                kstDate: currentKstDate,
                runPhase: 'recovery',
                pendingSources,
                completedSources,
                navigationsUsed,
                fullCrawlUpdatedAt: fullCrawlAt === null ? null : new Date(fullCrawlAt).toISOString(),
            };
        }

        // A PC fallback may recover a blocked source between 11:12 and 14:23.
        // Wait for the 14:23 decision point, but accept any source that became
        // fresh after the initial slot rather than requiring another fetch.
        const recoveredSources = pendingSources.filter(source => sourceIsFreshAfter(cache, source, initialSlotAt));
        const stillPendingSources = pendingSources.filter(source => !recoveredSources.includes(source));
        if (navigationBudget <= 0 || recoveredSources.length === 0) {
            return {
                shouldRun: false,
                shouldFinalize: completedSources.length > 0,
                reason: navigationBudget <= 0 ? 'daily_budget_exhausted' : 'recovery_sources_unavailable',
                kstDate: currentKstDate,
                runPhase: 'recovery',
                sources: [],
                pendingSources: stillPendingSources,
                completedSources,
                navigationBudget,
                navigationsUsed,
                allowedTodayPickSources: completedSources,
            };
        }

        return {
            shouldRun: true,
            shouldFinalize: false,
            shouldFinalizeAfterRun: true,
            reason: 'recovery_sources_ready',
            kstDate: currentKstDate,
            runPhase: 'recovery',
            sources: recoveredSources,
            pendingSources: stillPendingSources,
            completedSources,
            navigationBudget,
            navigationsUsed,
            allowedTodayPickSources: uniqueSources([...completedSources, ...recoveredSources]),
            fullCrawlUpdatedAt: new Date(fullCrawlAt).toISOString(),
        };
    }

    const fullReady = fullCrawlAt !== null && fullCrawlAt >= initialSlotAt;
    if (!fullReady) {
        return {
            shouldRun: false,
            shouldFinalize: false,
            reason: 'upstream_pending',
            kstDate: currentKstDate,
            fullReady,
            myrealtripReady,
            fullCrawlUpdatedAt: fullCrawlAt === null ? null : new Date(fullCrawlAt).toISOString(),
            myrealtripUpdatedAt: myrealtripAt === null ? null : new Date(myrealtripAt).toISOString(),
        };
    }

    const freshGeneralSources = GENERAL_SOURCES.filter(source => sourceIsFreshAfter(cache, source, initialSlotAt));
    const pendingSources = GENERAL_SOURCES.filter(source => !freshGeneralSources.includes(source));
    const runSources = uniqueSources([...freshGeneralSources, ...(myrealtripReady ? ['myrealtrip'] : [])]);
    if (runSources.length === 0) {
        return {
            shouldRun: false,
            shouldFinalize: false,
            reason: 'no_fresh_sources',
            kstDate: currentKstDate,
            pendingSources,
            fullCrawlUpdatedAt: new Date(fullCrawlAt).toISOString(),
        };
    }

    // If the first usable full crawl is already the 14:23 recovery slot (or later),
    // stale sources have had their extra chance. Run the fresh subset and finalize.
    const recoveryWindowReached = fullCrawlAt >= recoverySlotAt;
    const deferTodayPick = pendingSources.length > 0 && !recoveryWindowReached;
    const navigationBudget = deferTodayPick
        ? initialNavigationBudget(cache, runSources, pendingSources, totalNavigationBudget)
        : totalNavigationBudget;

    return {
        shouldRun: true,
        shouldFinalize: false,
        shouldFinalizeAfterRun: !deferTodayPick,
        deferTodayPick,
        reason: pendingSources.length > 0 ? 'partial_general_crawl_ready' : 'general_crawl_ready',
        kstDate: currentKstDate,
        runPhase: 'initial',
        sources: runSources,
        pendingSources,
        completedSources: [],
        navigationBudget,
        navigationsUsed: 0,
        allowedTodayPickSources: runSources,
        fullReady,
        myrealtripReady,
        fullCrawlUpdatedAt: new Date(fullCrawlAt).toISOString(),
        myrealtripUpdatedAt: myrealtripAt === null ? null : new Date(myrealtripAt).toISOString(),
    };
}

function nextKstTime(now, hour, minute) {
    const shifted = new Date(now.getTime() + KST_OFFSET_MS);
    const next = Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate() + 1,
        hour - 9,
        minute,
    );
    return new Date(next).toISOString();
}

function sameDayKstTime(now, hour, minute) {
    return new Date(kstSlotTimestamp(now, hour, minute)).toISOString();
}

export function buildLocalNaverState(outcome, {
    now = new Date(),
    reason = '',
    previousState = null,
    completedSources = [],
    pendingSources = [],
    navigationIncrement = 0,
} = {}) {
    const current = now instanceof Date ? now : new Date(now);
    const sameDayPrevious = previousState?.kstDate === kstDateKey(current) ? previousState : null;
    const previousNavigations = Math.max(0, Number(sameDayPrevious?.navigationsUsed) || 0);
    const navigationsUsed = Math.min(
        TOTAL_NAVIGATION_BUDGET,
        previousNavigations + Math.max(0, Number(navigationIncrement) || 0),
    );
    const mergedCompletedSources = uniqueSources([
        ...(sameDayPrevious?.completedSources || []),
        ...completedSources,
    ]);
    const normalizedPendingSources = uniqueSources(pendingSources)
        .filter(source => !mergedCompletedSources.includes(source));
    const cooldownHours = outcome === 'degraded' || outcome === 'running' ? 12 : 0;
    const nextEligibleAt = outcome === 'partial_waiting'
        ? sameDayKstTime(current, RECOVERY_SLOT.hour, RECOVERY_SLOT.minute)
        : outcome === 'success' || outcome === 'blocked'
            ? nextKstTime(current, INITIAL_SLOT.hour, INITIAL_SLOT.minute)
            : new Date(current.getTime() + cooldownHours * HOUR_MS).toISOString();

    return {
        version: 2,
        kstDate: kstDateKey(current),
        phase: outcome,
        updatedAt: current.toISOString(),
        nextEligibleAt,
        navigationsUsed,
        completedSources: mergedCompletedSources,
        pendingSources: normalizedPendingSources,
        ...(reason ? { reason } : {}),
    };
}

function sourceFilterContains(sourceFilter, source) {
    const values = uniqueSources(String(sourceFilter || '').split(','));
    return values.includes('all') || values.includes(source);
}

export function completePendingManualCapture({ cache, history, sources = [] }) {
    const runSources = uniqueSources(sources);
    const status = cache?.manualCaptureStatus?.modetour;
    if (!runSources.includes('modetour')) return { cache, changed: false, reason: 'modetour_not_run' };
    if (!status?.naverPending) return { cache, changed: false, reason: 'no_pending_manual_capture' };

    const pendingAt = validTimestamp(status.naverPendingAt || status.lastImportedAt);
    const entries = Array.isArray(history?.entries) ? history.entries : [];
    const latest = entries
        .filter(entry => entry?.runner === 'local'
            && sourceFilterContains(entry.sourceFilter, 'modetour')
            && validTimestamp(entry.timestamp) !== null
            && (pendingAt === null || validTimestamp(entry.timestamp) >= pendingAt))
        .sort((left, right) => validTimestamp(right.timestamp) - validTimestamp(left.timestamp))[0];
    if (!latest) return { cache, changed: false, reason: 'matching_history_missing' };
    if (latest.abortedEarly || Number(latest.blocked || 0) > 0) {
        return { cache, changed: false, reason: 'unsafe_naver_run' };
    }

    const deferred = Math.max(0, Number(latest.deferred) || 0);
    const nextStatus = deferred > 0
        ? {
            ...status,
            naverPending: true,
            naverLastAttemptAt: latest.timestamp,
            naverDeferred: deferred,
        }
        : {
            ...status,
            naverPending: false,
            naverLastAttemptAt: latest.timestamp,
            naverProcessedAt: latest.timestamp,
            naverDeferred: 0,
        };
    return {
        cache: {
            ...cache,
            manualCaptureStatus: {
                ...(cache.manualCaptureStatus || {}),
                modetour: nextStatus,
            },
        },
        changed: true,
        reason: deferred > 0 ? 'manual_capture_deferred' : 'manual_capture_completed',
        deferred,
    };
}

function readJson(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, filePath);
}

function readOption(args, name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

function csvOption(args, name) {
    return uniqueSources(String(readOption(args, name) || '').split(','));
}

function runCli() {
    const [command, ...args] = process.argv.slice(2);
    const nowValue = readOption(args, '--now');
    const now = nowValue ? new Date(nowValue) : new Date();

    if (command === 'check') {
        const cachePath = readOption(args, '--cache');
        const statePath = readOption(args, '--state');
        let cache = null;
        let state = null;
        try {
            cache = readJson(cachePath);
            state = readJson(statePath);
        } catch (error) {
            console.log(JSON.stringify({
                shouldRun: false,
                shouldFinalize: false,
                reason: 'policy_file_unreadable',
                detail: String(error?.message || error),
            }));
            process.exitCode = 2;
            return;
        }
        console.log(JSON.stringify(evaluateLocalNaverRun({ now, cache, state })));
        return;
    }

    if (command === 'mark') {
        const statePath = readOption(args, '--state');
        const outcome = readOption(args, '--outcome');
        const reason = readOption(args, '--reason') || '';
        const completedSources = csvOption(args, '--completed-sources');
        const pendingSources = csvOption(args, '--pending-sources');
        const navigationIncrement = Number(readOption(args, '--navigation-increment') || 0);
        if (!statePath || !['running', 'partial_waiting', 'success', 'blocked', 'degraded'].includes(outcome)) {
            throw new Error('mark requires --state and --outcome running|partial_waiting|success|blocked|degraded');
        }
        const previousState = readJson(statePath);
        const state = buildLocalNaverState(outcome, {
            now,
            reason,
            previousState,
            completedSources,
            pendingSources,
            navigationIncrement,
        });
        writeJsonAtomic(statePath, state);
        console.log(JSON.stringify(state));
        return;
    }

    if (command === 'complete-manual-capture') {
        const cachePath = readOption(args, '--cache');
        const historyPath = readOption(args, '--history');
        const sources = csvOption(args, '--sources');
        if (!cachePath || !historyPath) throw new Error('complete-manual-capture requires --cache and --history');
        const cache = readJson(cachePath);
        const history = readJson(historyPath);
        const result = completePendingManualCapture({ cache, history, sources });
        if (result.changed) writeJsonAtomic(cachePath, result.cache);
        console.log(JSON.stringify({ changed: result.changed, reason: result.reason, deferred: result.deferred || 0 }));
        return;
    }

    throw new Error('usage: local-naver-run-policy.mjs check|mark|complete-manual-capture ...');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    runCli();
}
