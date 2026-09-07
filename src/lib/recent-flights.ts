import type { Flight } from '@/types/flight';

export interface RecentFlight { flight: Flight; viewedAt: string }
export const RECENT_FLIGHTS_KEY = 'tikitikit_recent_flights_v1';
export const RECENT_FLIGHTS_LIMIT = 10;
const RETENTION_MS = 30 * 86400000;
const SOURCES = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip'];

// Do not substitute another agency, itinerary or airport when reopening a viewed ticket.
// MRT IDs can include price, so use its itinerary rather than a price-sensitive ID.
export function recentFlightKey(f: Flight): string {
    return JSON.stringify([
        f.source, f.source === 'myrealtrip' ? null : f.id, f.airline, f.flightNumber || '', f.currency,
        f.routeAirports?.outboundDeparture || f.departure.airport,
        f.routeAirports?.outboundArrival || f.arrival.airport,
        f.routeAirports?.returnDeparture || f.arrival.airport,
        f.routeAirports?.returnArrival || f.departure.airport,
        f.departure.date, f.departure.time, f.departure.arrivalTime || '',
        f.arrival.date, f.arrival.time, f.arrival.arrivalTime || '',
    ]);
}

// Keep only display/matching data, never a persisted booking URL or arbitrary payload.
export function recentFlightSnapshot(f: Flight): Flight {
    return {
        id: f.id, source: f.source, airline: f.airline, currency: f.currency, price: f.price, link: '',
        departure: { ...f.departure }, arrival: { ...f.arrival },
        flightNumber: f.flightNumber,
        routeAirports: f.routeAirports ? { ...f.routeAirports } : undefined,
    };
}

export function parseRecentFlights(raw: string | null, now = Date.now()): RecentFlight[] {
    try {
        if (!raw || raw.length > 100000) return [];
        const items: unknown = JSON.parse(raw);
        if (!Array.isArray(items)) return [];
        const valid = items.filter((item): item is RecentFlight => {
            const f = item?.flight;
            const age = now - Date.parse(item?.viewedAt);
            return f && typeof item.viewedAt === 'string' && Number.isFinite(age) && age >= 0 && age < RETENTION_MS
                && typeof f.id === 'string' && f.id.length < 500 && SOURCES.includes(f.source)
                && typeof f.airline === 'string' && typeof f.currency === 'string'
                && Number.isFinite(f.price) && f.price > 0
                && ['city', 'airport', 'date', 'time'].every(k => typeof f.departure?.[k] === 'string' && typeof f.arrival?.[k] === 'string')
                && Number.isFinite(Date.parse(f.departure.date)) && Number.isFinite(Date.parse(f.arrival.date));
        }).sort((a, b) => Date.parse(b.viewedAt) - Date.parse(a.viewedAt));
        const seen = new Set<string>();
        return valid.filter(item => {
            const key = recentFlightKey(item.flight);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, RECENT_FLIGHTS_LIMIT).map(item => ({ flight: recentFlightSnapshot(item.flight), viewedAt: item.viewedAt }));
    } catch { return []; }
}

export function rememberFlight(records: RecentFlight[], flight: Flight, now = Date.now()): RecentFlight[] {
    return [
        { flight: recentFlightSnapshot(flight), viewedAt: new Date(now).toISOString() },
        ...parseRecentFlights(JSON.stringify(records), now).filter(item => recentFlightKey(item.flight) !== recentFlightKey(flight)),
    ].slice(0, RECENT_FLIGHTS_LIMIT);
}

export function findRecentFlight(record: RecentFlight, flights: Flight[]): Flight | undefined {
    const matches = flights.filter(flight => recentFlightKey(flight) === recentFlightKey(record.flight));
    return matches.length === 1 ? matches[0] : undefined;
}
