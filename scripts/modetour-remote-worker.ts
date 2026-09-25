import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { modeWorkerFailure, validateModeWorkerRequest } from '../src/lib/modetour-remote-contract';
import { checkModeCooldown } from './crawl-modetour-browser';
import { collectModeBrowser, modeBrowserPlan, modeScopeKey } from '../src/lib/modetour-browser';
import { openModeBrowser } from '../src/lib/modetour-browser-adapter';
import { MODE_REMOTE_PROTOCOL, validateModeBundle } from '../src/lib/modetour-operational';

let request: any;
let phase = 'preflight';
async function main() {
    if (process.argv.length !== 3 || process.argv[2] !== '--scheduled')
        throw new Error('explicit_scheduled_worker_required');
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 50000) throw new Error('request_too_large'); chunks.push(Buffer.from(chunk)); }
    request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const now = Date.now();
    validateModeWorkerRequest(request, { now, hostname: os.hostname() });
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
        phase = 'collection';
        const plan = modeBrowserPlan(new Date(now), request.id), raw: Record<string, unknown[]> = {};
        fs.writeFileSync(path.join(output,'plan.json'), JSON.stringify(plan));
        browser = await openModeBrowser(plan.maxListRequests);
        const result = await collectModeBrowser(plan, browser, async (scope, rows) => {
            const key = modeScopeKey(scope); raw[key] = rows;
            fs.writeFileSync(path.join(output, key.replace('/','-') + '.json'), JSON.stringify(rows));
        }, [], { cached: {}, failed: [], previousRequests: 0 });
        const bundle = { protocol: MODE_REMOTE_PROTOCOL, capturedAt: new Date().toISOString(), plan, raw, result };
        await validateModeBundle(bundle, [], request.cache.modetourPrimary?.scopeCounts);
        fs.writeFileSync(path.join(output,'bundle.json'), JSON.stringify(bundle));
        await browser.close(); browser = undefined;
        return { protocol: MODE_REMOTE_PROTOCOL, id: request.id, status: 'verified', bundle };
    } catch (error) {
        const reply = modeWorkerFailure(request, error, phase);
        const { reason, restricted } = reply;
        if (restricted) fs.writeFileSync(cooldown, JSON.stringify({ reason, nextProbeAt: new Date(Date.now()+86400000).toISOString() }));
        if (fs.existsSync(output)) fs.writeFileSync(path.join(output,'failure.json'), JSON.stringify({reason, diagnostics:browser?.diagnostics()}));
        return reply;
    } finally { phase = 'cleanup'; try { await browser?.close(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); } }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    void main().then(reply => {
        process.stdout.write(JSON.stringify(reply));
        if (reply.status !== 'verified') process.exitCode = 1;
    }).catch(error => {
        // Preserve the validated request identity even when admission fails before a browser exists.
        process.stdout.write(JSON.stringify(modeWorkerFailure(request, error, phase)));
        process.exitCode = 1;
    });
}
