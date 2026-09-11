import { randomUUID } from 'node:crypto';
import { kstDay, mergeLatest, PROMOTION_SOURCES, type SourceResult, type SourceLatest } from '../promotion-daily';
import type { PromotionStore } from './promotion-store';
import { collectTe31 } from './promotion-te31';
import { collectRemoteSource } from './promotion-remote';
import { safeReason } from './promotion-http';

export interface PromotionAdapter {
    source: string;
    collect(day: string, latest: Map<string, SourceLatest>, runId: string): Promise<SourceResult>;
}
export const defaultAdapters = (): PromotionAdapter[] => [
    { source: 'threads', collect: (day, _latest, runId) => collectRemoteSource('threads', day, runId) },
    { source: 'te31', collect: day => collectTe31(day, { verified: process.env.PROMOTION_TE31_LISTING_VERIFIED === '1' }) },
    { source: 'ga4', collect: (day, _latest, runId) => collectRemoteSource('ga4', day, runId) },
];
export async function runPromotionDaily(store: PromotionStore, adapters = defaultAdapters(), day = kstDay()) {
    if (day !== kstDay()) throw new Error('promotion_day_mismatch');
    const id = randomUUID();
    if (!await store.claim(day, id)) return { status: 'skipped', day };
    const latest = new Map((await store.latest()).map(row => [row.source, row.payload]));
    for (const source of PROMOTION_SOURCES) {
        const adapter = adapters.find(item => item.source === source);
        let result: SourceResult;
        try {
            result = adapter ? await adapter.collect(day, latest, id)
                : { source, outcome: 'unsupported', reason: 'adapter_unavailable', observedAt: new Date().toISOString(), posts: [] };
            if (result.source !== source) throw new Error('adapter_contract');
        } catch (error) { result = { source, outcome: 'failed', reason: safeReason(error), observedAt: new Date().toISOString(), posts: [] }; }
        const merged = mergeLatest(latest.get(source), result);
        await store.save(day, id, result, merged); latest.set(source, merged);
    }
    return { status: await store.finish(day, id), day };
}
