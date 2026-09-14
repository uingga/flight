import type { Flight } from '@/types/flight';

const scheduleKey = (flight: Flight) => [flight.departure.date, flight.departure.time, flight.arrival.date, flight.arrival.time].join('|');

/** Keep the hero's price and seller applicable to every displayed alternative. */
export function dropHeroAlternatives(flights: Flight[], selected: Flight, priceOf: (flight: Flight) => number): Flight[] {
    const price = priceOf(selected);
    const selectedKey = scheduleKey(selected);
    const choices = flights.filter(flight =>
        (flight.departure.airport || flight.departure.city) === (selected.departure.airport || selected.departure.city)
        && (flight.arrival.airport || flight.arrival.city) === (selected.arrival.airport || selected.arrival.city)
        && flight.source === selected.source
        && flight.airline === selected.airline
        && priceOf(flight) === price
        && scheduleKey(flight) !== selectedKey
    );
    return Array.from(new Map(choices.map(flight => [scheduleKey(flight), flight])).values())
        .sort((a, b) => scheduleKey(a).localeCompare(scheduleKey(b)));
}
