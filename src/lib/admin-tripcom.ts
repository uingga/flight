import type { Flight } from '@/types/flight';
import type { SourceSlotEvent } from '@/lib/admin-source-slots';

const TRIPCOM_HISTORY_LIMIT = 60;

export interface TripcomAdminRun {
    runId: string;
    host: 'B' | 'C' | 'BC' | null;
    status: 'collected' | 'partial' | 'blocked_preserved';
    verifiedCities: number | null;
    unconfirmedCities: number | null;
}

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
    lastRun: TripcomAdminRun | null;
    runs: TripcomAdminRun[];
}

function validTime(value: unknown): string | null {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function nonnegativeCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function readRun(value: unknown): TripcomAdminRun | null {
    const run = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    if (typeof run?.runId !== 'string'
        || (run.status !== 'collected' && run.status !== 'partial' && run.status !== 'blocked_preserved')) return null;
    return {
        runId: run.runId,
        host: run.host === 'B' || run.host === 'C' || run.host === 'BC' ? run.host : null,
        status: run.status,
        verifiedCities: nonnegativeCount(run.verifiedCities),
        unconfirmedCities: nonnegativeCount(run.unconfirmedCities),
    };
}

export function tripcomRunSlotEvents(snapshot: TripcomAdminSnapshot | undefined): SourceSlotEvent[] {
    return (snapshot?.runs || []).filter(run => run.verifiedCities !== null).map(run => ({
        timestamp: run.runId,
        value: run.verifiedCities!,
        countKind: 'verified',
        reason: run.status === 'partial' ? `미확인 ${run.unconfirmedCities ?? '—'}곳` : undefined,
        partial: run.status === 'partial',
        preserved: run.status === 'blocked_preserved',
        skipped: false,
        manual: false,
        localFallback: false,
        host: run.host || undefined,
    }));
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
    const primary = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    const lastRun = readRun(primary);
    const distinct = new Map<string, TripcomAdminRun>();
    for (const value of [...(Array.isArray(primary?.history) ? primary.history : []), primary]) {
        const run = readRun(value);
        if (run && validTime(run.runId)) distinct.set(`${run.runId}|${run.host}`, run);
    }
    const runs = Array.from(distinct.values())
        .sort((a, b) => Date.parse(a.runId) - Date.parse(b.runId))
        .slice(-TRIPCOM_HISTORY_LIMIT);

    return { offers, lastPriceCheckedAt, lastRun, runs };
}
