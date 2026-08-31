import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SAME_DAY_PHASES = new Set(['running', 'success', 'blocked', 'degraded']);

function validTimestamp(value) {
    const timestamp = new Date(value || '').getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function kstDateKey(value) {
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return '';
    return new Date(timestamp + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function kstClockMinutes(now) {
    const shifted = new Date(now.getTime() + KST_OFFSET_MS);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
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

export function evaluateLocalNaverRun({
    now = new Date(),
    cache,
    state = null,
    fullCrawlHour = 11,
    fullCrawlMinute = 12,
    fallbackHour = 20,
    fallbackMinute = 30,
}) {
    const current = now instanceof Date ? now : new Date(now);
    const currentTimestamp = current.getTime();
    const currentKstDate = kstDateKey(current);
    if (!Number.isFinite(currentTimestamp)) {
        return { shouldRun: false, reason: 'invalid_now' };
    }

    const nextEligibleAt = validTimestamp(state?.nextEligibleAt);
    // Successful and blocked runs are limited by their KST date below, not by
    // an exact-hour deadline. A blocked session may start a little later than
    // usual, but it must still get one probe in the next scheduled KST-day run
    // instead of skipping that whole day for being a few minutes short of 24h.
    if (!['success', 'blocked'].includes(state?.phase) && nextEligibleAt !== null && currentTimestamp < nextEligibleAt) {
        return {
            shouldRun: false,
            reason: 'cooldown',
            kstDate: currentKstDate,
            nextEligibleAt: new Date(nextEligibleAt).toISOString(),
        };
    }

    if (state?.kstDate === currentKstDate && SAME_DAY_PHASES.has(state?.phase)) {
        return {
            shouldRun: false,
            reason: 'already_attempted_today',
            kstDate: currentKstDate,
            phase: state.phase,
        };
    }

    if (!cache || typeof cache !== 'object') {
        return { shouldRun: false, reason: 'cache_unreadable', kstDate: currentKstDate };
    }

    const fullCrawlAt = validTimestamp(cache.fullCrawlUpdatedAt || cache.timestamp);
    const myrealtripAt = validTimestamp(cache.sourceUpdatedAt?.myrealtrip);
    const fullReady = fullCrawlAt !== null
        && fullCrawlAt >= kstSlotTimestamp(current, fullCrawlHour, fullCrawlMinute);
    const myrealtripReady = myrealtripAt !== null
        && kstDateKey(myrealtripAt) === currentKstDate;
    const fallbackReady = kstClockMinutes(current) >= fallbackHour * 60 + fallbackMinute
        && (fullReady || myrealtripReady);

    return {
        shouldRun: fullReady || fallbackReady,
        reason: fullReady
            ? 'general_crawl_ready'
            : fallbackReady
                ? 'fallback_with_partial_upstream'
                : 'upstream_pending',
        kstDate: currentKstDate,
        fullReady,
        myrealtripReady,
        fullCrawlUpdatedAt: fullCrawlAt === null ? null : new Date(fullCrawlAt).toISOString(),
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

export function buildLocalNaverState(outcome, { now = new Date(), reason = '' } = {}) {
    const current = now instanceof Date ? now : new Date(now);
    const cooldownHours = outcome === 'degraded' || outcome === 'running'
        ? 12
        : 0;
    const nextEligibleAt = outcome === 'success' || outcome === 'blocked'
        ? nextKstTime(current, 10, 0)
        : new Date(current.getTime() + cooldownHours * HOUR_MS).toISOString();

    return {
        version: 1,
        kstDate: kstDateKey(current),
        phase: outcome,
        updatedAt: current.toISOString(),
        nextEligibleAt,
        ...(reason ? { reason } : {}),
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
        if (!statePath || !['running', 'success', 'blocked', 'degraded'].includes(outcome)) {
            throw new Error('mark requires --state and --outcome running|success|blocked|degraded');
        }
        const state = buildLocalNaverState(outcome, { now, reason });
        writeJsonAtomic(statePath, state);
        console.log(JSON.stringify(state));
        return;
    }

    throw new Error('usage: local-naver-run-policy.mjs check|mark ...');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    runCli();
}
