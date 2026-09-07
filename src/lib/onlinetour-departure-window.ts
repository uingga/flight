import type { Flight } from '../types/flight';

export interface DepartureWindow { from: string; through: string; }
const DAY = 86_400_000;
function dateValue(value: unknown): number {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('invalid_departure_window');
    const timestamp = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10) !== value) throw new Error('invalid_departure_window');
    return timestamp;
}
export function validateDepartureWindow(value: unknown): DepartureWindow {
    const window = value as DepartureWindow;
    if (!window || typeof window !== 'object' || Array.isArray(window)
        || Object.keys(window).sort().join(',') !== 'from,through') throw new Error('invalid_departure_window');
    const from = dateValue(window.from), through = dateValue(window.through);
    if (through < from || through - from > 60 * DAY) throw new Error('invalid_departure_window');
    return { from: window.from, through: window.through };
}
/** Inclusive departure boundaries: KST today through today + 60 calendar days. */
export function createDepartureWindow(now = Date.now()): DepartureWindow {
    if (!Number.isFinite(now)) throw new Error('invalid_departure_window');
    const from = new Date(now + 9 * 3600_000).toISOString().slice(0,10);
    return { from, through: new Date(dateValue(from) + 60 * DAY).toISOString().slice(0,10) };
}
export function eligibleDepartures(flights: Flight[], input: DepartureWindow): Flight[] {
    const window = validateDepartureWindow(input);
    return flights.filter(f => { dateValue(f.departure.date); return f.departure.date >= window.from && f.departure.date <= window.through; })
        .sort((a,b) => a.departure.date.localeCompare(b.departure.date) || a.price - b.price || a.id.localeCompare(b.id));
}
