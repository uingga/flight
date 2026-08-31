import fs from 'fs';
import path from 'path';
import type { Flight } from '../src/types/flight';
import { buildLifecycleIdentity } from './lib/flight-lifecycle';

interface FlightCache {
    timestamp?: string;
    flights?: Flight[];
    sourceUpdatedAt?: Record<string, string>;
}

interface FlightDailyRow {
    snapshot_date: string;
    flight_key: string;
    flight_id: string;
    source: Flight['source'];
    departure_city: string;
    departure_airport: string | null;
    arrival_city: string;
    arrival_airport: string | null;
    departure_date: string | null;
    return_date: string | null;
    outbound_time: string | null;
    outbound_arrival_time: string | null;
    return_time: string | null;
    return_arrival_time: string | null;
    airline: string | null;
    flight_number: string | null;
    listed_price: number;
    effective_price: number;
    available_seats: number | null;
    region: string | null;
    first_seen: string | null;
    price_checked_at: string | null;
    cache_observed_at: string;
    updated_at: string;
}

interface RouteDailyRow {
    snapshot_date: string;
    route_key: string;
    source: string;
    departure_city: string;
    departure_airport: string | null;
    arrival_city: string;
    arrival_airport: string | null;
    min_listed_price: number;
    avg_listed_price: number;
    min_effective_price: number;
    avg_effective_price: number;
    flight_count: number;
    cache_observed_at: string;
    updated_at: string;
}

const ROOT = process.cwd();
const CACHE_PATH = path.join(ROOT, 'data', 'all-flights-cache.json');
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 250;

function cleanText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim();
    return cleaned || null;
}

