import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { getCrawlDataDir } from '../src/lib/crawl-data-dir';
import { mergeCacheSource } from '../src/lib/merge-cache-source.mjs';
import { mergeCrawlLogHistories } from './merge-crawl-log.mjs';
import { eveningPlan, eveningSlotFor } from './agency-evening-policy.mjs';
import { AGENCY_EVENING_FILES, AGENCY_EVENING_PROTOCOL } from './agency-evening-worker.mjs';
import { TTANG_PROTOCOL, validateTtangEvidence } from './ttang-primary-policy.mjs';
import { MODE_REMOTE_PROTOCOL, validateModeBundle } from '../src/lib/modetour-operational';

const WORKER = 'C:/Users/ynal/AppData/Local/Tikitikit/agency-evening-v1/scripts/agency-evening-runtime.mjs';

function sshArgs(host: string): string[] {
    if (host === 'DESKTOP-OFFICE') return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', 'ConnectTimeout=15', 'tikitikit-pc-b', `node ${WORKER} --scheduled`];
    if (host !== 'DESKTOP-1PPFUR3') throw new Error('unknown_evening_host');
    const args = JSON.parse(process.env.AGENCY_EVENING_C_SSH_ARGS_JSON || 'null');
    if (!Array.isArray(args) || args.length < 8 || args.some(value => typeof value !== 'string')
        || !args.includes('BatchMode=yes') || !args.includes('StrictHostKeyChecking=yes'))
        throw new Error('C_ssh_configuration_required');
    return [...args, `node ${WORKER} --scheduled`];
}

async function dispatch(host: string, request: any): Promise<any> {
    return await new Promise((resolve, reject) => {
        const child = spawn('ssh.exe', sshArgs(host), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const fail = (reason: string) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            child.kill();
            reject(new Error(reason));
        };
        const timer = setTimeout(() => fail('remote_evening_completion_unknown'), 95 * 60_000);
        child.on('error', () => fail('remote_evening_transport_failed'));
        child.stdin.on('error', () => fail('remote_evening_transport_failed'));
        child.stderr.on('data', () => {});
        child.stdout.on('data', chunk => {
            size += chunk.length;
            if (size > 30_000_000) { fail('remote_evening_reply_too_large'); return; }
            chunks.push(Buffer.from(chunk));
        });
        child.on('close', code => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
                if (code !== 0) throw new Error('remote_evening_worker_failed');
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch { reject(new Error('remote_evening_result_unknown')); }
        });
        child.stdin.end(JSON.stringify(request));
    });
}

export async function verifyReply(reply: any, request: any, initialCache: any): Promise<void> {
    if (reply?.protocol !== AGENCY_EVENING_PROTOCOL || reply.id !== request.id || reply.slot !== request.slot
        || !Array.isArray(reply.sources) || reply.sources.length < 1
        || JSON.stringify(reply.sources) !== JSON.stringify(request.sources.slice(0, reply.sources.length))
        || !Array.isArray(reply.results) || reply.results.length !== reply.sources.length
        || !Array.isArray(reply.cache?.flights) || !Array.isArray(reply.logs?.entries)
        || !Number.isFinite(Date.parse(reply.completedAt)) || Date.parse(reply.completedAt) > Date.now())
        throw new Error('unverified_evening_reply');
    for (let i = 0; i < reply.results.length; i++) {
        const item = reply.results[i];
        if (item.source !== reply.sources[i] || !['success', 'failed_preserved'].includes(item.status))
            throw new Error('unverified_evening_outcome');
        if (item.status === 'success' && !(Date.parse(reply.cache.sourceUpdatedAt?.[item.source]) >= Date.parse(request.slot)))
            throw new Error('unverified_evening_timestamp');
        if (item.status === 'failed_preserved' && !reply.cache.sourceCircuits?.[item.source]?.nextProbeAt)
            throw new Error('unverified_evening_failure');
    }
    if (reply.sources.includes('modetour') && reply.results.find((item: any) => item.source === 'modetour')?.status === 'success') {
        const bundle = reply.evidence?.modetour;
        if (bundle?.protocol !== MODE_REMOTE_PROTOCOL) throw new Error('unverified_mode_evidence');
        await validateModeBundle(bundle, initialCache.flights, initialCache.modetourPrimary?.scopeCounts);
    }
    if (reply.sources.includes('ttang') && reply.results.find((item: any) => item.source === 'ttang')?.status === 'success') {
        const item = reply.evidence?.ttang;
        validateTtangEvidence({ protocol: TTANG_PROTOCOL, id: request.id,
            startedAt: item?.startedAt, completedAt: item?.completedAt, cleanupConfirmed: true,
            cache: reply.cache, manifest: item?.manifest, partial: item?.partial }, request.id);
    }
}

