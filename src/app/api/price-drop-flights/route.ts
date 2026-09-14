import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { loadActiveFlights } from '@/lib/flight-static';
import { hasSupabaseServerConfig, supabaseRest } from '@/lib/server/supabase-rest';
import { matchPriceDrop, priceDropDay, type HistoricalFlightPrice } from '@/lib/price-drop-insight';
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
    if (!hasSupabaseServerConfig()) return NextResponse.json({ available: false, records: [] });
    try {
        const now = Date.now();
        const today = priceDropDay(now);
        const rows = await loadHistory(today);
        const byOffer = new Map<string, HistoricalFlightPrice[]>();
        for (const row of rows) byOffer.set(row.flight_key, [...(byOffer.get(row.flight_key) || []), row]);
        const records = loadActiveFlights().flatMap(flight => {
            const key = buildLifecycleIdentity(flight).offerKey;
            const record = matchPriceDrop(flight, key, byOffer.get(key) || [], now);
            return record ? [record] : [];
        });
        return NextResponse.json({ available: true, asOf: today, records }, {
            headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
        });
    } catch {
        // Never substitute examples, route averages or stale discounts after a read failure.
        console.error('Price-drop insight history unavailable');
        return NextResponse.json({ available: false, records: [] });
    }
}
