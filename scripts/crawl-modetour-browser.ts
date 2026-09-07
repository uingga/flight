import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { collectModeBrowser, modeBrowserPlan, modeScopeKey, type ModePlan, type ModeContinuation } from '../src/lib/modetour-browser';

/** Resume only a proven sequential HTTP-500 stop. Never repeat any attempted scope. */
export function loadModeContinuation(dir: string, runId: string, plan: ModePlan): ModeContinuation {
    const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const failure = read('failure.json'), previousPlan = read('plan.json');
    const d = failure.diagnostics;
    if (failure.runId !== runId || failure.productionReady !== false || failure.reason !== 'list_http_failure'
        || JSON.stringify(previousPlan) !== JSON.stringify(plan) || d?.failure
        || !Array.isArray(d?.observations)) throw new Error('unsafe_continuation_evidence');
    const queries = d.observations.filter((o: any) => o.kind === 'list_request' && o.method === 'GET');
    const responses = d.observations.filter((o: any) => o.kind === 'response'
        && o.path === '/DiscountFlight/GetList' && o.status !== 204);
    if (!queries.length || queries.length >= 15 || d.listRequests !== queries.length || responses.length !== queries.length
        || d.observations.some((o: any) => o.kind === 'response' && [401,403,429].includes(o.status)))
        throw new Error('unsafe_continuation_evidence');
    const cached: Record<string, unknown[]> = {}, failed: ModeContinuation['failed'] = [];
    for (let i = 0; i < queries.length; i++) {
        const scope = plan.scopes[i], q = queries[i].query;
        if (q?.continentCode !== scope.continent || q.arrivalCity !== scope.city || q.departureCity !== ''
            || q.departureDate !== plan.from || q.arrivalDate !== plan.through || q.page !== '1' || q.itemCount !== '500'
            || responses[i].status !== (i === queries.length - 1 ? 500 : 200))
            throw new Error('unsafe_continuation_evidence');
        const key = modeScopeKey(scope);
        if (i === queries.length - 1) failed.push({ scope: key, status: 500 });
        else {
            const rows = read(`${key.replace('/', '-')}.json`);
            if (!Array.isArray(rows) || rows.length >= 500) throw new Error('unsafe_checkpoint');
            cached[key] = rows;
        }
    }
    return { cached, failed, previousRequests: queries.length };
}

/** One narrowly bounded retry when connection discovery failed before any browser page existed. */
export function canResumeModePreflight(failure: any): boolean {
    return failure?.productionReady === false && failure.diagnostics === undefined
        && ['dedicated_chrome_owner_unverified', 'dedicated_chrome_unavailable'].includes(failure.reason);
}

