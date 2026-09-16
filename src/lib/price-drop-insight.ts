import type { Flight } from '@/types/flight';

export const MIN_PRICE_DROP_AMOUNT = 10000;

export interface PriceDropRecord {
    key: string;
    currentPrice: number;
    previousPrice: number;
    previousDate: string;
    daysAgo: number;
    amount: number;
}

export function priceDropKey(flight: Flight): string {
    return [flight.source, flight.id, flight.departure.date, flight.departure.time,
        flight.arrival.date, flight.arrival.time].join('|');
}

export function groupPriceDropFlights(
    flights: Flight[], records: Record<string, PriceDropRecord>,
    routeKey: (flight: Flight) => string, price: (flight: Flight) => number,
): { route: string; flights: Flight[]; representative: Flight }[] {
    const seen = new Set<string>();
    const routes = new Map<string, Flight[]>();
    for (const flight of flights) {
        const key = priceDropKey(flight);
        const record = records[key];
        if (seen.has(key) || !record || record.currentPrice !== price(flight)) continue;
        seen.add(key);
        const route = routeKey(flight);
        const schedules = routes.get(route) || [];
        schedules.push(flight);
        routes.set(route, schedules);
    }
    const compare = (a: Flight, b: Flight) => records[priceDropKey(b)].amount - records[priceDropKey(a)].amount
        || price(a) - price(b) || a.departure.date.localeCompare(b.departure.date)
        || priceDropKey(a).localeCompare(priceDropKey(b));
    return Array.from(routes, ([route, schedules]) => {
        schedules.sort(compare);
        return { route, flights: schedules, representative: schedules[0] };
    }).sort((a, b) => compare(a.representative, b.representative));
}

export function priceDropDay(date: number | string): string {
    return new Date(new Date(date).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

export function priceDropLabel(record: PriceDropRecord): string {
    return record.daysAgo === 1 ? '어제보다' : `${record.daysAgo}일 전보다`;
}

export function priceDropAmountLabel(amount: number): string {
    // Do not round a small decline up to a larger discount.
    return amount % 1000 === 0 ? `${amount / 10000}만원` : `${amount.toLocaleString('ko-KR')}원`;
}

export interface HistoricalFlightPrice {
    flight_key: string;
    snapshot_date: string;
    price_checked_at: string | null;
    source: string;
    departure_airport: string | null;
    arrival_airport: string | null;
    departure_date: string | null;
    return_date: string | null;
    outbound_time: string | null;
    return_time: string | null;
    airline: string | null;
    listed_price: number;
}

export function matchPriceDrop(flight: Flight, offerKey: string, rows: HistoricalFlightPrice[], now = Date.now()): PriceDropRecord | null {
    const today = priceDropDay(now);
    const dep = flight.routeAirports?.outboundDeparture || flight.departure.airport;
    const arr = flight.routeAirports?.outboundArrival || flight.arrival.airport;
    if (!dep || !arr || !flight.departure.time || !flight.arrival.time || !flight.airline
        || flight.departure.date < today || !Number.isFinite(flight.price) || flight.price <= 0) return null;
    const matches = rows.filter(row => {
        const days = (Date.parse(today) - Date.parse(row.snapshot_date)) / 86400000;
        const checked = Date.parse(row.price_checked_at || '');
        return row.flight_key === offerKey && row.source === flight.source
            && row.departure_airport === dep && row.arrival_airport === arr
            && row.departure_date === flight.departure.date && row.return_date === flight.arrival.date
            && row.outbound_time === flight.departure.time && row.return_time === flight.arrival.time
            && row.airline === flight.airline && Number.isInteger(days) && days >= 1 && days <= 3
            && Number.isFinite(checked) && priceDropDay(checked) === row.snapshot_date
            && Number.isFinite(Number(row.listed_price)) && Number(row.listed_price) > flight.price;
    }).sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
    const previous = matches[0];
    if (!previous || Number(previous.listed_price) - flight.price < MIN_PRICE_DROP_AMOUNT) return null;
    return { key: priceDropKey(flight), currentPrice: flight.price, previousPrice: Number(previous.listed_price),
        previousDate: previous.snapshot_date, daysAgo: (Date.parse(today) - Date.parse(previous.snapshot_date)) / 86400000,
        amount: Number(previous.listed_price) - flight.price };
}
