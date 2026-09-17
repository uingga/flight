import type { Flight } from '@/types/flight';
import { getEffectivePrice } from '@/lib/price-quality';

/** Use the visible sales inventory, not midnight, to retire a selected DROP. */
export function activeTodayPickId(pick: { date?: string; flightId?: string; effectivePrice?: number }, flights: Flight[], today: string): string | null {
    if (!pick.date || !/^\d{4}-\d{2}-\d{2}$/.test(pick.date) || pick.date > today) return null;
    const flight = flights.find(item => item.id === pick.flightId);
    if (!flight || flight.departure.date < today || !(pick.effectivePrice! > 0)) return null;
    return getEffectivePrice(flight) === pick.effectivePrice ? flight.id : null;
}
