import { createHash } from 'node:crypto';

/** Stable per-run permutation. Persist the seed, never reshuffle a resumed run.
 * @template T
 * @param {T[]} items
 * @param {string | undefined} [seed]
 * @param {(value:T)=>string} [key]
 * @returns {T[]}
 */
export function crawlOrder(items, seed, key = value => String(value)) {
    if (!seed) return [...items];
    if (typeof seed !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(seed)) throw Error('invalid_order_seed');
    return items.map(value => ({ value, key: key(value), rank: createHash('sha256')
        .update(seed + '\0' + key(value)).digest('hex') }))
        .sort((a, b) => a.rank.localeCompare(b.rank) || a.key.localeCompare(b.key)).map(row => row.value);
}

/** Extra jitter never shortens a caller's existing minimum or retry delay. */
export function crawlWaitMs(minimum, random = Math.random) {
    if (!Number.isSafeInteger(minimum) || minimum < 0) throw Error('invalid_wait');
    const fraction = random();
    if (!(fraction >= 0 && fraction < 1)) throw Error('invalid_random');
    return minimum + Math.floor(fraction * 3001);
}

export function finiteListBudget(targetCount, attemptsPerTarget = 1, safetyCeiling = 100) {
    if (![targetCount, attemptsPerTarget, safetyCeiling].every(n => Number.isSafeInteger(n) && n > 0))
        throw Error('invalid_list_budget');
    const required = targetCount * attemptsPerTarget;
    if (required > safetyCeiling) throw Error('planned_requests_exceed_safety_ceiling');
    return required;
}
