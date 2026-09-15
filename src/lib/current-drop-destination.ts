import type { Flight } from '@/types/flight';
export function currentDropDestination(pick: { date?: string; flightId?: string | null }, flights: Flight[], now = Date.now()) {
    const day = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
    if (pick.date !== day || !pick.flightId || !flights.some(flight => flight.id === pick.flightId)) return null;
    return `/?${new URLSearchParams({ flight: pick.flightId }).toString()}`;
}