export function checkModeCooldown(cache: any, cooldown: any, now = Date.now()) {
    if (!cache || !Array.isArray(cache.flights) || !cache.sourceCircuits || typeof cache.sourceCircuits !== 'object')
        throw new Error('source_state_required');
    // Do not use a different PC/profile as an immediate retry of an active restriction.
    for (const value of [cache.sourceCircuits.modetour?.nextProbeAt,
        cache.sourceCircuits.modetour?.localFallback?.nextProbeAt, cooldown?.nextProbeAt]) {
        if (value !== undefined && (!Number.isFinite(Date.parse(value)) || Date.parse(value) > now))
            throw new Error('modetour_cooldown');
    }
}
async function main() {
    const args = process.argv.slice(2), plan = modeBrowserPlan();
    if (args.length === 1 && args[0] === '--plan') {
        console.log(JSON.stringify({ plan, siteRequests: 0, scheduled: false, productionReady: false }, null, 2)); return;
    }
    const resumeId = args.length === 5 && args[3] === '--resume-zero-request' ? args[4] : undefined;
    const continueId = args.length === 5 && args[3] === '--continue-unqueried' ? args[4] : undefined;
    const stage = args.join(' ') === '--stage' || (args.length === 3 || !!resumeId || !!continueId) && args[0] === '--stage' && args[1] === '--source-state';
    if (!stage || process.env.MODETOUR_BROWSER_LIVE !== '1')
        throw new Error('explicit_staging_run_required');
    const root = path.resolve(__dirname, '..');
    const cachePath = args.length >= 3 ? path.resolve(args[2]) : path.join(root, 'data/all-flights-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const updated = Date.parse(cache.fullCrawlUpdatedAt || cache.timestamp);
    if (!Number.isFinite(updated) || updated > Date.now() + 60_000 || Date.now() - updated > 6 * 3_600_000)
        throw new Error('fresh_source_state_required');
    const state = path.join(os.homedir(), 'AppData/Local/Tikitikit/modetour-browser');
    // Share OnlineTour's lock because both attach to the same browser. Never delete stale locks.
    const shared = path.join(os.homedir(), 'AppData/Local/Tikitikit/onlinetour-validation');
    fs.mkdirSync(state, { recursive: true }); fs.mkdirSync(shared, { recursive: true });
    if ([state, shared].some(p => fs.lstatSync(p).isSymbolicLink())) throw new Error('unsafe_state_directory');
    const cooldownPath = path.join(state, 'cooldown.json');
    const check = () => checkModeCooldown(cache, fs.existsSync(cooldownPath)
        ? JSON.parse(fs.readFileSync(cooldownPath, 'utf8')) : null);
    check();
    const lock = path.join(shared, 'run.lock'), fd = fs.openSync(lock, 'wx');
    let browser: Awaited<ReturnType<typeof import('../src/lib/modetour-browser-adapter').openModeBrowser>> | undefined;
    const runId = randomUUID();
    const output = path.join(root, '.local-crawler/modetour', runId);
    let continuation: ModeContinuation | undefined;
    try {
        check();
        fs.mkdirSync(output, { recursive: true });
        // Never reset an attempt or re-query after a site request. A connection-discovery-only
        // failure can continue once, retaining both the original marker and its failure evidence.
        const attempt = path.join(state, `${plan.from}.attempt.json`);
        if (continueId) {
            if (!/^[0-9a-f-]{36}$/.test(continueId)) throw new Error('invalid_resume_id');
            continuation = loadModeContinuation(path.join(root, '.local-crawler/modetour', continueId), continueId, plan);
            fs.writeFileSync(path.join(state, `${continueId}.unqueried-continuation.json`),
                JSON.stringify({ runId, parentRunId: continueId, previousRequests: continuation.previousRequests, plan }), { flag: 'wx' });
            fs.writeFileSync(path.join(output, 'continuation.json'), JSON.stringify({ parentRunId: continueId, ...continuation }));
        } else if (resumeId) {
            if (!/^[0-9a-f-]{36}$/.test(resumeId)) throw new Error('invalid_resume_id');
            const previousDir = path.join(root, '.local-crawler/modetour', resumeId);
            const failure = JSON.parse(fs.readFileSync(path.join(previousDir, 'failure.json'), 'utf8'));
            const previousPlan = JSON.parse(fs.readFileSync(path.join(previousDir, 'plan.json'), 'utf8'));
            if (JSON.stringify(previousPlan) !== JSON.stringify(plan) || failure.runId !== resumeId
                || failure.reason !== 'list_scope_mismatch' || failure.diagnostics?.listRequests !== 0
                || !Array.isArray(failure.diagnostics.observations)
                || failure.diagnostics.observations.some((o: any) => o.kind === 'response' && [401,403,429].includes(o.status)))
                throw new Error('resume_requires_zero_request_evidence');
            fs.writeFileSync(path.join(state, `${resumeId}.continued.json`),
                JSON.stringify({ runId, parentRunId: resumeId, plan }), { flag: 'wx' });
        } else if (fs.existsSync(attempt)) {
            const previous = JSON.parse(fs.readFileSync(attempt, 'utf8'));
            if (!/^[0-9a-f-]{36}$/.test(previous.runId || '') || JSON.stringify(previous.plan) !== JSON.stringify(plan))
                throw new Error('daily_attempt_already_exists');
            const failure = JSON.parse(fs.readFileSync(path.join(root, '.local-crawler/modetour', previous.runId, 'failure.json'), 'utf8'));
            if (failure.runId !== previous.runId || !canResumeModePreflight(failure)) throw new Error('daily_attempt_already_exists');
            fs.writeFileSync(path.join(state, `${plan.from}.preflight-retry.json`),
                JSON.stringify({ runId, parentRunId: previous.runId, plan }), { flag: 'wx' });
        } else fs.writeFileSync(attempt, JSON.stringify({ runId, plan }), { flag: 'wx' });
        fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify(plan, null, 2));
        const { openModeBrowser } = await import('../src/lib/modetour-browser-adapter');
        browser = await openModeBrowser(plan.maxListRequests - (continuation?.previousRequests || 0));
        const result = await collectModeBrowser(plan, browser, async (scope, rows) => {
            fs.writeFileSync(path.join(output, `${modeScopeKey(scope).replace('/', '-')}.json`), JSON.stringify(rows));
            console.log(JSON.stringify({ scope: modeScopeKey(scope), rawCount: rows.length }));
        }, cache.flights, continuation);
        fs.writeFileSync(path.join(output, 'candidate.json'), JSON.stringify({ runId, capturedAt: new Date().toISOString(), ...result }));
        fs.writeFileSync(path.join(output, 'diagnostics.json'), JSON.stringify(browser.diagnostics()));
        console.log(JSON.stringify({ runId, status: result.status, count: result.flights.length,
            totalListRequests: result.listRequests, newListRequests: result.newListRequests,
            reusedScopes: result.reusedScopes, failed: result.failed, productionReady: false }));
    } catch (e) {
        const reason = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'staging_failed';
        if (['access_restriction', 'empty_catalogue', 'source_count_collapse'].includes(reason)) fs.writeFileSync(cooldownPath,
            JSON.stringify({ reason, nextProbeAt: new Date(Date.now() + 86_400_000).toISOString() }));
        if (fs.existsSync(output)) fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ runId, reason,
            diagnostics: browser?.diagnostics(), productionReady: false }));
        throw new Error(reason);
    } finally {
        try { await browser?.close(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
    }
}
if (require.main === module) void main().catch(e => {
    console.error(e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'staging_preflight_failed');
    process.exitCode = 1;
});
