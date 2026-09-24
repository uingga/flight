import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { getCrawlDataDir } from '../src/lib/crawl-data-dir';

async function main() {
    const source = process.argv[2];
    const dir = getCrawlDataDir();
    const runId = process.env.AGENCY_EVENING_ID;
    const startedAt = process.env.AGENCY_EVENING_STARTED_AT;
    if (!['ybtour', 'hanatour', 'modetour', 'ttang'].includes(source)
        || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(runId || '')
        || !Number.isFinite(Date.parse(startedAt || ''))
        || path.resolve(dir) === path.resolve('data')) throw new Error('private_evening_run_required');

    // Use installed Chrome without copying a personal profile or relaxing browser protections.
    const launch = chromium.launch.bind(chromium);
    chromium.launch = (options = {}) => launch({ ...options, channel: 'chrome' });
    process.env.LOCAL_SOURCE_FALLBACK = source === 'modetour' ? '1' : '0';
    process.env.LOCAL_BROWSER_PILOT = ['modetour', 'ttang'].includes(source) ? '1' : '0';
    process.env.CI = 'true';
    process.env.GITHUB_ACTIONS = '';
    process.env.SOURCE_START_JITTER_MAX_MS = '90000';

    if (source === 'ttang') {
        Object.assign(process.env, {
            TTANG_BROWSER_WORKER: '1',
            TTANG_DETAIL_CHECKPOINT: '1',
            TTANG_STAGING_RUN_ID: runId,
            TTANG_STAGING_STARTED_AT: startedAt,
            TTANG_BROWSER_CDP_URL: 'http://127.0.0.1:9222',
        });
    }
    if (source === 'modetour') {
        const { collectModeBrowser, modeBrowserPlan, modeScopeKey } = await import('../src/lib/modetour-browser');
        const { openModeBrowser } = await import('../src/lib/modetour-browser-adapter');
        const { MODE_REMOTE_PROTOCOL, validateModeBundle } = await import('../src/lib/modetour-operational');
        const cache = JSON.parse(fs.readFileSync(path.join(dir, 'all-flights-cache.json'), 'utf8'));
        const plan = modeBrowserPlan(new Date(), runId);
        const raw: Record<string, unknown[]> = {};
        const browser = await openModeBrowser(plan.maxListRequests);
        try {
            const result = await collectModeBrowser(plan, browser, async (scope, rows) => {
                raw[modeScopeKey(scope)] = rows;
                fs.writeFileSync(path.join(dir, 'mode-progress.json'), JSON.stringify(raw));
            }, [], { cached: {}, failed: [], previousRequests: 0 });
            const bundle = { protocol: MODE_REMOTE_PROTOCOL, capturedAt: new Date().toISOString(), plan, raw, result };
            await validateModeBundle(bundle, cache.flights, cache.modetourPrimary?.scopeCounts);
            const evidence = path.join(dir, 'mode-evidence.json');
            fs.writeFileSync(evidence, JSON.stringify(bundle));
            process.env.MODETOUR_SAVED_EVIDENCE = evidence;
            process.env.MODETOUR_BROWSER_REMOTE = '1';
        } finally { await browser.close(); }
    }
    process.argv = [process.argv[0], path.resolve('scripts/crawl-all.ts'), `--sources=${source}`];
    await import('./crawl-all');
}

void main().catch(error => { console.error(error instanceof Error ? error.message : 'evening_collector_failed'); process.exitCode = 1; });
