import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { logCrawlResults } from '@/lib/utils/crawl-logger';

/**
 * 항공사 코드 → 한글 이름 매핑
 */
const AIRLINE_NAMES: Record<string, string> = {
    'KE': '대한항공',
    'OZ': '아시아나항공',
    'LJ': '진에어',
    'TW': '티웨이항공',
    '7C': '제주항공',
    'BX': '에어부산',
    'RS': '에어서울',
    'ZE': '이스타항공',
    'YP': '에어프레미아',
    '5J': '세부퍼시픽',
    'VJ': '비엣젯항공',
    'VN': '베트남항공',
    'CX': '캐세이퍼시픽',
    'HX': '홍콩항공',
    'MU': '중국동방항공',
    'CA': '중국국제항공',
    'CZ': '중국남방항공',
    'SC': '산동항공',
    'NH': '전일본공수',
    'JL': '일본항공',
    'MM': '피치항공',
    'SQ': '싱가포르항공',
    'TG': '타이항공',
    'PR': '필리핀항공',
    'MH': '말레이시아항공',
    'QR': '카타르항공',
    'EK': '에미레이트',
    'SU': '에어로플로트',
    'AA': '아메리칸항공',
    'UA': '유나이티드항공',
    'DL': '델타항공',
    'AC': '에어캐나다',
    'TR': '스쿠트',
    'FD': '타이에어아시아',
    'AK': '에어아시아',
    'QZ': '인도네시아에어아시아',
    'D7': '에어아시아X',
    'BI': '로얄브루나이항공',
};

/**
 * IATA 도시코드 → 공항코드 매핑 (주요 도시)
 */
const CITY_AIRPORTS: Record<string, string> = {
    'SEL': 'ICN',
    'TYO': 'NRT',
    'OSA': 'KIX',
    'FUK': 'FUK',
    'SPK': 'CTS',
    'NGO': 'NGO',
    'OKA': 'OKA',
    'BKK': 'BKK',
    'DAD': 'DAD',
    'HAN': 'HAN',
    'SGN': 'SGN',
    'MNL': 'MNL',
    'CEB': 'CEB',
    'SIN': 'SIN',
    'HKG': 'HKG',
    'TPE': 'TPE',
    'PEK': 'PEK',
    'SHA': 'PVG',
    'GUM': 'GUM',
    'SPN': 'SPN',
    'HNL': 'HNL',
    'NHA': 'CXR',
    'PQC': 'PQC',
    'DPS': 'DPS',
    'KUL': 'KUL',
};

/**
 * 인터파크투어 스크래퍼
 * API: https://travel.interpark.com/air/air-api/inpark-air/search/international/recommendations/popular-cities/lowest-price
 */
export async function scrapeInterpark(): Promise<Flight[]> {
    try {
        console.log('인터파크 크롤링 시작...');

        const response = await fetch(
            'https://travel.interpark.com/air/air-api/inpark-air/search/international/recommendations/popular-cities/lowest-price',
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Accept-Language': 'ko-KR,ko;q=0.9',
                    'Referer': 'https://air.interpark.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
            }
        );

        if (!response.ok) {
            console.error('인터파크 API 호출 실패:', response.status);
            return [];
        }

        const json = await response.json();

        if (json.code !== 'OK' || !Array.isArray(json.data)) {
            console.error('인터파크 API 응답 형식 오류:', json.code);
            return [];
        }

        const flights: Flight[] = [];

        json.data.forEach((item: any, index: number) => {
            const airlineCode = item.airlineCode || '';
            const airlineName = AIRLINE_NAMES[airlineCode] || airlineCode;
            const destCity = item.destinationCity?.name || '';
            const destCode = item.destinationCity?.code || '';
            const originCity = item.originCity?.name || '';
            const originCode = item.originCity?.code || '';
            const price = item.price || 0;

            if (price <= 0) return;

            // 예약 검색 링크 생성
            const searchUrl = `https://air.interpark.com/search/result?origin=${originCode}&destination=${destCode}&departureDate=${item.outboundDate}&returnDate=${item.inboundDate}&tripType=${item.tripType}&adult=1&child=0&infant=0&cabinClass=ECONOMY&isDirect=${item.isDirect}`;

            flights.push({
                id: `interpark-${destCode}-${item.outboundDate}-${index}`,
                source: 'interpark',
                airline: airlineName,
                departure: {
                    city: originCity,
                    airport: CITY_AIRPORTS[originCode] || originCode,
                    date: item.outboundDate || '',
                    time: '',
                },
                arrival: {
                    city: destCity,
                    airport: CITY_AIRPORTS[destCode] || destCode,
                    date: item.inboundDate || '',
                    time: '',
                },
                price: price,
                currency: 'KRW',
                link: searchUrl,
                region: getRegionByCity(destCity),
            });
        });

        console.log(`인터파크에서 ${flights.length}개의 항공권을 가져왔습니다.`);

        const cityStats: { [city: string]: number } = {};
        flights.forEach(f => { cityStats[f.arrival.city] = (cityStats[f.arrival.city] || 0) + 1; });
        logCrawlResults('interpark', flights.length, undefined, cityStats);

        return flights;
    } catch (error) {
        console.error('인터파크 스크래핑 오류:', error);
        return [];
    }
}
