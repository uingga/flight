import type { Flight } from '@/types/flight';
import { departureLabel, displayCity, effectivePrice } from './flight-static';
import { normalizeAirline } from './utils/flight-helpers';

export function hasCityComparison(city: string) {
    return ['다카마쓰', '마나도', '타이베이'].includes(displayCity(city));
}

/** Input is the existing visible, unexpired city inventory, never a second filter. */
export function buildCityComparison(flights: Flight[]) {
    const departures = new Map<string, Flight[]>();
    for (const flight of flights) {
        const label = departureLabel(flight);
        departures.set(label, [...(departures.get(label) || []), flight]);
    }
    return Array.from(departures.entries()).map(([departure, items]) => {
        const ordered = [...items].sort((a, b) => effectivePrice(a) - effectivePrice(b)
            || a.departure.date.localeCompare(b.departure.date) || a.id.localeCompare(b.id));
        const dates = Array.from(new Set(items.map(f => f.departure.date))).sort();
        return {
            departure, count: items.length, dateCount: dates.length,
            firstDate: dates[0], lastDate: dates[dates.length - 1],
            minPrice: effectivePrice(ordered[0]), cheapest: ordered[0],
            airlines: Array.from(new Set(items.map(f => normalizeAirline(f.airline || '') || f.airline).filter(Boolean))),
            sources: Array.from(new Set(items.map(f => f.source))),
            airports: Array.from(new Set(items.map(f => f.arrival.airport).filter(Boolean))),
        };
    }).sort((a, b) => a.minPrice - b.minPrice || a.departure.localeCompare(b.departure, 'ko'));
}

export function representativeCityFlights(flights: Flight[], limit: number) {
    const chosen = buildCityComparison(flights).map(row => row.cheapest);
    const ids = new Set(chosen.map(f => f.id));
    return [...chosen, ...flights.filter(f => !ids.has(f.id))].slice(0, limit);
}