function cleanDate(value: unknown): string | null {
    const match = String(value || '').match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if (!match) return null;
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function kstDate(value: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(value);
}

function safeIso(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedAirport(value: unknown): string | null {
    const cleaned = cleanText(value)?.toUpperCase() || null;
    return cleaned && /^[A-Z0-9]{3,4}$/.test(cleaned) ? cleaned : null;
}

function effectivePrice(flight: Flight): number {
    return Math.round(Number(flight.price) + (flight.source === 'ttang' ? 20_000 : 0));
}

function routeKey(flight: Flight): string {
    const departure = normalizedAirport(flight.routeAirports?.outboundDeparture)
        || normalizedAirport(flight.departure?.airport)
        || cleanText(flight.departure?.city)
        || 'UNKNOWN';
    const arrival = normalizedAirport(flight.routeAirports?.outboundArrival)
        || normalizedAirport(flight.arrival?.airport)
        || cleanText(flight.arrival?.city)
        || 'UNKNOWN';
    return `${departure}-${arrival}`;
}

function stableFlightKey(flight: Flight): string {
    // 일부 여행사는 항공권 ID에 가격을 포함한다. 생애 기록기와 같은 안정적인
    // 판매 회차 키를 써야 가격 변경이 별도 항공권으로 중복 집계되지 않는다.
    return buildLifecycleIdentity(flight).offerKey;
}

function loadCache(): FlightCache {
    const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as FlightCache | Flight[];
    return Array.isArray(parsed) ? { flights: parsed } : parsed;
}

function buildRows(cache: FlightCache, now = new Date()): { flights: FlightDailyRow[]; routes: RouteDailyRow[] } {
    const observedAt = safeIso(cache.timestamp) || now.toISOString();
    const snapshotDate = kstDate(new Date(observedAt));
    const updatedAt = now.toISOString();
    const flightRows = (cache.flights || [])
        .filter(flight => Number.isFinite(Number(flight.price)) && Number(flight.price) > 0)
        .map((flight): FlightDailyRow => ({
            snapshot_date: snapshotDate,
            flight_key: stableFlightKey(flight),
            flight_id: cleanText(flight.id) || stableFlightKey(flight),
            source: flight.source,
            departure_city: cleanText(flight.departure?.city) || '알 수 없음',
            departure_airport: normalizedAirport(flight.routeAirports?.outboundDeparture)
                || normalizedAirport(flight.departure?.airport),
            arrival_city: cleanText(flight.arrival?.city) || '알 수 없음',
            arrival_airport: normalizedAirport(flight.routeAirports?.outboundArrival)
                || normalizedAirport(flight.arrival?.airport),
            departure_date: cleanDate(flight.departure?.date),
            return_date: cleanDate(flight.arrival?.date),
            outbound_time: cleanText(flight.departure?.time),
            outbound_arrival_time: cleanText(flight.departure?.arrivalTime),
            return_time: cleanText(flight.arrival?.time),
            return_arrival_time: cleanText(flight.arrival?.arrivalTime),
            airline: cleanText(flight.airline),
            flight_number: cleanText(flight.flightNumber),
            listed_price: Math.round(Number(flight.price)),
            effective_price: effectivePrice(flight),
            available_seats: flight.availableSeats !== null
                && flight.availableSeats !== undefined
                && Number.isFinite(Number(flight.availableSeats))
                ? Math.max(0, Math.round(Number(flight.availableSeats)))
                : null,
            region: cleanText(flight.region),
            first_seen: cleanDate(flight.firstSeen),
            price_checked_at: safeIso(flight.priceCheckedAt)
                || safeIso(cache.sourceUpdatedAt?.[flight.source])
                || observedAt,
            cache_observed_at: observedAt,
            updated_at: updatedAt,
        }));
    // 같은 상품이 캐시에 중복되어도 한 번의 upsert 요청 안에서 기본키가
    // 충돌하지 않도록 일별 항공권 키 기준으로 마지막 관측값만 남긴다.
    const flights = [...new Map(flightRows.map(row => [row.flight_key, row])).values()];

    const grouped = new Map<string, FlightDailyRow[]>();
    for (const row of flights) {
        const key = `${row.departure_airport || row.departure_city}-${row.arrival_airport || row.arrival_city}`;
        for (const source of ['all', row.source]) {
            const groupKey = `${key}|${source}`;
            const rows = grouped.get(groupKey) || [];
            rows.push(row);
            grouped.set(groupKey, rows);
        }
    }

    const routes = [...grouped.entries()].map(([groupKey, rows]): RouteDailyRow => {
        const source = groupKey.slice(groupKey.lastIndexOf('|') + 1);
        const first = rows[0];
        const listed = rows.map(row => row.listed_price);
        const effective = rows.map(row => row.effective_price);
        return {
            snapshot_date: snapshotDate,
            route_key: groupKey.slice(0, groupKey.lastIndexOf('|')),
            source,
            departure_city: first.departure_city,
            departure_airport: first.departure_airport,
            arrival_city: first.arrival_city,
            arrival_airport: first.arrival_airport,
            min_listed_price: Math.min(...listed),
            avg_listed_price: Math.round(listed.reduce((sum, price) => sum + price, 0) / listed.length),
            min_effective_price: Math.min(...effective),
            avg_effective_price: Math.round(effective.reduce((sum, price) => sum + price, 0) / effective.length),
            flight_count: rows.length,
            cache_observed_at: observedAt,
            updated_at: updatedAt,
        };
    });

    return { flights, routes };
}

async function upsertRows(table: string, conflict: string, rows: unknown[]): Promise<void> {
    const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다.');

    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
        const batch = rows.slice(start, start + BATCH_SIZE);
        const response = await fetch(`${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates,return=minimal',
            },
            body: JSON.stringify(batch),
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 500);
            throw new Error(`${table} 저장 실패 (${response.status}): ${detail}`);
        }
        console.log(`  ${table}: ${Math.min(start + BATCH_SIZE, rows.length)}/${rows.length}`);
    }
}

async function main(): Promise<void> {
    const cache = loadCache();
    const rows = buildRows(cache);
    if (rows.flights.length === 0) throw new Error('저장할 항공권이 없습니다.');

    console.log(`장기 가격 기록: ${rows.flights[0].snapshot_date}`);
    console.log(`  항공권 ${rows.flights.length}건 / 노선 요약 ${rows.routes.length}건`);
    if (DRY_RUN) {
        console.log('  DRY_RUN: Supabase에는 저장하지 않았습니다.');
        return;
    }

    await upsertRows('flight_price_daily', 'snapshot_date,flight_key', rows.flights);
    await upsertRows('route_price_daily', 'snapshot_date,route_key,source', rows.routes);
    console.log('장기 가격 기록 저장 완료');
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
