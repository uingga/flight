import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertMode } from '../../src/lib/naver-coordination-contract.mjs';

export const RUNNER_FILES = [
    'scripts/run-ac-installed.mjs',
    'src/lib/writer-relay-handler.mjs','src/lib/writer-relay-supabase.mjs','src/lib/writer-relay-web.mjs','src/lib/writer-relay-wire.mjs',
    'src/app/api/writer/[...path]/route.ts','scripts/sql/writer-relay.sql',
    'src/lib/writer-relay.mjs','src/lib/writer-relay-agent.mjs','scripts/start-writer-relay.mjs','scripts/publish-code.mjs',
    'src/lib/writer-service.mjs','scripts/lib/writer-reconcile.mjs',
    'src/lib/naver-http-request.mjs','src/lib/writer-broker.mjs','src/lib/writer-broker-client.mjs',
    'src/lib/writer-authority.mjs','src/lib/writer-app-token.mjs','src/lib/writer-admin-pick.mjs',
    'scripts/publish-writer.mjs','scripts/writer-push.mjs',
    'scripts/run-mrt-c.mjs','src/lib/mrt-shared-admission.mjs','src/lib/myrealtrip-schedule.mjs','scripts/merge-crawl-log.mjs',
    'src/lib/naver-http.mjs', 'src/lib/naver-publication.mjs',
    'scripts/start-naver-coordinator.mjs', 'scripts/lib/naver-runtime-config.ts',
    'scripts/initialize-naver-ledger.mjs',
    'scripts/lib/naver-collector-contract.ts',
    'scripts/lib/naver-scheduled-run.mjs', 'scripts/read-naver-pc-pending.ps1',
    'scripts/run-naver-host.mjs','scripts/lib/naver-host-handoff.mjs',
    'src/lib/naver-round-handoff.mjs','src/lib/mrt-round-readiness.mjs','scripts/run-naver-round-bridge.mjs',
    'src/lib/naver-writer-safety.mjs','src/lib/naver-fenced-writer.mjs','src/lib/merge-cache-source.mjs','scripts/writer-preflight.mjs',
    'scripts/merge-cache-source.mjs','scripts/run-source-fallback-crawl.ps1','scripts/auto-crawl.bat','src/app/api/admin-today-pick/route.ts',
    '.github/workflows/daily-crawl.yml','.github/workflows/myrealtrip-scrape.yml','.github/workflows/onlinetour-fallback.yml',
    '.github/workflows/flight-report-recheck.yml','.github/workflows/booking-link-health.yml','.github/workflows/today-pick.yml',
    'scripts/run-naver-crawl.ps1', 'scripts/run-naver-ac.ts', 'scripts/crawl-naver.ts',
    'scripts/debug-naver.ts', 'scripts/test-naver.ts', 'scripts/test-naver-xvfb.ts',
    'scripts/lib/naver-admission.mjs', 'scripts/lib/naver-navigation.mjs',
    'scripts/lib/naver-work-boundary.ts', 'scripts/lib/naver-selection.ts',
    'src/lib/naver-coordinator.mjs', 'src/lib/naver-ac-transport.mjs',
    'scripts/naver-ac-preflight.mjs', 'src/lib/naver-coordination-contract.mjs',
    'scripts/local-naver-run-policy.mjs', 'src/lib/naver-route.ts',
    'src/lib/naver-refresh-policy.ts', 'src/lib/naver-crawl-priority.ts',
    'scripts/filter-by-naver.ts', 'scripts/select-today-pick.mjs', 'package-lock.json',
    'src/app/api/flights/route.ts', 'scripts/wait-for-flight-api-cache.mjs',
    'src/lib/naver-recovery.mjs', 'src/lib/naver-crawl-page-state.ts',
    'src/lib/naver-price-filter.ts',
];
export function runnerDigest(root, read = readFileSync) {
    return createHash('sha256').update(JSON.stringify(RUNNER_FILES.map(file =>
        [file, createHash('sha256').update(read(resolve(root, file))).digest('hex')]))).digest('hex');
}
export function attestRunner({ digest, approvedDigest, externalLaunchersDisabled }) {
    if (!digest || !approvedDigest || digest !== approvedDigest || externalLaunchersDisabled !== true) {
        throw Error('runner set attestation missing or mismatched');
    }
    return digest;
}
export function legacyAdmission(env = process.env) {
    if (env.NAVER_COORDINATION === '1') throw Error('legacy entrypoint refused in coordinated mode');
    assertMode(env);
}
