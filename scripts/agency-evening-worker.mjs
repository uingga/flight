import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertEveningHost, eveningAdmission } from './agency-evening-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AGENCY_EVENING_PROTOCOL = 'agency-evening-v1';
export const AGENCY_EVENING_FILES = Object.freeze([
    'all-flights-cache.json', 'crawl-log.json', 'interpark-prices.json', 'naver-prices.json',
    'naver-crawl-history.json', 'gid-map.json', 'today-pick.json', 'booking-link-health.json',
]);
const validId = value => typeof value === 'string'
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);

export function validateAgencyEveningRequest(request, { now = Date.now(), hostname = os.hostname() } = {}) {
    if (request?.protocol !== AGENCY_EVENING_PROTOCOL || !validId(request.id)
        || !Number.isFinite(Date.parse(request.createdAt))
        || Math.abs(now - Date.parse(request.createdAt)) > 5 * 60_000
        || !Array.isArray(request.sources) || request.sources.length < 1 || request.sources.length > 3
        || new Set(request.sources).size !== request.sources.length
        || !request.files || typeof request.files !== 'object'
        || Object.keys(request.files).some(name => !AGENCY_EVENING_FILES.includes(name))
        || !Array.isArray(request.files['all-flights-cache.json']?.flights)
        || !Array.isArray(request.files['crawl-log.json']?.entries)) throw new Error('invalid_evening_request');
    for (const source of request.sources) {
        assertEveningHost(source, hostname);
        if (!eveningAdmission({ slot: request.slot, source, now, cache: request.files['all-flights-cache.json'] }).allowed)
            throw new Error('evening_source_not_eligible');
    }
    return request;
}

