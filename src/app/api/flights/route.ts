import { NextRequest, NextResponse } from 'next/server';
import { Flight, FlightSearchParams } from '@/types/flight';

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

        try {
            const fs = require('fs');
            const path = require('path');
            const cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');

            if (fs.existsSync(cachePath)) {
                const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
                allFlights = cacheData.flights || [];
                console.log(`통합 캐시에서 ${allFlights.length}개 항공권 로드`);
                console.log(`소스별: 땡처리=${cacheData.sources?.ttang || 0}, 노랑풍선=${cacheData.sources?.ybtour || 0}, 하나투어=${cacheData.sources?.hanatour || 0}, 모두투어=${cacheData.sources?.modetour || 0}, 온라인투어=${cacheData.sources?.onlinetour || 0}`);
            } else {
                console.log('통합 캐시 파일 없음. npm run crawl:all을 실행하세요.');
            }
        } catch (cacheError) {
            console.error('캐시 읽기 오류:', cacheError);
        }

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
        });
    } catch (error) {
        console.error('항공권 데이터 수집 오류:', error);
        return NextResponse.json(
            { success: false, error: '항공권 데이터를 가져오는 중 오류가 발생했습니다.' },
            { status: 500 }
        );
    }
}
