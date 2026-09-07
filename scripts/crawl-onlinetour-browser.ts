import path from 'node:path';
import { collectBrowserPilot, createStagingRun } from '../src/lib/onlinetour-browser-collector';
import { discoverDedicatedChromeEndpoint, ONLINE_CHROME_CONNECT_TIMEOUT_MS } from '../src/lib/onlinetour-dedicated-chrome';

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
        console.log('OnlineTour staging-only partial pilot (one reload, first response, max20).\n'
            + 'Usage: npx --no-install tsx scripts/crawl-onlinetour-browser.ts --consent-confirmed\n'
            + 'Consent flag confirms operator authorization for this bounded test.\n'
            + 'Keep dedicated Chrome (loopback 9222) with exactly one OnlineTour list tab open.\n'
            + 'No endpoint/output/profile options; no browser launch or automatic retries.');
        return;
    }
    if (args.length !== 1 || args[0] !== '--consent-confirmed') {
        console.error('Refused: consent required or unsupported option. Use --help (offline).');
        process.exitCode = 2;
        return;
    }
    // Fixed repository root, not cwd and not caller-supplied output paths.
    const endpoint = await discoverDedicatedChromeEndpoint();
    const run = createStagingRun(path.resolve(__dirname, '..'));
    const { chromium } = await import('playwright');
    let browser;
    try {
        console.log('Connecting to verified dedicated Chrome; no navigation until preflight passes.');
        browser = await chromium.connectOverCDP(endpoint, { timeout: ONLINE_CHROME_CONNECT_TIMEOUT_MS });
    } catch {
        // No raw browser error: Playwright diagnostics can include connection URLs/profile metadata.
        run.write('summary.json', { runId: run.runId, status: 'failed_preflight', partialScope: true,
            productionReady: false, rawCount: 0, mappedCount: 0, reason: 'dedicated_chrome_attach_failed',
            finishedAt: new Date().toISOString() });
        console.error(`Dedicated Chrome attach failed; no retry. Staging run: ${run.runId}`);
        process.exitCode = 1;
        return;
    }
    const summary = await collectBrowserPilot(browser, run);
    console.log(JSON.stringify({ runId: run.runId, status: summary.status, rawCount: summary.rawCount,
        mappedCount: summary.mappedCount, partialScope: true, productionReady: false }));
    process.exitCode = summary.status === 'pilot_ready_for_review' ? 0 : 1;
}

void main().catch(() => {
    console.error('OnlineTour staging pilot failed: discovery, staging path or local write unavailable. No automatic retry.');
    process.exitCode = 1;
});
