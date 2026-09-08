import type { Flight } from '@/types/flight';
import { normalizeCity } from '@/lib/utils/flight-helpers';

export type SharedFlightContext = { departure: string; arrival: string; price: number };
export const sharedCity = (value: string) => normalizeCity(value).replace(/\([^)]*\)/g, '').trim();

export function sharedDeparture(value: string): string {
    if (/인천|김포|서울|ICN|GMP|SEL/i.test(value)) return '인천/김포';
    if (/부산|김해|PUS/i.test(value)) return '부산/김해';
    return sharedCity(value);
}

export const flightScheduleToken = (flight: Flight) => [
    flight.departure.date, flight.departure.time, flight.arrival.date, flight.arrival.time,
].join('|');

export function findSharedFlight(flights: Flight[], id: string, schedule: string | null) {
    return flights.find(flight => flight.id === id && (!schedule || flightScheduleToken(flight) === schedule));
}

export function readSharedContext(params: URLSearchParams): SharedFlightContext | null {
    if (params.get('shared') !== '1') return null;
    const departure = params.get('shareDep');
    const arrival = params.get('shareArr');
    const price = Number(params.get('sharePrice'));
    return departure && arrival && Number.isFinite(price) && price > 0
        ? { departure, arrival, price } : null;
}

export function writeSharedContext(params: URLSearchParams, context: SharedFlightContext) {
    params.set('shared', '1');
    params.set('shareDep', context.departure);
    params.set('shareArr', context.arrival);
    params.set('sharePrice', String(context.price));
}

/** A stable partition after all normal/manual ordering; no price cap or date filter. */
export function prioritizeSharedPrice(flights: Flight[], price: number, priceOf: (flight: Flight) => number) {
    return [...flights.filter(flight => priceOf(flight) === price),
        ...flights.filter(flight => priceOf(flight) !== price)];
}
