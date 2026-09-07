import fs from 'node:fs';
import path from 'node:path';
import { connectDedicatedChrome } from '../src/lib/onlinetour-browser-adapter';
import { createOnlineTourRegionDiscovery, type RegionDiscoveryResult } from '../src/lib/onlinetour-region-discovery';
import { createStagingRun, validatePilotResponse } from '../src/lib/onlinetour-browser-collector';
import { checkValidationCooldown } from './crawl-onlinetour-catalogue';

function readSmallJson(file: string) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('invalid_evidence_file');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function validateAdFrameRecheckEvidence(marker: any, prior: any, date: string): string {
    const id = marker?.runId;
    const d = prior?.diagnostics, r = prior?.rejectedRequest;
    const finished = Date.parse(prior?.finishedAt);
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id || '') || prior?.runId !== id
        || prior.status !== 'failed' || prior.failure !== 'invalid_paused_request' || prior.cleanupConfirmed !== true
        || prior.productionReady !== false || prior.rawCount !== 0 || prior.mappedCount !== 0
        || !Number.isFinite(finished) || finished > Date.now() || new Date(finished + 9 * 3600_000).toISOString().slice(0, 10) !== date
        || d?.actions !== 1 || d.permittedDocumentRequests !== 1 || d.productRequests !== 0 || d.permittedProductRequests !== 0
        || d.documentRequests !== 2 || d.blockedRequests !== 1
        || r?.mainFrame !== false || r.method !== 'GET' || r.bodyPresent !== false || r.redirected !== false
        || r.responseStage !== false || r.origin !== 'https://gum.criteo.com' || r.path !== '/syncframe')
        throw new Error('ad_frame_recheck_evidence_required');
    return id;
}

// Explicitly authorized first-entry pilot or one fresh, user-approved ad-frame recheck.
// Never scheduled; no automatic retry, deleted markers or operational merge.
async function main() {
    const args = process.argv.slice(2);
    const recheck = args.length === 4 && args[3] === '--recheck-ad-frame-once';
    if (!(args.length === 3 || recheck) || args[0] !== '--consent-confirmed' || args[1] !== '--source-state')
        throw new Error('explicit_first_entry_authorization_required');
    const stat = fs.lstatSync(args[2]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('invalid_source_state');
    const state = JSON.parse(fs.readFileSync(args[2], 'utf8'));
    const age = Date.now() - Date.parse(state.fetchedAt), crawlAge = Date.now() - Date.parse(state.fullCrawlUpdatedAt);
    if (!/^[0-9a-f]{40}$/.test(state.revision || '') || !Number.isFinite(age) || age < 0 || age > 15 * 60_000
        || !Number.isFinite(crawlAge) || crawlAge < 0 || crawlAge > 6 * 3600_000 || !state.sourceCircuits)
        throw new Error('stale_source_state');
    checkValidationCooldown(state, null);
    if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA)) throw new Error('missing_local_state');
    const stateRoot = path.join(process.env.LOCALAPPDATA, 'Tikitikit', 'onlinetour-validation');
    fs.mkdirSync(stateRoot, { recursive: true });
    if (fs.lstatSync(stateRoot).isSymbolicLink()) throw new Error('unsafe_state_directory');
    const cooldown = path.join(stateRoot, 'cooldown.json');
    const lock = path.join(stateRoot, 'run.lock'), fd = fs.openSync(lock, 'wx');
    let client: Awaited<ReturnType<typeof connectDedicatedChrome>> | undefined;
    let adapter: Awaited<ReturnType<typeof createOnlineTourRegionDiscovery>> | undefined;
    try {
        checkValidationCooldown(state, fs.existsSync(cooldown) ? JSON.parse(fs.readFileSync(cooldown, 'utf8')) : null);
        const root = path.resolve(__dirname, '..');
        const ownCooldown = path.join(root, '.local-crawler', 'onlinetour-validation-cooldown.json');
        checkValidationCooldown(state, fs.existsSync(ownCooldown) ? JSON.parse(fs.readFileSync(ownCooldown, 'utf8')) : null);
        // One attempt on this host/date. Even a failed first entry is never restarted automatically.
        const date = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
        let priorRunId: string | null = null;
        if (recheck) {
            const marker = readSmallJson(path.join(stateRoot, `first-entry-${date}.json`));
            if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(marker.runId || '')) throw new Error('invalid_prior_run');
            const prior = readSmallJson(path.join(root, '.local-crawler', 'staging', marker.runId, 'summary.json'));
            priorRunId = validateAdFrameRecheckEvidence(marker, prior, date);
        }
        const run = createStagingRun(root);
        fs.writeFileSync(path.join(stateRoot, `${recheck ? 'ad-frame-recheck' : 'first-entry'}-${date}.json`),
            JSON.stringify({ runId: run.runId, priorRunId, startedAt: new Date().toISOString() }), { flag: 'wx' });
        let result: RegionDiscoveryResult | null = null, failure: string | null = null, cleanupConfirmed = false;
        try {
            client = await connectDedicatedChrome();
            adapter = await createOnlineTourRegionDiscovery(client, { maxNavigations: 1, maxProductRequests: 1 }, !recheck);
            result = recheck ? await adapter.reloadExistingRegion('AS') : await adapter.enterFirstList();
        } catch (error) {
            const reason = error instanceof Error ? error.message : '';
            failure = /^[a-z_]{1,80}$/.test(reason) ? reason : 'first_entry_failed';
        } finally {
            try { if (adapter) await adapter.close(); else await client?.close(); cleanupConfirmed = true; }
            catch { failure ||= 'cleanup_failed'; }
        }
        failure = adapter?.failure || failure;
        const firstPage = result?.firstPage || adapter?.partialEvidence[0] || null;
        const rawProducts = firstPage?.rawProducts || [];
        const validation = rawProducts.length ? validatePilotResponse('cb(' + JSON.stringify({ status: 200, data: { list: rawProducts } }) + ');', 'cb') : null;
        if (!failure && (!result || !validation || validation.status !== 'pilot_ready_for_review')) failure = 'empty_or_invalid_first_page';
        const summary = { runId: run.runId, status: failure ? 'failed' : 'pilot_ready_for_review', failure,
            partialScope: true, productionReady: false, browserMode: 'persistent_dedicated_loopback',
            rawCount: rawProducts.length, mappedCount: validation?.flights.length || 0, scope: firstPage?.scope || null,
            snapshot: result?.snapshot || null, cleanupConfirmed, diagnostics: adapter?.diagnostics || null,
            rejectedRequest: adapter?.lastRejectedRequest || null, sourceStateRevision: state.revision,
            mode: recheck ? 'user_approved_ad_frame_recheck' : 'first_entry', priorRunId,
            finishedAt: new Date().toISOString() };
        run.write('raw-products.json', rawProducts); run.write('flights.json', validation?.flights || []); run.write('summary.json', summary);
        if (['http_access_status', 'access_body', 'restricted_dom', 'empty_or_invalid_first_page'].includes(failure || ''))
            fs.writeFileSync(cooldown, JSON.stringify({ nextProbeAt: new Date(Date.now() + 86400_000).toISOString(), reason: failure }));
        console.log(JSON.stringify(summary));
        process.exitCode = failure ? 1 : 0;
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (require.main === module) void main().catch(error => {
    console.error(JSON.stringify({ status: 'failed', reason: /^[a-z_]{1,80}$/.test(error?.message || '') ? error.message : 'first_entry_preflight_failed', productionReady: false }));
    process.exitCode = 1;
});
