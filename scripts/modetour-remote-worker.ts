import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { evaluatePcCollection } from './pc-collection-policy.mjs';
import { checkModeCooldown } from './crawl-modetour-browser';
import { collectModeBrowser, modeBrowserPlan, modeScopeKey } from '../src/lib/modetour-browser';
import { openModeBrowser } from '../src/lib/modetour-browser-adapter';
import { MODE_REMOTE_PROTOCOL, validateModeBundle } from '../src/lib/modetour-operational';

async function main() {
    if (process.argv.length !== 3 || process.argv[2] !== '--scheduled' || os.hostname().toUpperCase() !== 'DESKTOP-OFFICE')
        throw new Error('explicit_scheduled_worker_required');
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 50000) throw new Error('request_too_large'); chunks.push(Buffer.from(chunk)); }
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const now = Date.now(), age = now - Date.parse(request.createdAt);
    if (request.protocol !== MODE_REMOTE_PROTOCOL || !/^[0-9a-f-]{36}$/.test(request.id || '') || !Number.isFinite(age) || age < 0 || age > 900000)
        throw new Error('invalid_worker_request');
    const policy = evaluatePcCollection({ cache: request.cache });
    if (!policy.shouldRun || !policy.sources.includes('modetour') || policy.expectedAt !== request.expectedAt) throw new Error('source_not_eligible');
    const crawlAge = now - Date.parse(request.cache.fullCrawlUpdatedAt);
    if (!Number.isFinite(crawlAge) || crawlAge < 0 || crawlAge > 6*3600000) throw new Error('stale_source_state');
    const base = path.join(os.homedir(), 'AppData/Local/Tikitikit');
    const state = path.join(base, 'modetour-browser'), shared = path.join(base, 'onlinetour-validation');
    fs.mkdirSync(state, { recursive: true }); fs.mkdirSync(shared, { recursive: true });
    if ([state,shared].some(p => fs.lstatSync(p).isSymbolicLink())) throw new Error('unsafe_state_directory');
    const cooldown = path.join(state, 'cooldown.json');
    const check = () => checkModeCooldown({ ...request.cache, flights: [] }, fs.existsSync(cooldown) ? JSON.parse(fs.readFileSync(cooldown,'utf8')) : null);
    check();
    const lock = path.join(shared, 'run.lock'), fd = fs.openSync(lock, 'wx');
    let browser: Awaited<ReturnType<typeof openModeBrowser>> | undefined;
    const output = path.resolve(__dirname, '../.local-crawler/modetour', request.id);
    try {
        check();
        const slot = createHash('sha256').update(request.expectedAt).digest('hex');
        fs.writeFileSync(path.join(state, `scheduled-${slot}.json`), JSON.stringify({ id: request.id, expectedAt: request.expectedAt }), { flag: 'wx' });
        fs.mkdirSync(output, { recursive: true });
        const plan = modeBrowserPlan(), raw: Record<string, unknown[]> = {};
        fs.writeFileSync(path.join(output,'plan.json'), JSON.stringify(plan));
        browser = await openModeBrowser();
        const result = await collectModeBrowser(plan, browser, async (scope, rows) => {
            const key = modeScopeKey(scope); raw[key] = rows;
            fs.writeFileSync(path.join(output, key.replace('/','-') + '.json'), JSON.stringify(rows));
            if (request.cache.modetourPrimary?.scopeCounts?.[key] > 0 && rows.length < request.cache.modetourPrimary.scopeCounts[key]*0.6)
                throw new Error('source_count_collapse');
        }, [], { cached: {}, failed: [], previousRequests: 0 });
        const bundle = { protocol: MODE_REMOTE_PROTOCOL, capturedAt: new Date().toISOString(), plan, raw, result };
        await validateModeBundle(bundle, [], request.cache.modetourPrimary?.scopeCounts);
        fs.writeFileSync(path.join(output,'bundle.json'), JSON.stringify(bundle));
        await browser.close(); browser = undefined;
        process.stdout.write(JSON.stringify({ protocol: MODE_REMOTE_PROTOCOL, id: request.id, status: 'verified', bundle }));
    } catch (error) {
        const reason = /^[a-z_]+$/.test((error as Error).message) ? (error as Error).message : 'worker_failed';
        const restricted = ['access_restriction','source_count_collapse','empty_catalogue'].includes(reason);
        if (restricted) fs.writeFileSync(cooldown, JSON.stringify({ reason, nextProbeAt: new Date(Date.now()+86400000).toISOString() }));
        if (fs.existsSync(output)) fs.writeFileSync(path.join(output,'failure.json'), JSON.stringify({reason, diagnostics:browser?.diagnostics()}));
        process.stdout.write(JSON.stringify({ protocol: MODE_REMOTE_PROTOCOL, id: request.id, status: 'failed', reason, restricted }));
        process.exitCode = 1;
    } finally { try { await browser?.close(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); } }
}
void main().catch(() => { process.stdout.write(JSON.stringify({status:'failed',reason:'worker_preflight_failed'})); process.exitCode=1; });
