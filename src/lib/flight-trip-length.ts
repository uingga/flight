import type { Flight } from '../types/flight';
import { calcFlightTiming } from './utils/flight-helpers';

const DAY = 86_400_000;
const KOREAN_AIRPORTS = new Set(['ICN', 'GMP', 'PUS', 'CJJ', 'TAE', 'CJU', 'MWX', 'YNY']);
export const TRIP_LENGTH_OPTIONS = [
    { value: 'short', label: '3일 이하' },
    { value: '4', label: '4일' },
    { value: '5', label: '5일' },
    { value: '6', label: '6일' },
    { value: 'long', label: '7일 이상' },
] as const;
export type TripLengthFilter = typeof TRIP_LENGTH_OPTIONS[number]['value'];

const dateNumber = (value: string): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
};

/** Calendar days away, including the return flight's arrival in Korea (not hotel nights). */
export function flightTripDays(flight: Flight): number | null {
    const start = dateNumber(flight.departure.date);
    const returning = dateNumber(flight.arrival.date);
    const homeAirport = flight.routeAirports?.returnArrival || flight.modetourDetail?.returnArrivalAirport || flight.departure.airport;
    if (start === null || returning === null || returning < start || !KOREAN_AIRPORTS.has(homeAirport)) return null;
    const detail = flight.modetourDetail;
    const depTime = detail?.returnDepartureTime || flight.arrival.time;
    const arrTime = detail?.returnArrivalTime || flight.arrival.arrivalTime;
    if (!depTime || !arrTime || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(depTime)
        || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(arrTime)) return null;
    const timing = calcFlightTiming(flight.arrival.city, depTime, flight.arrival.date, '인천', arrTime);
    if (!timing) return null;
    return (returning - start) / DAY + timing.arrivalDayOffset + 1;
}

export function formatFlightTripLength(flight: Flight): string | null {
    const days = flightTripDays(flight);
    return days === null ? null : `${days}일`;
}

export function parseTripLengthFilters(value: string | null): TripLengthFilter[] {
    const requested = new Set((value || '').split(','));
    return TRIP_LENGTH_OPTIONS.filter(option => requested.has(option.value)).map(option => option.value);
}

export function matchesTripLength(flight: Flight, selected: readonly TripLengthFilter[]): boolean {
    if (!selected.length) return true;
    const days = flightTripDays(flight);
    if (days === null) return false;
    return selected.some(value => value === 'short' ? days <= 3 : value === 'long' ? days >= 7 : days === Number(value));
}
