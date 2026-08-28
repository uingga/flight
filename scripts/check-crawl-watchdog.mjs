import fs from 'node:fs';
import path from 'node:path';
import { getCrawlScheduleHealth } from '../src/lib/crawl-schedule-health.mjs';

const cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const now = process.env.WATCHDOG_NOW ? new Date(process.env.WATCHDOG_NOW) : new Date();
const health = getCrawlScheduleHealth(cache.timestamp, { now });
const shouldDispatch = health.status === 'overdue';

console.log(JSON.stringify({
    checkedAt: now.toISOString(),
    ...health,
    shouldDispatch,
}, null, 2));

if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, [
        `should_dispatch=${shouldDispatch}`,
        `status=${health.status}`,
        `expected_at=${health.expectedAt || ''}`,
        `expected_cron=${health.expectedCron || ''}`,
        `last_completed_at=${health.lastCompletedAt || ''}`,
        `delay_minutes=${health.delayMinutes}`,
    ].join('\n') + '\n');
}

if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        '### Crawl schedule health',
        '',
        `- Status: **${health.status}**`,
        `- Expected slot: \`${health.expectedAt || 'none'}\` (\`${health.expectedCron || 'none'}\`)`,
        `- Last completed: \`${health.lastCompletedAt || 'none'}\``,
        `- Delay: \`${health.delayMinutes} minutes\``,
        `- Dispatch fallback: \`${shouldDispatch}\``,
        '',
    ].join('\n'));
}
