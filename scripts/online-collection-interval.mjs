import { createHash } from 'node:crypto';

const DAY_MS = 86_400_000;

/** Stable pseudorandom choice per persisted attempt, shared by A, B and GitHub.
 * Never reroll on scheduler polls or restarts. Count failed attempts and claims too.
 */
export function onlineCollectionInterval(cache, now = new Date()) {
    const state = cache?.onlinePrimary;
    const values = [state?.lastAttemptAt, state?.githubAttemptAt].filter(v => v != null);
    if (!values.length && cache?.sourceUpdatedAt?.onlinetour) values.push(cache.sourceUpdatedAt.onlinetour);
    const timestamps = values.map(v => Date.parse(v));
    const ms = new Date(now).getTime();
    if (!Number.isFinite(ms) || timestamps.some(v => !Number.isFinite(v)))
        return { due: false, nextCollectionAt: null, intervalDays: null };
    if (!timestamps.length) return { due: true, nextCollectionAt: null, intervalDays: null };
    const anchor = Math.max(...timestamps);
    const key = new Date(anchor).toISOString();
    const intervalDays = 2 + (createHash('sha256').update(`onlinetour-interval-v1:${key}`).digest()[0] % 2);
    const next = anchor + intervalDays * DAY_MS;
    return { due: ms >= next, nextCollectionAt: new Date(next).toISOString(), intervalDays };
}
