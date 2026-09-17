import type { Flight } from '../types/flight';
import { getEffectivePrice } from './price-quality';

export interface RecommendationNews {
    firstSeenAt: string;
    observedAt: string;
    price: number;
    lowestPrice: number;
    drop?: { at: string; from: number; to: number };
}

export function discoveryTimestamp(value?: string): number {
    const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value || '')
        ? `${value}T00:00:00+09:00` : value || '');
    return Number.isFinite(timestamp) ? timestamp : 0;
}

/** An event order, not an elapsed-time bonus. Rechecking does not change it. */
export function recommendationNewsTimestamp(flight: Flight): number {
    const news = flight.recommendationNews;
    const first = discoveryTimestamp(news?.firstSeenAt || flight.firstSeen);
    const drop = news?.drop;
    if (!drop || getEffectivePrice(flight) !== drop.to || news?.price !== drop.to
        || drop.from - drop.to < 10_000 || (drop.from - drop.to) / drop.from < 0.05) return first;
    return Math.max(first, discoveryTimestamp(drop.at));
}
