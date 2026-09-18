import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { loadActiveFlights } from '@/lib/flight-static';
import { hasSupabaseServerConfig, supabaseRest, SupabaseRestError } from '@/lib/server/supabase-rest';
import { resolvePriceDrop, priceDropDay, type HistoricalFlightPrice } from '@/lib/price-drop-insight';
import { buildLifecycleIdentity } from '../../../../scripts/lib/flight-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const loadHistory = unstable_cache(async (today: string) => {
    const since = new Date(Date.parse(today) - 3 * 86400000).toISOString().slice(0, 10);
    const rows: HistoricalFlightPrice[] = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
        const params = new URLSearchParams({
            select: 'flight_key,snapshot_date,price_checked_at,source,departure_airport,arrival_airport,departure_date,return_date,outbound_time,return_time,airline,listed_price',
            and: `(snapshot_date.gte.${since},snapshot_date.lt.${today})`,
            departure_date: `gte.${today}`, order: 'snapshot_date.desc,flight_key.asc',
            limit: '1000', offset: String(offset),
        });
        const page = await supabaseRest<HistoricalFlightPrice[]>(`flight_price_daily?${params}`, { signal: AbortSignal.timeout(12000) });
        rows.push(...page);
        if (page.length < 1000) return rows;
    }
    throw new Error('Price history page limit exceeded');
}, ['price-drop-history-v1'], { revalidate: 300 });

export async function GET() {
    const now = Date.now();
    const today = priceDropDay(now);
    const flights = loadActiveFlights();
    const recorded = flights.flatMap(flight => {
        const record = resolvePriceDrop(flight, '', [], now);
        return record ? [record] : [];
    });
    // Locally retained observations remain valid if the separate daily archive is unavailable.
    const retainedResponse = () => NextResponse.json({ available: recorded.length > 0,
        historyAvailable: false, asOf: today, records: recorded });
    if (!hasSupabaseServerConfig()) return retainedResponse();
    try {
        const rows = await loadHistory(today);
        const byOffer = new Map<string, HistoricalFlightPrice[]>();
        for (const row of rows) byOffer.set(row.flight_key, [...(byOffer.get(row.flight_key) || []), row]);
        const records = flights.flatMap(flight => {
            const key = buildLifecycleIdentity(flight).offerKey;
            const record = resolvePriceDrop(flight, key, byOffer.get(key) || [], now);
            return record ? [record] : [];
        });
        return NextResponse.json({ available: true, historyAvailable: true, asOf: today, records }, {
            headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
        });
    } catch (error) {
        // Only independently verified retained events survive an archive read failure.
        console.error('Price-drop insight history unavailable', {
            type: error instanceof Error ? error.name : 'unknown',
            status: error instanceof SupabaseRestError ? error.status : undefined,
            // Only a fixed, non-sensitive diagnostic category is logged.
            pageLimit: error instanceof Error && error.message === 'Price history page limit exceeded',
        });
        return retainedResponse();
    }
}
