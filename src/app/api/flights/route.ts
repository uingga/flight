import { NextRequest, NextResponse } from 'next/server';
import { Flight, FlightSearchParams } from '@/types/flight';

// 항공사명 정규화 맵
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
    const searchParams = request.nextUrl.searchParams;

    const params: FlightSearchParams = {
        departureCity: searchParams.get('departureCity') || undefined,
        arrivalCity: searchParams.get('arrivalCity') || undefined,
        minPrice: searchParams.get('minPrice') ? parseInt(searchParams.get('minPrice')!) : undefined,
        maxPrice: searchParams.get('maxPrice') ? parseInt(searchParams.get('maxPrice')!) : undefined,
        sortBy: (searchParams.get('sortBy') as 'price' | 'date' | 'airline') || 'price',
        sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'asc',
    };

    try {
        // 통합 캐시 파일에서 모든 항공권 데이터 읽기
        let allFlights: Flight[] = [];
        let lastUpdated: string | null = null;

        try {
            const fs = require('fs');
            const path = require('path');
            const cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');

            if (fs.existsSync(cachePath)) {
                const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
                allFlights = cacheData.flights || [];
                lastUpdated = cacheData.lastUpdated || null;
                console.log(`통합 캐시에서 ${allFlights.length}개 항공권 로드`);
                console.log(`소스별: 땡처리=${cacheData.sources?.ttang || 0}, 노랑풍선=${cacheData.sources?.ybtour || 0}, 하나투어=${cacheData.sources?.hanatour || 0}, 모두투어=${cacheData.sources?.modetour || 0}, 온라인투어=${cacheData.sources?.onlinetour || 0}`);
            } else {
                console.log('통합 캐시 파일 없음. npm run crawl:all을 실행하세요.');
            }
        } catch (cacheError) {
            console.error('캐시 읽기 오류:', cacheError);
        }

        // 항공사명 정규화
        allFlights = allFlights.map(f => ({
            ...f,
            airline: normalizeAirline(f.airline),
        }));

        // 필터링
        if (params.departureCity) {
            allFlights = allFlights.filter(f =>
                f.departure.city.includes(params.departureCity!)
            );
        }
        if (params.arrivalCity) {
            allFlights = allFlights.filter(f =>
                f.arrival.city.includes(params.arrivalCity!)
            );
        }
        if (params.minPrice) {
            allFlights = allFlights.filter(f => f.price >= params.minPrice!);
        }
        if (params.maxPrice) {
            allFlights = allFlights.filter(f => f.price <= params.maxPrice!);
        }

        // 정렬
        allFlights.sort((a, b) => {
            let comparison = 0;

            switch (params.sortBy) {
                case 'price':
                    comparison = a.price - b.price;
                    break;
                case 'date':
                    comparison = new Date(a.departure.date).getTime() - new Date(b.departure.date).getTime();
                    break;
                case 'airline':
                    comparison = a.airline.localeCompare(b.airline);
                    break;
            }

            return params.sortOrder === 'desc' ? -comparison : comparison;
        });

        // 가격 히스토리 로드
        let priceHistory: Record<string, Array<{ date: string; minPrice: number }>> = {};
        try {
            const fs2 = require('fs');
            const path2 = require('path');
            const histPath = path2.join(process.cwd(), 'data', 'price-history.json');
            if (fs2.existsSync(histPath)) {
                priceHistory = JSON.parse(fs2.readFileSync(histPath, 'utf-8'));
            }
        } catch (e) { }

        return NextResponse.json({
            success: true,
            count: allFlights.length,
            flights: allFlights,
            sources: {
                ttang: allFlights.filter(f => f.source === 'ttang').length,
                ybtour: allFlights.filter(f => f.source === 'ybtour').length,
                hanatour: allFlights.filter(f => f.source === 'hanatour').length,
                modetour: allFlights.filter(f => f.source === 'modetour').length,
                onlinetour: allFlights.filter(f => f.source === 'onlinetour').length,
            },
            lastUpdated,
            priceHistory,
        });
    } catch (error) {
        console.error('항공권 데이터 수집 오류:', error);
        return NextResponse.json(
            { success: false, error: '항공권 데이터를 가져오는 중 오류가 발생했습니다.' },
            { status: 500 }
        );
    }
}
