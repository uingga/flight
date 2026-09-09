import { getScheduledAtForCron } from './crawl-schedule-health.mjs';

export const MRT_CRONS = ['5 21 * * *', '3 6 * * *'];
export const MRT_WORKFLOW = 'myrealtrip-scrape.yml';
export function latestMrtSlot(now = Date.now()) {
    const slots = MRT_CRONS.map(cron => ({ cron, at: getScheduledAtForCron(cron, now) }));
    const slot = slots.sort((a, b) => b.at - a.at)[0];
    return { expectedAt: new Date(slot.at).toISOString(), cron: slot.cron };
}
export function mrtClaimRef(expectedAt) {
    return `tags/mrt-slot/${expectedAt.replace(/[-:.]/g, '')}`;
}
export function resolveMrtSlot({ schedule, expectedAt, createdAt, now = Date.now() }) {
    if (schedule && !MRT_CRONS.includes(schedule)) return null;
    const latest = latestMrtSlot(now);
    const resolved = expectedAt || (schedule && MRT_CRONS.includes(schedule)
        ? new Date(getScheduledAtForCron(schedule, createdAt)).toISOString() : latest.expectedAt);
    if (resolved !== latest.expectedAt) return null;
    return latest;
}

export function mrtRunCoversSlot(run, slot) {
    const title = String(run.display_title || '');
    // Existing pre-rollout successes cover the slot too; do not crawl again on deployment.
    return run.conclusion === 'success' && run.status === 'completed'
        && (title.includes(slot.expectedAt)
            || (run.event === 'schedule' && title.includes(slot.cron)
                && getScheduledAtForCron(slot.cron, run.created_at) === Date.parse(slot.expectedAt)));
}

export function githubMrtClient(token, repository = 'uingga/flight', fetchImpl = fetch) {
    return async (path, method = 'GET', body) => {
        const response = await fetchImpl(`https://api.github.com/repos/${repository}/${path}`, {
            method, cache: 'no-store', signal: AbortSignal.timeout(10000),
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const data = response.status === 204 ? null : await response.json();
        return { status: response.status, data };
    };
}
async function readClaim(api, slot) {
    const result = await api(`git/ref/${mrtClaimRef(slot.expectedAt)}`);
    if (result.status === 200) return true;
    if (result.status !== 404) throw new Error(`MRT claim lookup failed: ${result.status}`);
    return false;
}
async function readRuns(api) {
    const result = await api(`actions/workflows/${MRT_WORKFLOW}/runs?branch=main&per_page=100`);
    if (result.status !== 200 || !Array.isArray(result.data?.workflow_runs)) throw new Error('MRT runs unavailable');
    return result.data.workflow_runs;
}

/** Immutable Git ref is an atomic, persistent reservation, independent of data commits. */
export async function reserveMrtSlot(api, slot, sha, currentRunId) {
    if (await readClaim(api, slot)) return false;
    const runs = await readRuns(api);
    if (runs.some(run => String(run.id) !== String(currentRunId) && mrtRunCoversSlot(run, slot))) return false;
    const result = await api('git/refs', 'POST', { ref: `refs/${mrtClaimRef(slot.expectedAt)}`, sha });
    if (result.status === 201) return true;
    // Two contenders may both see no ref. Only the successful creator can query the agency.
    if (result.status === 422 && await readClaim(api, slot)) return false;
    throw new Error(`MRT claim creation failed: ${result.status}`);
}

export async function checkMrtWatchdog(api, now = Date.now()) {
    const slot = latestMrtSlot(now);
    const result = { ...slot, delayMinutes: Math.floor((now - Date.parse(slot.expectedAt)) / 60000) };
    if (result.delayMinutes < 5) return { ...result, action: 'none', reason: 'grace_period' };
    if (await readClaim(api, slot)) return { ...result, action: 'none', reason: 'slot_reserved' };
    const runs = await readRuns(api);
    if (runs.some(run => run.status !== 'completed')) return { ...result, action: 'none', reason: 'active_run' };
    if (runs.some(run => mrtRunCoversSlot(run, slot))) return { ...result, action: 'none', reason: 'slot_completed' };
    if (runs.some(run => String(run.display_title || '').includes(slot.expectedAt)
        && now - Date.parse(run.created_at) < 45 * 60000)) return { ...result, action: 'none', reason: 'dispatch_cooldown' };
    const sent = await api(`actions/workflows/${MRT_WORKFLOW}/dispatches`, 'POST', {
        ref: 'main', inputs: { trigger_source: 'watchdog', expected_at: slot.expectedAt },
    });
    if (sent.status !== 204) throw new Error(`MRT dispatch failed: ${sent.status}`);
    return { ...result, action: 'dispatched' };
}