async function main() {
    if (process.argv.length !== 3 || process.argv[2] !== '--scheduled'
        || os.hostname().toUpperCase() !== 'OFFICE-OMEN' || process.env.NAVER_COORDINATION !== '1')
        throw new Error('scheduled_A_evening_only');
    const version = process.env.AGENCY_EVENING_RELEASE_VERSION;
    if (!/^[a-f0-9]{64}$/.test(version || '')) throw new Error('evening_release_version_required');
    const now = Date.now();
    const slot = eveningSlotFor(now);
    const dataDir = getCrawlDataDir();
    const files = Object.fromEntries(AGENCY_EVENING_FILES.filter(name => fs.existsSync(path.join(dataDir, name)))
        .map(name => [name, JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))]));
    const cache = files['all-flights-cache.json'];
    if (!Array.isArray(cache?.flights) || !Array.isArray(files['crawl-log.json']?.entries))
        throw new Error('evening_input_unavailable');
    const previousGeneralAt = Date.parse(slot) - 59 * 60_000;
    if (!(Date.parse(cache.fullCrawlUpdatedAt) >= previousGeneralAt)) {
        console.log(JSON.stringify({ status: 'upstream_pending', slot, sources: [] }));
        return;
    }
    const groups = eveningPlan(slot, now, cache).filter(group => group.sources.length);
    if (!groups.length) { console.log(JSON.stringify({ status: 'no_sources', slot, sources: [] })); return; }
    const state = path.join(os.homedir(), 'AppData/Local/Tikitikit/agency-evening-dispatch');
    fs.mkdirSync(state, { recursive: true });
    if (fs.lstatSync(state).isSymbolicLink()) throw new Error('unsafe_evening_dispatch_state');
    const lock = path.join(state, 'active.lock');
    const fd = fs.openSync(lock, 'wx');
    try {
        const claim = path.join(state, createHash('sha256').update(slot).digest('hex') + '.json');
        const requests = groups.map(group => ({ protocol: AGENCY_EVENING_PROTOCOL, id: randomUUID(), slot, version,
            sources: group.sources, createdAt: new Date().toISOString(), files }));
        fs.writeFileSync(claim, JSON.stringify({ slot, requests: requests.map(({ id, sources }) => ({ id, sources })) }), { flag: 'wx' });
        const runDir = path.join(state, slot.slice(0, 10) + '-' + randomUUID());
        fs.mkdirSync(runDir);
        const results = await Promise.allSettled(groups.map((group, i) => dispatch(group.host, requests[i])));
        let merged = structuredClone(cache);
        let logs = structuredClone(files['crawl-log.json']);
        const sources: string[] = [];
        const failures: string[] = [];
        for (let i = 0; i < results.length; i++) {
            const item = results[i];
            if (item.status !== 'fulfilled') { failures.push(groups[i].host); continue; }
            fs.writeFileSync(path.join(runDir, groups[i].host + '-reply.json'), JSON.stringify(item.value));
            try { await verifyReply(item.value, requests[i], cache); }
            catch { failures.push(groups[i].host); continue; }
            for (const source of item.value.sources) {
                merged = mergeCacheSource(merged, item.value.cache, source);
                sources.push(source);
            }
            logs = mergeCrawlLogHistories(logs, item.value.logs, item.value.sources).history;
        }
        fs.writeFileSync(path.join(runDir, 'outcome.json'), JSON.stringify({ slot, sources, failures }));
        if (!sources.length) throw new Error('evening_no_verified_results');
        const cachePath = path.join(runDir, 'cache.json');
        const logPath = path.join(runDir, 'crawl-log.json');
        fs.writeFileSync(cachePath, JSON.stringify(merged));
        fs.writeFileSync(logPath, JSON.stringify(logs));
        console.log(JSON.stringify({ status: failures.length ? 'partial' : 'verified', slot, sources,
            failedHosts: failures, cachePath, logPath }));
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    void main().catch(error => { console.error(error instanceof Error ? error.message : 'evening_dispatch_failed'); process.exitCode = 1; });
