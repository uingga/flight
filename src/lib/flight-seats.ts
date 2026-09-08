/** Unknown inventory is not zero. Only non-negative whole counts are authoritative. */
export function parseSeatCount(value: unknown): number | undefined {
    if (typeof value === 'string') {
        const match = value.trim().match(/^(\d+)\s*(?:석)?$/);
        if (!match) return undefined;
        value = Number(match[1]);
    }
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value : undefined;
}

type SeatFields = { availableSeats?: unknown; seats?: unknown };

export function resolveFlightSeats(flight: SeatFields) {
    const numeric = parseSeatCount(flight.availableSeats);
    const text = parseSeatCount(flight.seats);
    // A positive or stale field must never override an explicit zero in the other field.
    const count = numeric === undefined ? text : text === undefined ? numeric : Math.min(numeric, text);
    return {
        count,
        soldOut: count === 0,
        conflict: numeric !== undefined && text !== undefined && numeric !== text,
    };
}

export function hasSellableSeats(flight: SeatFields): boolean {
    return !resolveFlightSeats(flight).soldOut;
}

/** Canonicalize known inventory without manufacturing a count for unknown inventory. */
export function normalizeFlightSeats<T extends SeatFields>(flight: T): T {
    const { count } = resolveFlightSeats(flight);
    return { ...flight, availableSeats: count, seats: count === undefined ? undefined : `${count}석` };
}

export function filterSeatAvailableFlights<T extends SeatFields>(flights: T[]): T[] {
    return flights.filter(hasSellableSeats).map(normalizeFlightSeats);
}
