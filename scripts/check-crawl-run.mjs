import fs from 'node:fs';
import path from 'node:path';
import {
    getFullCrawlUpdatedAt,
    getCrawlScheduleHealth,
    getScheduledAtForCron,
} from '../src/lib/crawl-schedule-health.mjs';

const eventName = process.env.TRIGGER_EVENT || 'manual';
const triggerSchedule = (process.env.TRIGGER_SCHEDULE || '').trim();
const triggerSource = (process.env.TRIGGER_SOURCE || '').trim();
const expectedInput = (process.env.EXPECTED_AT || '').trim();
const checkCache = process.env.CHECK_CACHE === '1';
const now = process.env.CHECK_NOW ? new Date(process.env.CHECK_NOW) : new Date();

let expectedTimestamp = null;
if (expectedInput) {
    const parsed = new Date(expectedInput).getTime();
    if (!Number.isFinite(parsed)) throw new Error(`Invalid EXPECTED_AT: ${expectedInput}`);
    expectedTimestamp = parsed;
} else if (triggerSchedule) {
    expectedTimestamp = getScheduledAtForCron(triggerSchedule, now);
}

let lastCompletedAt = null;
let cacheUpdatedAt = null;
if (checkCache) {
    const cachePath = process.env.CRAWL_CACHE_PATH
        || path.join(process.cwd(), 'data', 'all-flights-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const parsedCacheTimestamp = new Date(cache.timestamp).getTime();
    cacheUpdatedAt = Number.isFinite(parsedCacheTimestamp)
        ? new Date(parsedCacheTimestamp).toISOString()
        : null;
    lastCompletedAt = getFullCrawlUpdatedAt(cache);
}

const automatic = eventName === 'schedule' || triggerSource === 'watchdog';
const expectedDate = expectedTimestamp === null ? null : new Date(expectedTimestamp);
const isTodayPickSlot = automatic
    && expectedDate !== null
    && expectedDate.getUTCHours() === 2
    && expectedDate.getUTCMinutes() === 56;
const shouldRun = !checkCache
    || !automatic
    || expectedTimestamp === null
    || lastCompletedAt === null
    || new Date(lastCompletedAt).getTime() < expectedTimestamp;
const expectedAt = expectedTimestamp === null ? null : new Date(expectedTimestamp).toISOString();
const delayMinutes = expectedTimestamp === null
    ? null
    : Math.max(0, Math.floor((now.getTime() - expectedTimestamp) / 60_000));
const reason = shouldRun
    ? automatic ? 'scheduled slot is not covered by a completed crawl' : 'manual run'
    : 'scheduled slot is already covered by a completed crawl';

console.log(`[trigger] event=${eventName}`);
console.log(`[trigger] schedule=${triggerSchedule || 'none'}`);
console.log(`[trigger] source=${triggerSource || 'none'}`);
console.log(`[trigger] expected_at=${expectedAt || 'none'}`);
console.log(`[trigger] observed_at=${now.toISOString()}`);
console.log(`[trigger] delay_minutes=${delayMinutes ?? 'n/a'}`);
if (checkCache) {
    console.log(`[preflight] cache_updated_at=${cacheUpdatedAt || 'none'}`);
    console.log(`[preflight] last_completed_at=${lastCompletedAt || 'none'}`);
}
console.log(`[preflight] should_run=${shouldRun}`);
console.log(`[preflight] is_today_pick_slot=${isTodayPickSlot}`);
console.log(`[preflight] reason=${reason}`);

const outputPath = process.env.GITHUB_OUTPUT;
if (outputPath) {
    fs.appendFileSync(outputPath, [
        `should_run=${shouldRun}`,
        `is_today_pick_slot=${isTodayPickSlot}`,
        `expected_at=${expectedAt || ''}`,
        `delay_minutes=${delayMinutes ?? ''}`,
        `last_completed_at=${lastCompletedAt || ''}`,
    ].join('\n') + '\n');
}

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
    fs.appendFileSync(summaryPath, [
        '### Trigger metadata',
        '',
        `- Event: \`${eventName}\``,
        `- Schedule: \`${triggerSchedule || 'none'}\``,
        `- Source: \`${triggerSource || 'none'}\``,
        `- Expected at: \`${expectedAt || 'none'}\``,
        `- Observed at: \`${now.toISOString()}\``,
        `- Delay: \`${delayMinutes ?? 'n/a'} minutes\``,
        ...(checkCache ? [
            `- Last completed at: \`${lastCompletedAt || 'none'}\``,
            `- Crawl required: \`${shouldRun}\` (${reason})`,
            `- Today pick slot: \`${isTodayPickSlot}\``,
        ] : []),
        '',
    ].join('\n'));
}

// 이 import가 배포 워크플로에서 tree-shaking되지 않아도 모듈 자체가 정상인지 확인한다.
if (checkCache) getCrawlScheduleHealth(lastCompletedAt, { now });
