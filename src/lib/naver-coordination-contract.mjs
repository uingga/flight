import { createHash } from 'node:crypto';

// Deliberately disabled until EVERY production integration has been implemented and verified.
// An environment variable alone must never opt a partially integrated crawler in.
const INTEGRATION_READY = false;
export function assertMode(env = process.env) {
    const mode = env.NAVER_COORDINATION ?? '0';
    if (!['0', '1'].includes(mode)) throw Error('invalid coordination mode');
    if (mode === '0') {
        if (Object.keys(env).some(k => k.startsWith('NAVER_COORDINATION_') && env[k])) throw Error('partial coordination configuration');
        return false;
    }
    if (!INTEGRATION_READY) throw Error('coordination integration incomplete; no browser requests permitted');
    return true;
}
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const cacheDigest = cache => {
    const { naverCoordination, lastUpdated, timestamp, ...content } = cache;
    return digest(content);
};
export function stampResult(cache, prices, { run, generation }) {
    if (typeof run !== 'string' || !run || !Number.isSafeInteger(generation) || generation < 1) throw Error('invalid result identity');
    const priceDigest = digest(prices);
    const contentDigest = cacheDigest(cache);
    const resultVersion = digest({ schema: 2, run, generation, priceDigest, contentDigest });
    return { ...cache, naverCoordination: { schema: 2, run, generation, priceDigest, contentDigest, resultVersion } };
}
// Validate at the read boundary too: any writer that changes content and carries
// the old marker invalidates it, even if that writer is not coordination-aware.
export function resultVersion(cache) {
    const m = cache?.naverCoordination;
    if (!m || m.schema !== 2 || m.contentDigest !== cacheDigest(cache)) return null;
    return m.resultVersion === digest({ schema: 2, run: m.run, generation: m.generation,
        priceDigest: m.priceDigest, contentDigest: m.contentDigest }) ? m.resultVersion : null;
}
export function verifyResult(cache, prices, expectedVersion) {
    const m = cache?.naverCoordination;
    return Boolean(m && expectedVersion && resultVersion(cache) === expectedVersion && m.priceDigest === digest(prices));
}
export function preserveResult(next, previous) {
    return previous?.naverCoordination
        ? { ...next, naverCoordination: structuredClone(previous.naverCoordination) }
        : next;
}

// Mirrors only the existing finalization gates. C is intentionally not an input.
// The production selection function and its same-KST-day guard are not changed.
export function shouldSelectTodayPick({ dataPublished, partialPricesAllowed, deferTodayPick, skipTodayPick }) {
    return Boolean(dataPublished && !partialPricesAllowed && !deferTodayPick && !skipTodayPick);
}
