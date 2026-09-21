import { config as loadEnv } from 'dotenv';
import { ga4Config, runBatchReports, runReport } from '../src/lib/ga4';
import { retentionPlan } from '../src/lib/ga-retention';

let stage = 'explicit-flag';
async function main() {
    if (!process.argv.includes('--live-ga4-read-only')) throw new Error('Explicit read-only flag required');
    stage = 'local-configuration';
    loadEnv({ path: '.env.local', quiet: true });
    const config = ga4Config();
    if (!config) throw new Error('GA4 configuration unavailable');
    stage = 'property-timezone-report';
    const info = await runReport(config, { dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }], metrics: [{ name: 'totalUsers' }] });
    const timeZone = info.metadata?.timeZone;
    if (!timeZone) throw new Error('Property time zone unavailable');
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const value = (type: string) => parts.find(part => part.type === type)?.value;
    const plan = retentionPlan(`${value('year')}-${value('month')}-${value('day')}`);
    stage = 'retention-batch';
    await runBatchReports(config, [plan.requests[0], plan.requests[1]]);
    console.log('PASS: GA4 property time zone and firstSessionDate/session_start/totalUsers batch contract accepted (3 read-only reports; no values printed)');
}
main().catch(() => { console.error(`FAIL: GA4 read-only contract check unavailable at ${stage}; no secret or response body logged`); process.exitCode = 1; });
