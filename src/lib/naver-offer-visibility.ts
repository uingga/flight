import type { Flight } from '../types/flight';
import { getRecommendationNaverComparison, type NaverComparisonEntry } from './naver-comparison';
import { isVerifiedMyrealtripOffer, selectMyrealtripNaverComparison } from './myrealtrip-naver-verification';
import { buildNaverPriceKey } from './naver-route';
import { isNaverPriceOverLimit } from './naver-price-filter';
import { getEffectivePrice } from './price-quality';

export function requiresNaverOfferVerification(source: string): boolean {
    return source === 'myrealtrip' || source === 'tripcom';
}

/** Public display only. Never apply this gate to crawl candidates or stored evidence. */
export function filterNaverVerifiedOffers<T extends Flight>(
    flights: T[],
    naverPrices: unknown,
    now = Date.now(),
): T[] {
    const prices = naverPrices && typeof naverPrices === 'object' && !Array.isArray(naverPrices)
        ? naverPrices as Record<string, NaverComparisonEntry> : null;
    return flights.flatMap(flight => {
        if (!requiresNaverOfferVerification(flight.source)) return [flight];
        if (!prices) return [];
        const key = buildNaverPriceKey(flight, flight.departure?.date, flight.arrival?.date);
        if (!key) return [];
        const comparison = selectMyrealtripNaverComparison(
            flight,
            getRecommendationNaverComparison(prices[key], now, flight.source),
            now,
        );
        if (!comparison) return [];
        // Do not trust cached/nearby comparisons, or mutate the collected fare.
        const verified = { ...flight, naverLowest: comparison.price, naverCheckedAt: comparison.checkedAt };
        if (!isVerifiedMyrealtripOffer(verified, now)
            || isNaverPriceOverLimit(getEffectivePrice(verified), comparison.price, verified.source)) return [];
        return [verified];
    });
}
