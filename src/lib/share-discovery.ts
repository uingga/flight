import type { Flight } from '@/types/flight';
import { sharedCity, sharedDeparture } from './shared-flight-context';
import { resolveFlightSeats } from './flight-seats';

export const discoveryIdentity = (flight: Flight) => [
    flight.departure.airport || sharedCity(flight.departure.city),
    flight.arrival.airport || sharedCity(flight.arrival.city),
    flight.departure.date.slice(0, 10), flight.arrival.date.slice(0, 10), flight.departure.time, flight.arrival.time,
].join('|');

/** Input is the public API's filtered inventory, never raw crawl results. */
export function selectShareDiscovery(flights: Flight[], selected: Flight,
    compare: (a: Flight, b: Flight) => number, now = new Date()) {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
    const candidates = flights.filter(flight => flight.id !== selected.id
        && flight.departure.date > today && flight.arrival.date >= flight.departure.date
        && Number.isFinite(flight.price) && flight.price > 0 && !resolveFlightSeats(flight).soldOut
        && sharedDeparture(flight.departure.city) === sharedDeparture(selected.departure.city)
        && discoveryIdentity(flight) !== discoveryIdentity(selected)).sort(compare);
    const sameDates = new Set<string>();
    const otherCities = new Set<string>();
    const sameDestination: Flight[] = [];
    const otherDestinations: Flight[] = [];
    for (const flight of candidates) {
        const city = sharedCity(flight.arrival.city);
        if (city === sharedCity(selected.arrival.city)) {
            const dates = `${flight.departure.date.slice(0, 10)}|${flight.arrival.date.slice(0, 10)}`;
            if (dates === `${selected.departure.date.slice(0, 10)}|${selected.arrival.date.slice(0, 10)}` || sameDates.has(dates)) continue;
            sameDates.add(dates);
            if (sameDestination.length < 2) sameDestination.push(flight);
        } else if (!otherCities.has(city)) {
            otherCities.add(city);
            if (otherDestinations.length < 3) otherDestinations.push(flight);
        }
    }
    return { sameDestination, otherDestinations };
}
