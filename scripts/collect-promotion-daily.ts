import { runPromotionDaily } from '../src/lib/server/promotion-runner';
import { SupabasePromotionStore } from '../src/lib/server/promotion-store';
import { kstDay } from '../src/lib/promotion-daily';

// Explicit production gate. Tests import adapters and supply fixtures without this entrypoint.
if (process.env.PROMOTION_LIVE_RUN !== '1') {
    console.error('PROMOTION_LIVE_RUN=1 required; no requests made.'); process.exit(2);
}
const deadline = setTimeout(() => { console.error('promotion_runtime_limit; run remains incomplete'); process.exit(1); }, 20 * 60_000);
runPromotionDaily(new SupabasePromotionStore(), undefined, process.env.PROMOTION_RUN_DAY || kstDay())
    .then(result => { console.log(JSON.stringify(result)); if (!['complete', 'skipped'].includes(result.status)) process.exitCode = 1; })
    .catch(() => { console.error('promotion_job_failed; inspect saved run status'); process.exitCode = 1; })
    .finally(() => clearTimeout(deadline));
