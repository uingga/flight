import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const CACHE_FILE_PATH = path.join(process.cwd(), 'data', 'all-flights-cache.json');
const ADMIN_KEY = process.env.ADMIN_KEY || 'tikit2026';

interface Flight {
    id: string;
    source: string;
    airline: string;
    departure: { city: string; airport: string; date: string };
    arrival: { city: string; airport: string; date: string };
    price: number;
    currency: string;
    seats: string;
    region: string;
}

export async function GET(request: NextRequest) {
    const key = request.nextUrl.searchParams.get('key');

    if (key !== ADMIN_KEY) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        if (!fs.existsSync(CACHE_FILE_PATH)) {
            return NextResponse.json({ error: 'Cache file not found' }, { status: 404 });
        }

        const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
        const cache = JSON.parse(raw);
        const flights: Flight[] = cache.flights || [];
        const timestamp = cache.timestamp || new Date().toISOString();

        // 소스별 통계
        const bySource: Record<string, number> = {};
        const byRegion: Record<string, number> = {};
        const byCity: Record<string, number> = {};
        const byAirline: Record<string, number> = {};
        const byDepartureCity: Record<string, number> = {};
        const priceBySource: Record<string, number[]> = {};
        const priceByRegion: Record<string, { min: number; max: number; avg: number; count: number }> = {};

        for (const f of flights) {
            // 소스별
            bySource[f.source] = (bySource[f.source] || 0) + 1;

            // 지역별
            const region = f.region || '기타';
            byRegion[region] = (byRegion[region] || 0) + 1;

            // 도착 도시별
            const city = f.arrival?.city || '알 수 없음';
            byCity[city] = (byCity[city] || 0) + 1;

            // 항공사별
            const airline = f.airline || '알 수 없음';
            byAirline[airline] = (byAirline[airline] || 0) + 1;

            // 출발 도시별
            const depCity = f.departure?.city || '알 수 없음';
            byDepartureCity[depCity] = (byDepartureCity[depCity] || 0) + 1;

            // 소스별 가격 분포
            if (!priceBySource[f.source]) priceBySource[f.source] = [];
            priceBySource[f.source].push(f.price);

            // 지역별 가격 통계
            if (!priceByRegion[region]) {
                priceByRegion[region] = { min: f.price, max: f.price, avg: 0, count: 0 };
            }
            const rp = priceByRegion[region];
            rp.min = Math.min(rp.min, f.price);
            rp.max = Math.max(rp.max, f.price);
            rp.avg = ((rp.avg * rp.count) + f.price) / (rp.count + 1);
            rp.count += 1;
        }

        // 소스별 평균 가격
        const avgPriceBySource: Record<string, number> = {};
        for (const [source, prices] of Object.entries(priceBySource)) {
            avgPriceBySource[source] = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        }

        // 최저가 TOP 10
        const cheapest = [...flights]
            .sort((a, b) => a.price - b.price)
            .slice(0, 10)
            .map(f => ({
                route: `${f.departure.city} → ${f.arrival.city}`,
                airline: f.airline,
                price: f.price,
                date: f.departure.date,
                source: f.source,
            }));

        return NextResponse.json({
            timestamp,
            totalFlights: flights.length,
            bySource,
            byRegion,
            byCity,
            byAirline,
            byDepartureCity,
            avgPriceBySource,
            priceByRegion,
            cheapest,
        });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to read cache data' }, { status: 500 });
    }
}
