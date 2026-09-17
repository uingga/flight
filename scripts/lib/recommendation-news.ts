import type { Flight } from '../../src/types/flight';
import { getEffectivePrice } from '../../src/lib/price-quality';
import { discoveryTimestamp, type RecommendationNews } from '../../src/lib/recommendation-news';
import { buildLifecycleIdentity } from './flight-lifecycle';

/** Pure source-observation transform. No requests, scheduling or storage side effects. */
export function recordRecommendationNews(previous: Flight[], next: Flight[], observedAt: string): Flight[] {
    const observed = Date.parse(observedAt);
    if (!Number.isFinite(observed)) throw new Error('Invalid recommendation observation time');
    const key = (f: Flight) => {
        const identity = buildLifecycleIdentity(f);
        return `${identity.offerKey}|${identity.itineraryKey}`;
    };
    const before = new Map(previous.map(f => [key(f), f]));
    return next.map(flight => {
        const old = before.get(key(flight));
        const prior = old?.recommendationNews;
        const price = getEffectivePrice(flight);
        if (!Number.isFinite(price) || price <= 0) return flight;
        if (prior && observed <= Date.parse(prior.observedAt)) {
            return { ...flight, recommendationNews: prior };
        }
        const previousPrice = old ? getEffectivePrice(old) : price;
        const floor = prior?.lowestPrice ?? previousPrice;
        const currentDay = new Date(observed + 9 * 3600000).toISOString().slice(0,10);
        const suppliedFirst = !old && flight.firstSeen === currentDay ? observed : discoveryTimestamp(old?.firstSeen || flight.firstSeen);
        const first = prior?.firstSeenAt || new Date(suppliedFirst
            || (old ? discoveryTimestamp(old.priceCheckedAt) : 0) || observed).toISOString();
        const news: RecommendationNews = {
            firstSeenAt: first, observedAt, price, lowestPrice: Math.min(floor, price),
        };
        if (prior?.drop && price === previousPrice && price === prior.drop.to) news.drop = prior.drop;
        // Require a new observed low to prevent an increase/reversal earning the same bonus again.
        if (old && price < floor && previousPrice - price >= 10_000
            && (previousPrice - price) / previousPrice >= 0.05) {
            news.drop = { at: observedAt, from: previousPrice, to: price };
        }
        return { ...flight, recommendationNews: news };
    });
}
