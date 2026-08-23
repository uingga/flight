import 'server-only';

import fs from 'fs';
import path from 'path';
import type { Flight } from '@/types/flight';

export interface AccountFlightSnapshot {
    id: string;
    source: Flight['source'];
    airline: string;
    departureCity: string;
    departureAirport: string;
    departureDate: string;
    departureTime: string;
    arrivalCity: string;
    arrivalAirport: string;
    returnDate: string;
    returnTime: string;
    price: number;
    availableSeats?: number;
}

let cache: { mtimeMs: number; flights: Map<string, Flight> } | null = null;

function getFlightMap() {
    const cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
    const stat = fs.statSync(cachePath);
    if (cache?.mtimeMs === stat.mtimeMs) return cache.flights;
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as { flights?: Flight[] };
    const flights = new Map((parsed.flights || []).map(flight => [flight.id, flight]));
    cache = { mtimeMs: stat.mtimeMs, flights };
    return flights;
}

export function getAccountFlightSnapshot(flightId: string): AccountFlightSnapshot | null {
    const flight = getFlightMap().get(flightId);
    if (!flight) return null;
    return {
        id: flight.id,
        source: flight.source,
        airline: flight.airline,
        departureCity: flight.departure.city,
        departureAirport: flight.departure.airport,
        departureDate: flight.departure.date,
        departureTime: flight.departure.time,
        arrivalCity: flight.arrival.city,
        arrivalAirport: flight.arrival.airport,
        returnDate: flight.arrival.date,
        returnTime: flight.arrival.time,
        price: flight.price,
        ...(flight.availableSeats != null ? { availableSeats: flight.availableSeats } : {}),
    };
}
