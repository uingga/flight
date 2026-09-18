import type { Flight } from '@/types/flight';
import { discoveryTimestamp } from './recommendation-news';
import { priceDropDay } from './price-drop-insight';

/** The earliest known discovery wins; becoming visible again does not reset it. */
export function firstDiscoveryDay(flight: Flight): string | null {
    const times = [flight.firstSeen, flight.recommendationNews?.firstSeenAt]
        .map(discoveryTimestamp).filter(time => time > 0);
    return times.length ? priceDropDay(Math.min(...times)) : null;
}

export function isFirstDiscoveredOn(flight: Flight, day: string): boolean {
    return firstDiscoveryDay(flight) === day;
}
