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

// 항공사명 정규화 맵 (flights/route.ts와 동일)
const AIRLINE_NAME_MAP: Record<string, string> = {
    '베트남 항공': '베트남항공',
    '비엣젯 항공': '비엣젯항공',
    '아시아나 항공': '아시아나항공',
    '에미레이트 항공': '에미레이트항공',
    '에어로케이항공': '에어로케이',
    '중화 항공': '중화항공',
    '타이 비엣젯 항공': '타이비엣젯항공',
    '타이 비엣젯항공': '타이비엣젯항공',
    '터키 항공': '터키항공',
    '티웨이 항공': '티웨이항공',
    '필리핀 항공': '필리핀항공',
    '에티하드 항공': '에티하드항공',
    '투르크메니스탄 항공': '투르크메니스탄항공',
    'Airasia': '에어아시아',
    'ANA항공': 'ANA',
    '홍콩에어': '홍콩항공',
};

function normalizeAirline(name: string): string {
    if (!name) return name;
    const trimmed = name.trim();
    return AIRLINE_NAME_MAP[trimmed] || trimmed;
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
            const airline = normalizeAirline(f.airline || '알 수 없음');
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

        // 크롤링 히스토리 로드
        let crawlHistory: Array<{
            timestamp: string;
            sites: Record<string, { total: number }>;
            alerts: string[];
        }> = [];
        try {
            const logPath = path.join(process.cwd(), 'data', 'crawl-log.json');
            if (fs.existsSync(logPath)) {
                const logData = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
                crawlHistory = (logData.entries || []).slice(-50); // 최근 50개
            }
        } catch { }

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
            crawlHistory,
        });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to read cache data' }, { status: 500 });
    }
}
