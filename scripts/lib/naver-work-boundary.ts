import { createNaverSelection } from './naver-selection';
import { buildNaverPriceKey } from '../../src/lib/naver-route';
import { createHash } from 'node:crypto';

// Pure selection is the extracted production selector, not a second scoring implementation.
export class NaverWorkBoundary {
    constructor(private dependencies: any) {}
    async refresh(snapshot: any, prices: any, limit: number) {
        const d = this.dependencies;
        const state = await d.client.workState(d.identity);
        if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < state.generation) throw Error('generation out of order');
        const snapshotSignature = snapshot.contentSignature || createHash('sha256').update(JSON.stringify(snapshot.flights)).digest('hex');
        if (snapshot.generation === state.generation && state.snapshotSignature !== snapshotSignature) throw Error('generation content mismatch');
        for (const [key, row] of Object.entries<any>(state.candidates)) {
            if (row.firstQueuedAt) prices[key] = { ...prices[key], firstQueuedAt: row.firstQueuedAt };
        }
        const unprocessed = snapshot.flights.filter((flight: any) => {
            const key = buildNaverPriceKey(flight, flight.departure.date, flight.arrival.date);
            return key && !Object.hasOwn(state.keys, key);
        });
        const select = createNaverSelection(d.selectionOptions);
        const remaining = Math.max(0, Math.min(limit, 200 - (state.used[d.identity.worker] || 0), 400 - state.used.A - state.used.C));
        const selected = select(unprocessed, prices, remaining);
        if (snapshot.generation > state.generation) await d.publisher.updateCandidates({ generation: snapshot.generation, snapshotSignature,
            candidates: selected.pending.map((flight: any) => {
                const key = buildNaverPriceKey(flight, flight.departure.date, flight.arrival.date)!;
                return { key, flight, firstQueuedAt: prices[key]?.firstQueuedAt };
            }) });
        return selected.selected;
    }
}
