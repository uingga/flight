import type { Flight } from '../types/flight';
import { buildRecommendationPresentation, buildRecommendationScoreState, compareRecommendedFlights, type InterparkPrices, type RecommendationPriceHistory } from './flight-recommendation';

export const MAX_MANUAL_PLACEMENTS = 30;
export interface FlightPlacement { key: string; position: number }
export interface ManualFlightOrder { revision: number; placements: FlightPlacement[]; updatedAt: string | null }
export const emptyFlightOrder = (): ManualFlightOrder => ({ revision: 0, placements: [], updatedAt: null });

export function parsePlacements(value: unknown): FlightPlacement[] {
    if (!Array.isArray(value) || value.length > MAX_MANUAL_PLACEMENTS) throw new Error('직접 배치는 최대 30개까지 가능합니다.');
    const keys = new Set<string>();
    const positions = new Set<number>();
    return value.map(item => {
        if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['key', 'position'].includes(key))
            || typeof item.key !== 'string' || !/^v1:[a-f0-9]{64}:[a-f0-9]{64}$/.test(item.key)
            || !Number.isInteger(item.position) || item.position < 1 || item.position > 10000
            || keys.has(item.key) || positions.has(item.position)) throw new Error('배치 정보가 올바르지 않습니다. 목록을 새로 불러와 주세요.');
        keys.add(item.key);
        positions.add(item.position);
        return { key: item.key, position: item.position };
    });
}

/** Reorder only the eligible input objects. Missing or ambiguous identities never add a flight. */
export function applyManualFlightOrder<T extends Flight>(
    automatic: T[], placements: FlightPlacement[], options: { sort?: string; pinnedId?: string | null } = {},
): T[] {
    if ((options.sort && options.sort !== 'recommended') || !placements.length) return automatic;
    const pinned = options.pinnedId ? automatic.find(flight => flight.id === options.pinnedId) : undefined;
    const pool = automatic.filter(flight => flight !== pinned);
    const matches = new Map<string, T[]>();
    for (const flight of pool) {
        if (flight.manualOrderKey) matches.set(flight.manualOrderKey, [...(matches.get(flight.manualOrderKey) || []), flight]);
    }
    const active = [...placements].sort((a, b) => a.position - b.position)
        .map(placement => ({ ...placement, flight: matches.get(placement.key) }))
        .filter(item => item.flight?.length === 1);
    const moved = new Set(active.map(item => item.flight![0]));
    const rest = pool.filter(flight => !moved.has(flight));
    const result: T[] = [];
    for (const item of active) {
        while (result.length < item.position - 1 && rest.length) result.push(rest.shift()!);
        result.push(item.flight![0]);
    }
    result.push(...rest);
    return pinned ? [pinned, ...result] : result;
}

/** Save only cards explicitly moved; keep other manual cards at their newly visible positions. */
export function moveFlightPlacement(automatic: Flight[], placements: FlightPlacement[], key: string, target: number): FlightPlacement[] {
    const current = [...applyManualFlightOrder(automatic, placements)];
    const source = current.findIndex(flight => flight.manualOrderKey === key);
    if (source < 0 || current.filter(flight => flight.manualOrderKey === key).length !== 1) return placements;
    const destination = Math.max(0, Math.min(current.length - 1, target));
    if (source === destination) return placements;
    const moved = current.splice(source, 1)[0];
    current.splice(destination, 0, moved);
    const selected = new Set([...placements.map(item => item.key), key]);
    // Keep unavailable placements for future healthy cache recovery.
    const next = placements.filter(item => !current.some(flight => flight.manualOrderKey === item.key));
    current.forEach((flight, index) => {
        if (flight.manualOrderKey && selected.has(flight.manualOrderKey)) next.push({ key: flight.manualOrderKey, position: index + 1 });
    });
    // Unavailable saved slots may now collide with an edited slot. Move only their dormant slot forward.
    const used = new Set<number>();
    const active = next.filter(item => current.some(flight => flight.manualOrderKey === item.key));
    active.forEach(item => used.add(item.position));
    const dormant = next.filter(item => !current.some(flight => flight.manualOrderKey === item.key)).map(item => {
        let position = item.position;
        while (used.has(position)) position++;
        used.add(position);
        return { ...item, position };
    });
    return parsePlacements([...active, ...dormant]);
}

export function automaticRecommendationList(flights: Flight[], interparkPrices: InterparkPrices, history: RecommendationPriceHistory, pinnedId?: string | null, now = Date.now()) {
    const state = buildRecommendationScoreState(flights, interparkPrices, now, history);
    const ranked = [...flights].sort((a, b) => compareRecommendedFlights(a, b, state.scores, now, state.explanations));
    const pinned = ranked.find(flight => flight.id === pinnedId);
    const presentation = buildRecommendationPresentation(ranked, state, { pinnedFlight: pinned, balanceIncheon: true, now });
    return pinned ? [pinned, ...presentation.orderedFlights] : presentation.orderedFlights;
}