function localCooldown(base, source) {
    if (!['ttang', 'modetour', 'onlinetour'].includes(source)) return undefined;
    const file = source === 'onlinetour'
        ? path.join(base, 'onlinetour-validation', 'cooldown.json')
        : path.join(base, `${source}-browser`, 'cooldown.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

export async function executeAgencyEvening(request, {
    now = Date.now, hostname = os.hostname(),
    base = path.join(os.homedir(), 'AppData/Local/Tikitikit'), collector = spawnSync,
} = {}) {
    validateAgencyEveningRequest(request, { now: now(), hostname });
    const state = path.join(base, 'agency-evening-v1');
    const shared = path.join(base, 'onlinetour-validation');
    for (const dir of [state, shared]) {
        fs.mkdirSync(dir, { recursive: true });
        if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('unsafe_evening_state');
    }
    const lock = path.join(shared, 'run.lock');
    const fd = fs.openSync(lock, 'wx');
    let activeSource = null;
    try {
        const claim = path.join(state, createHash('sha256').update(request.slot + ':' + hostname).digest('hex') + '.json');
        // A process crash or uncertain network result must not allow another site request for this slot.
        fs.writeFileSync(claim, JSON.stringify({ id: request.id, slot: request.slot, sources: request.sources }), { flag: 'wx' });
        const dir = path.join(state, request.id);
        fs.mkdirSync(dir);
        for (const [name, value] of Object.entries(request.files))
            fs.writeFileSync(path.join(dir, name), JSON.stringify(value));

        const results = [];
        const evidence = {};
        const eveningMarkers = { ...(request.files['all-flights-cache.json'].eveningPrimary || {}) };
        for (const source of request.sources) {
            const cachePath = path.join(dir, 'all-flights-cache.json');
            const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            const unknownPath = path.join(state, source + '-unknown.json');
            const unknown = fs.existsSync(unknownPath) ? JSON.parse(fs.readFileSync(unknownPath, 'utf8')) : undefined;
            if (unknown?.nextProbeAt != null
                && (!Number.isFinite(Date.parse(unknown.nextProbeAt)) || Date.parse(unknown.nextProbeAt) > now()))
                throw new Error(`evening_${source}_unknown_cooldown`);
            // The initial request is admitted within 15 minutes; subsequent sources may
            // start later while this same claimed, host-locked round is still running.
            const decision = eveningAdmission({ slot: request.slot, source, now: now(), cache,
                windowMinutes: 150, localCooldown: localCooldown(base, source) });
            if (!decision.allowed) throw new Error(`evening_${source}_${decision.reason}`);

            const startedAt = new Date(now()).toISOString();
            activeSource = source;
            const log = fs.openSync(path.join(dir, source + '.log'), 'wx');
            let outcome;
            try {
                outcome = collector(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'),
                    '--tsconfig', path.join(root, 'tsconfig.json'), path.join(root, 'scripts/agency-evening-collect.ts'), source], {
                    cwd: root, windowsHide: true, timeout: 45 * 60_000, stdio: ['ignore', log, log],
                    env: { ...process.env, TIKITIKIT_DATA_DIR: dir,
                        AGENCY_EVENING_ID: request.id, AGENCY_EVENING_STARTED_AT: startedAt },
                });
            } finally { fs.closeSync(log); }
            if (outcome.error || outcome.signal || ![0, 1].includes(outcome.status)) throw new Error('evening_collector_uncertain');
            const after = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            if (!Array.isArray(after.flights)) throw new Error('invalid_evening_cache');
            const fresh = outcome.status === 0 && Date.parse(after.sourceUpdatedAt?.[source]) >= Date.parse(startedAt);
            const nextProbe = after.sourceCircuits?.[source]?.nextProbeAt;
            const blocked = nextProbe != null && (!Number.isFinite(Date.parse(nextProbe)) || Date.parse(nextProbe) > now());
            if (!fresh && !blocked) throw new Error('evening_result_unverified');

            if (!fresh) {
                after.flights = [...after.flights.filter(flight => flight.source !== source),
                    ...cache.flights.filter(flight => flight.source === source)];
                after.sourceUpdatedAt = { ...after.sourceUpdatedAt,
                    [source]: cache.sourceUpdatedAt?.[source] };
            }

            if (source === 'ttang' && fresh) {
                const { readTtangPartialSummary } = await import('./ttang-staging-validation.mjs');
                const { TTANG_PROTOCOL, validateTtangEvidence } = await import('./ttang-primary-policy.mjs');
                const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'ttang-list-evidence.json'), 'utf8'));
                const partial = readTtangPartialSummary(dir, request.id);
                const completedAt = new Date(now()).toISOString();
                validateTtangEvidence({ protocol: TTANG_PROTOCOL, id: request.id,
                    startedAt, completedAt, cleanupConfirmed: true, cache: after, manifest, partial }, request.id, now());
                evidence.ttang = { startedAt, completedAt, manifest, partial };
            }
            if (source === 'modetour' && fresh)
                evidence.modetour = JSON.parse(fs.readFileSync(path.join(dir, 'mode-evidence.json'), 'utf8'));
            if (source === 'onlinetour' && fresh)
                evidence.onlinetour = JSON.parse(fs.readFileSync(path.join(dir, 'online-evidence.json'), 'utf8'));

            eveningMarkers[source] = { status: fresh ? 'success' : 'failed_preserved', lastAttemptAt: startedAt,
                ...(fresh ? { lastSuccessAt: after.sourceUpdatedAt[source] } : {}) };
            after.eveningPrimary = { ...(after.eveningPrimary || {}), ...eveningMarkers };
            fs.writeFileSync(cachePath, JSON.stringify(after));
            results.push({ source, status: fresh ? 'success' : 'failed_preserved' });
            activeSource = null;
            if (blocked) break; // Never continue to another source after an access restriction.
        }
        const reply = { protocol: AGENCY_EVENING_PROTOCOL, id: request.id, slot: request.slot,
            sources: results.map(item => item.source), results, evidence,
            cache: JSON.parse(fs.readFileSync(path.join(dir, 'all-flights-cache.json'), 'utf8')),
            logs: JSON.parse(fs.readFileSync(path.join(dir, 'crawl-log.json'), 'utf8')),
            completedAt: new Date(now()).toISOString() };
        fs.writeFileSync(path.join(dir, 'reply.json'), JSON.stringify(reply));
        return reply;
    } catch (error) {
        if (activeSource) fs.writeFileSync(path.join(state, activeSource + '-unknown.json'),
            JSON.stringify({ reason: 'uncertain_evening_outcome',
                nextProbeAt: new Date(now() + 86_400_000).toISOString(), id: request.id }));
        throw error;
    } finally {
        fs.closeSync(fd);
        fs.unlinkSync(lock);
    }
}
