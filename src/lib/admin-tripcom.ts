import type { Flight } from '@/types/flight';

export interface TripcomAdminOffer {
    id: string;
    departure: string;
    arrival: string;
    departureDate: string;
    returnDate: string;
    airline: string;
    price: number;
    priceCheckedAt: string | null;
    seats: string | null;
}

export interface TripcomAdminSnapshot {
    offers: TripcomAdminOffer[];
    lastPriceCheckedAt: string | null;
    lastRun: {
        runId: string;
        host: 'B' | 'C' | null;
        status: 'collected' | 'partial' | 'blocked_preserved';
        verifiedCities: number | null;
        unconfirmedCities: number | null;
    } | null;
}

function validTime(value: unknown): string | null {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function nonnegativeCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function buildTripcomAdminSnapshot(cache: {
    flights?: Flight[];
    sourceUpdatedAt?: Record<string, string>;
    tripcomPrimary?: unknown;
}): TripcomAdminSnapshot {
    const offers = (cache.flights || [])
        .filter(flight => flight.source === 'tripcom')
        .map(flight => ({
            id: flight.id,
            departure: flight.departure?.city || '알 수 없음',
            arrival: flight.arrival?.city || '알 수 없음',
            departureDate: flight.departure?.date || '',
            returnDate: flight.arrival?.date || '',
            airline: flight.airline || '알 수 없음',
            price: flight.price,
            priceCheckedAt: validTime(flight.priceCheckedAt),
            seats: flight.seats || (flight.availableSeats != null ? `${flight.availableSeats}석` : null),
        }))
        .sort((a, b) => (Date.parse(b.priceCheckedAt || '') || 0) - (Date.parse(a.priceCheckedAt || '') || 0));

    const lastPriceCheckedAt = [validTime(cache.sourceUpdatedAt?.tripcom), ...offers.map(offer => offer.priceCheckedAt)]
        .filter((value): value is string => value !== null)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;

    const raw = cache.tripcomPrimary;
    const run = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const status = run?.status;
    const lastRun: TripcomAdminSnapshot['lastRun'] = run && typeof run.runId === 'string'
        && (status === 'collected' || status === 'partial' || status === 'blocked_preserved')
        ? {
            runId: run.runId,
            host: run.host === 'B' || run.host === 'C' ? run.host : null,
            status,
            verifiedCities: nonnegativeCount(run.verifiedCities),
            unconfirmedCities: nonnegativeCount(run.unconfirmedCities),
        } : null;

    return { offers, lastPriceCheckedAt, lastRun };
}
