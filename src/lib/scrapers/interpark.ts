/**
 * 인터파크투어 가격 벤치마크 크롤러
 * API 기반 (Playwright 불필요) — 도착 도시별 월별 최저가/평균가 수집
 */

interface InterparkMonthlyPrice {
    cityCode: string;
    yearMonth: string;
    averagePrice: number;
    lowestPrice: {
        price: number;
        departureDate: string;
        arrivalDate: string;
    };
}

interface InterparkBenchmark {
    timestamp: string;
    prices: Record<string, Record<string, { lowest: number; avg: number; depDate: string; arrDate: string }>>;
}

// 현재 크롤링 중인 도착 도시 목록 (공항코드 → 인터파크 도시코드 매핑)
// 인터파크는 도시코드(SEL, FUK 등)를 사용
const AIRPORT_TO_CITY: Record<string, string> = {
    // 일본
    'CTS': 'SPK',  // 삿포로 (치토세 → 삿포로)
    'NRT': 'TYO',  // 나리타 → 도쿄
    'HND': 'TYO',  // 하네다 → 도쿄
    'KIX': 'OSA',  // 간사이 → 오사카
    'FUK': 'FUK',  // 후쿠오카
    'AOJ': 'AOJ',  // 아오모리
    'KOJ': 'KOJ',  // 가고시마
    // 동남아
    'BKK': 'BKK',  // 방콕
    'CNX': 'CNX',  // 치앙마이
    'HAN': 'HAN',  // 하노이
    'DAD': 'DAD',  // 다낭
    'CXR': 'NHA',  // 캄란 → 나트랑
    'PQC': 'PQC',  // 푸꾸옥
    'BKI': 'BKI',  // 코타키나발루
    'HKT': 'HKT',  // 푸켓
    'MNL': 'MNL',  // 마닐라
    'TAG': 'TAG',  // 타그빌라란 (보홀)
    // 중국/기타
    'SYX': 'SYX',  // 싼야 (하이난)
    'SPN': 'SPN',  // 사이판
};

// 한국어 도시명 → 인터파크 도시코드 매핑 (공항코드 없는 경우 대응)
const CITY_NAME_TO_CODE: Record<string, string> = {
    // 일본
    '오사카': 'OSA', '간사이': 'OSA',
    '도쿄': 'TYO', '나리타': 'TYO', '하네다': 'TYO',
    '후쿠오카': 'FUK',
    '삿포로': 'SPK', '치토세': 'SPK',
    '가고시마': 'KOJ',
    '아오모리': 'AOJ',
    '오키나와': 'OKA', '나하': 'OKA',
    '나고야': 'NGO',
    '나가사키': 'NGS',
    '구마모토': 'KMJ',
    '시즈오카': 'FSZ',
    '마츠야마': 'MYJ',
    '다카마쓰': 'TAK',
    // 동남아
    '방콕': 'BKK', '돈무앙': 'BKK', '수완나폼': 'BKK',
    '치앙마이': 'CNX',
    '다낭': 'DAD',
    '하노이': 'HAN',
    '호치민': 'SGN',
    '나트랑': 'NHA', '깜랑': 'NHA',
    '푸꾸옥': 'PQC',
    '푸켓': 'HKT', '푸껫': 'HKT',
    '코타키나발루': 'BKI',
    '세부': 'CEB',
    '마닐라': 'MNL',
    '보홀': 'TAG', '보홀팡라오': 'TAG', '팡라오': 'TAG',
    '발리': 'DPS', '덴파사': 'DPS',
    '싱가포르': 'SIN', '창이공항': 'SIN',
    '클락': 'CRK',
    '칼리보': 'KLO', '보라카이': 'KLO',
    '바탐': 'BTH',
    '마나도': 'MDC',
    '비엔티엔': 'VTE',
    // 중국/대만/기타
    '싼야': 'SYX', '하이난': 'SYX',
    '홍콩': 'HKG',
    '마카오': 'MFM',
    '타이베이': 'TPE', '타이페이': 'TPE', '대만': 'TPE', '송산': 'TSA',
    '타이중': 'RMQ',
    '가오슝': 'KHH',
    '제남': 'TNA',
    '사이판': 'SPN',
    '괌': 'GUM',
    // 기타
    '두바이': 'DXB',
    '아부다비': 'AUH',
    '시드니': 'SYD',
    '브리즈번': 'BNE',
    '로마': 'ROM', '레오나르도다빈치': 'ROM',
    '이스탄불': 'IST',
    '트라브존': 'TZX',
};

/**
 * 인터파크 월별 최저가 API 호출
 */
