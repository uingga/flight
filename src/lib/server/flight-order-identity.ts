import { buildLifecycleIdentity } from '../../../scripts/lib/flight-lifecycle';
import type { Flight } from '../../types/flight';

/** Existing lifecycle identity excludes price/seat count; itinerary also guards reused product IDs. */
export function flightOrderKey(flight: Flight): string {
    const identity = buildLifecycleIdentity(flight);
    return `v1:${identity.offerKey}:${identity.itineraryKey}`;
}
