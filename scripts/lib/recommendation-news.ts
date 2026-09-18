import type { Flight } from '../../src/types/flight';
import { getEffectivePrice } from '../../src/lib/price-quality';
import { discoveryTimestamp, type RecommendationNews } from '../../src/lib/recommendation-news';
import { buildLifecycleIdentity } from './flight-lifecycle';
import {modetourHistory} from '../../src/lib/modetour-history';
import {modetourOfferKey,restoreModetourOffers} from '../../src/lib/modetour-offer-history.mjs';

/** Pure source-observation transform. No requests, scheduling or storage side effects. */
export function recordRecommendationNews(previous: Flight[], next: Flight[], observedAt: string, retainedHistory?: object): Flight[] {
    const observed = Date.parse(observedAt);
    if (!Number.isFinite(observed)) throw new Error('Invalid recommendation observation time');
    const key = (f: Flight) => {
        const identity = buildLifecycleIdentity(f);
        return `${identity.offerKey}|${identity.itineraryKey}`;
    };
    const retained: any=retainedHistory ?? modetourHistory({});
    const before = new Map(restoreModetourOffers(previous,retained).map((f: Flight) => [key(f), f]));
    return next.map(flight => {
        const saved=retained[modetourOfferKey(flight) || ''];
        const old: Flight | undefined = before.get(key(flight)) || (saved ? {...flight,price:saved.news.price,firstSeen:saved.firstSeen,recommendationNews:saved.news} : undefined);
        const prior = old?.recommendationNews;
        const price = getEffectivePrice(flight);
        if (!Number.isFinite(price) || price <= 0) return flight;
        if (prior && observed <= Date.parse(prior.observedAt)) {
            return { ...flight, firstSeen:old?.firstSeen || flight.firstSeen, recommendationNews: prior };
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
        return { ...flight, firstSeen:old?.firstSeen || flight.firstSeen, recommendationNews: news };
    });
}