async function fetchMonthlyPrices(cityCode: string): Promise<InterparkMonthlyPrice[]> {
    const url = `https://travel.interpark.com/air/air-api/inpark-air-web-api/recommendations/cities/monthly-prices?destinationCity=${cityCode}`;

    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
        });

        if (!response.ok) {
            console.log(`[인터파크] ${cityCode}: HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error(`[인터파크] ${cityCode} API 호출 실패:`, error);
        return [];
    }
}

/**
 * 인터파크 인기 도시 최저가 API 호출
 */
async function fetchPopularLowestPrices(): Promise<any[]> {
    const url = 'https://travel.interpark.com/air/air-api/inpark-air/search/international/recommendations/popular-cities/lowest-price';

    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
        });

        if (!response.ok) return [];

        const json = await response.json();
        return json.data || [];
    } catch (error) {
        console.error('[인터파크] 인기 도시 API 호출 실패:', error);
        return [];
    }
}

/**
 * 인터파크 가격 벤치마크 수집
 * 현재 크롤링 중인 도착 도시들의 월별 최저가를 수집
 */
export async function scrapeInterparkBenchmark(destinationCityCodes?: string[]): Promise<InterparkBenchmark> {
    console.log('\n=== 인터파크 가격 벤치마크 수집 시작 ===');

    // 크롤링 대상 도시 결정 (중복 제거)
    const targetCities = new Set<string>();

    if (destinationCityCodes && destinationCityCodes.length > 0) {
        // 제공된 공항코드를 인터파크 도시코드로 변환
        for (const code of destinationCityCodes) {
            const cityCode = AIRPORT_TO_CITY[code] || code;
            targetCities.add(cityCode);
        }
    } else {
        // 기본: 매핑된 모든 도시
        Object.values(AIRPORT_TO_CITY).forEach(c => targetCities.add(c));
    }

    console.log(`[인터파크] ${targetCities.size}개 도시 조회: ${Array.from(targetCities).join(', ')}`);

    const prices: InterparkBenchmark['prices'] = {};
    let successCount = 0;

    // 순차적으로 API 호출 (서버 부하 방지)
    for (const cityCode of Array.from(targetCities)) {
        const monthlyPrices = await fetchMonthlyPrices(cityCode);

        if (monthlyPrices.length > 0) {
            prices[cityCode] = {};
            for (const mp of monthlyPrices) {
                if (!mp.lowestPrice) continue; // API 응답에 최저가 없으면 건너뜀
                prices[cityCode][mp.yearMonth] = {
                    lowest: mp.lowestPrice.price,
                    avg: mp.averagePrice,
                    depDate: mp.lowestPrice.departureDate,
                    arrDate: mp.lowestPrice.arrivalDate,
                };
            }
            if (Object.keys(prices[cityCode]).length > 0) successCount++;
        }

        // 요청 간 짧은 딜레이
        await new Promise(r => setTimeout(r, 200));
    }

    // 인기 도시 최저가도 추가 (더 정확한 특정 날짜 가격)
    const popularPrices = await fetchPopularLowestPrices();
    for (const pp of popularPrices) {
        const cityCode = pp.destinationCity?.code;
        if (cityCode && prices[cityCode]) {
            const yearMonth = pp.outboundDate?.substring(0, 7); // "2026-03" 형태
            if (yearMonth && prices[cityCode][yearMonth]) {
                // 인기 도시 API의 가격이 더 정확하므로 lowest에 반영
                const existingLowest = prices[cityCode][yearMonth].lowest;
                if (pp.price < existingLowest) {
                    prices[cityCode][yearMonth].lowest = pp.price;
                    prices[cityCode][yearMonth].depDate = pp.outboundDate;
                    prices[cityCode][yearMonth].arrDate = pp.inboundDate;
                }
            }
        }
    }

    const benchmark: InterparkBenchmark = {
        timestamp: new Date().toISOString(),
        prices,
    };

    console.log(`[인터파크] 수집 완료: ${successCount}/${targetCities.size}개 도시`);

    // 요약 출력
    let totalRoutes = 0;
    for (const city of Object.keys(prices)) {
        totalRoutes += Object.keys(prices[city]).length;
    }
    console.log(`[인터파크] 총 ${totalRoutes}개 월별 가격 데이터 수집`);

    return benchmark;
}

/**
 * 항공편 도시명에서 인터파크 도시코드를 추출
 * "오사카(KIX)", "오사카(간사이)", "나트랑", "도쿄(NRT)" 등 모든 형식 지원
 */
export function resolveCityCode(cityString: string): string | null {
    if (!cityString) return null;

    // 1. 괄호 안에 영문 공항코드가 있는 경우: "삿포로(CTS)" → CTS → SPK
    const airportMatch = cityString.match(/\(([A-Z]{3})\)/);
    if (airportMatch) {
        return AIRPORT_TO_CITY[airportMatch[1]] || airportMatch[1];
    }

    // 2. 괄호 안에 한글 공항명이 있는 경우: "오사카(간사이)" → 간사이 → OSA
    const koreanParenMatch = cityString.match(/\(([^)]+)\)/);
    if (koreanParenMatch) {
        const innerName = koreanParenMatch[1];
        if (CITY_NAME_TO_CODE[innerName]) {
            return CITY_NAME_TO_CODE[innerName];
        }
    }

    // 3. 도시명 자체로 매칭: "나트랑" → NHA
    const baseName = cityString.replace(/\([^)]+\)/, '').trim();
    if (CITY_NAME_TO_CODE[baseName]) {
        return CITY_NAME_TO_CODE[baseName];
    }

    // 4. 전체 문자열로 매칭 시도
    if (CITY_NAME_TO_CODE[cityString]) {
        return CITY_NAME_TO_CODE[cityString];
    }

    return null;
}

/**
 * 공항코드를 인터파크 도시코드로 변환 (하위 호환)
 */
export function airportToCityCode(airportCode: string): string {
    return AIRPORT_TO_CITY[airportCode] || airportCode;
}
