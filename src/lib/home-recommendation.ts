import type { Flight } from '@/types/flight';
import { buildRecommendationScoreState, buildRecommendationPresentation, compareRecommendedFlights, type InterparkPrices, type RecommendationPriceHistory } from './flight-recommendation';
import { applyManualFlightOrder, type FlightPlacement } from './manual-flight-order';

/** Shared by the server's first cards and the hydrated default feed. */
export function homeRecommendation(flights: Flight[], prices: InterparkPrices, history: RecommendationPriceHistory, options: { now?: number; pinnedId?: string | null; placements?: FlightPlacement[] } = {}) {
    const now = options.now ?? Date.now();
    // Pairwise route preference needs a canonical input, independent of cache/API order.
    const candidates = [...flights].sort((a,b) => a.price-b.price || a.id.localeCompare(b.id) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const state = buildRecommendationScoreState(candidates, prices, now, history);
    const ranked = candidates.sort((a,b) => compareRecommendedFlights(a,b,state.scores,now,state.explanations));
    const pinned = ranked.find(f => f.id === options.pinnedId);
    const presentation = buildRecommendationPresentation(ranked,state,{now,pinnedFlight:pinned,balanceIncheon:true});
    return applyManualFlightOrder(pinned ? [pinned,...presentation.orderedFlights] : presentation.orderedFlights,options.placements || [],{sort:'recommended',pinnedId:pinned?.id});
}
