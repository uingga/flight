import type { Flight } from '../types/flight';
import observations from './myrealtrip-naver-observations.json';
import { buildNaverPriceKey } from './naver-route';
import { getRecommendationComparisonFreshness } from './price-quality';

interface Comparison {
    price: number;
    checkedAt: string;
}

const verified = new Map(observations.verified.map(record => [record.id, record]));
const reported = new Map(observations.reported.map(record => [record.id, record]));

/** Keep the newer of an exact manual observation and the coordinated Naver result. */
export function selectMyrealtripNaverComparison(
    flight: Flight,
    coordinated: Comparison | null,
    now = Date.now(),
): Comparison | null {
    if (flight.source !== 'myrealtrip') return coordinated;
    const record = verified.get(flight.id);
    if (!record || record.price !== flight.price
        || record.key !== buildNaverPriceKey(flight, flight.departure?.date, flight.arrival?.date)
        || !getRecommendationComparisonFreshness(record.observedAt, now).usable) return coordinated;
    if (coordinated && Date.parse(coordinated.checkedAt) > Date.parse(record.observedAt)) return coordinated;
    return { price: record.naverPrice, checkedAt: record.observedAt };
}

/** An MRT offer is displayable only after a usable exact comparison proves it is no dearer. */
export function isVerifiedMyrealtripOffer(
    flight: Pick<Flight, 'id' | 'source' | 'price' | 'departure' | 'arrival' | 'routeAirports' | 'naverLowest' | 'naverCheckedAt'>,
    now = Date.now(),
): boolean {
    if (flight.source !== 'myrealtrip') return true;
    if (!buildNaverPriceKey(flight, flight.departure?.date, flight.arrival?.date)
        || !Number.isFinite(flight.naverLowest) || !flight.naverLowest
        || flight.naverLowest <= 0 || !getRecommendationComparisonFreshness(flight.naverCheckedAt, now).usable) return false;
    // A reported contradiction needs an independent review. Repeating the same
    // collector is not enough to clear the exact fare that the user disputed.
    const flagged = reported.get(flight.id);
    if (flagged && flagged.price === flight.price) return false;
    return flight.price <= flight.naverLowest;
}
