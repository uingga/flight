import type { Flight } from '@/types/flight';

const DEFAULT_MYREALTRIP_MAX_AGE_HOURS = 24;

export function getMyrealtripFreshness(
    sourceUpdatedAt: Record<string, string> | undefined,
    nowMs = Date.now(),
) {
    const configuredHours = Number(process.env.MYREALTRIP_MAX_AGE_HOURS || DEFAULT_MYREALTRIP_MAX_AGE_HOURS);
    const maxAgeHours = Number.isFinite(configuredHours) && configuredHours > 0
        ? configuredHours
        : DEFAULT_MYREALTRIP_MAX_AGE_HOURS;
    const updatedMs = Date.parse(sourceUpdatedAt?.myrealtrip || '');
    const ageMs = nowMs - updatedMs;
    const fresh = Number.isFinite(updatedMs)
        && ageMs >= 0
        && ageMs <= maxAgeHours * 60 * 60 * 1000;

    return {
        fresh,
        maxAgeHours,
        ageHours: Number.isFinite(ageMs) ? ageMs / (60 * 60 * 1000) : null,
    };
}

export function filterStaleMyrealtripFlights<T extends Pick<Flight, 'source'>>(
    flights: T[],
    sourceUpdatedAt: Record<string, string> | undefined,
    nowMs = Date.now(),
): T[] {
    if (getMyrealtripFreshness(sourceUpdatedAt, nowMs).fresh) return flights;
    return flights.filter(flight => flight.source !== 'myrealtrip');
}
