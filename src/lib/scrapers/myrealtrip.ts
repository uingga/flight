import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';

/**
 * 마이리얼트립 Partner API 스크래퍼
 *
 * 캘린더 최저가 API를 사용하여 주요 노선의 최저가 항공편을 수집하고,
 * 랜딩 URL API로 예약 페이지 링크를 생성합니다.
 *
 * API 파라미터 (실제 검증 결과):
 * - Calendar: depCityCd, arrCityCd, startDate, endDate, period
 * - Landing URL: depAirportCd, arrAirportCd, tripTypeCd, depDate, retDate, adultCnt, childCnt, infantCnt
 */

const BASE_URL = 'https://partner-ext-api.myrealtrip.com';
const API_KEY = process.env.MYREALTRIP_API_KEY || '';

// API는 도시코드(SEL, TYO 등)를 사용 — 공항코드(ICN, NRT)와 다름
const TARGET_ROUTES: Array<{ city: string; cityCd: string; airportCd: string }> = [
    // 일본
    { city: '도쿄(나리타)', cityCd: 'TYO', airportCd: 'NRT' },
    { city: '오사카(간사이)', cityCd: 'OSA', airportCd: 'KIX' },
    { city: '후쿠오카', cityCd: 'FUK', airportCd: 'FUK' },
    { city: '삿포로', cityCd: 'SPK', airportCd: 'CTS' },
    { city: '오키나와', cityCd: 'OKA', airportCd: 'OKA' },
    { city: '나고야', cityCd: 'NGO', airportCd: 'NGO' },
    { city: '나가사키', cityCd: 'NGS', airportCd: 'NGS' },
    // 동남아
    { city: '다낭', cityCd: 'DAD', airportCd: 'DAD' },
    { city: '나트랑', cityCd: 'NHA', airportCd: 'CXR' },
    { city: '하노이', cityCd: 'HAN', airportCd: 'HAN' },
    { city: '호치민', cityCd: 'SGN', airportCd: 'SGN' },
    { city: '방콕', cityCd: 'BKK', airportCd: 'BKK' },
    { city: '세부', cityCd: 'CEB', airportCd: 'CEB' },
    { city: '보라카이', cityCd: 'KLO', airportCd: 'KLO' },
    { city: '푸켓', cityCd: 'HKT', airportCd: 'HKT' },
    { city: '싱가포르', cityCd: 'SIN', airportCd: 'SIN' },
    { city: '코타키나발루', cityCd: 'BKI', airportCd: 'BKI' },
    { city: '발리', cityCd: 'DPS', airportCd: 'DPS' },
    // 중국/대만/홍콩
    { city: '타이베이', cityCd: 'TPE', airportCd: 'TPE' },
    { city: '홍콩', cityCd: 'HKG', airportCd: 'HKG' },
    { city: '상하이', cityCd: 'SHA', airportCd: 'PVG' },
    // 기타
    { city: '괌', cityCd: 'GUM', airportCd: 'GUM' },
    { city: '사이판', cityCd: 'SPN', airportCd: 'SPN' },
];

// 출발 도시
const DEPARTURE_CITIES = [
    { city: '서울', cityCd: 'SEL', airportCd: 'ICN' },
    { city: '부산', cityCd: 'PUS', airportCd: 'PUS' },
];

// 항공사 2자리 코드 → 한글명
const AIRLINE_CODE_MAP: Record<string, string> = {
    'KE': '대한항공', 'OZ': '아시아나항공', '7C': '제주항공',
    'LJ': '진에어', 'TW': '티웨이항공', 'ZE': '이스타항공',
    'BX': '에어부산', 'RF': '에어로케이', 'RS': '에어서울',
    'VJ': '비엣젯항공', 'VN': '베트남항공', 'QH': '밤부항공',
    'JL': '일본항공', 'NH': 'ANA', 'MM': '피치항공',
    'CI': '중화항공', 'CX': '캐세이퍼시픽', 'SQ': '싱가포르항공',
    'TG': '타이항공', 'PR': '필리핀항공', '5J': '세부퍼시픽',
    'MH': '말레이시아항공', 'GA': '가루다인도네시아',
    'TR': '스쿠트', 'FD': '타이에어아시아', 'QR': '카타르항공',
    'EK': '에미레이트', 'BR': '에바항공', 'IT': '타이거에어타이완',
    'WE': '타이스마일', 'UO': '홍콩익스프레스', 'UA': '유나이티드',
    'DL': '델타항공', 'AA': '아메리칸항공', 'CA': '중국국제항공',
    'MU': '중국동방항공', 'CZ': '중국남방항공', 'SC': '산동항공',
    'HO': '준야오항공', 'HX': '홍콩항공',
};

/** Date → YYYY-MM-DD */
function formatDateHyphen(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** 날짜 문자열에 기간(일)을 더한 날짜 반환 */
function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return formatDateHyphen(d);
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

interface CalendarFare {
    fromCity: string;
    toCity: string;
    departureDate: string;
    returnDate: string | null;
    totalPrice: number;
    airline: string;           // 2자리 항공사 코드
    averagePrice: number | null;
    period: number | null;
    transfer: number | null;
}

/**
 * 캘린더 최저가 조회 API 호출
 */
async function fetchCalendarFares(
    depCityCd: string,
    arrCityCd: string,
    startDate: string,
    endDate: string,
    period: number = 3,
): Promise<CalendarFare[]> {
    const url = `${BASE_URL}/v1/products/flight/calendar`;

    const body = {
        depCityCd,
        arrCityCd,
        startDate,
        endDate,
        period,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (response.status === 429) {
            console.log(`[마이리얼트립] Rate limited (${depCityCd}→${arrCityCd}), 3초 후 재시도...`);
            await delay(3000);
            const retry = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json',
                },
                body: JSON.stringify(body),
            });
            if (!retry.ok) return [];
            const data = await retry.json();
            return Array.isArray(data?.data) ? data.data : [];
        }

        if (!response.ok) {
            const text = await response.text();
            console.error(`[마이리얼트립] API 오류 ${response.status} (${depCityCd}→${arrCityCd}):`, text.slice(0, 200));
            return [];
        }

        const data = await response.json();
        return Array.isArray(data?.data) ? data.data : [];
    } catch (error) {
        console.error(`[마이리얼트립] 요청 실패 (${depCityCd}→${arrCityCd}):`, error instanceof Error ? error.message : error);
        return [];
    }
}

/**
 * 랜딩(예약) URL 생성 API 호출
 */
async function fetchLandingUrl(
    depAirportCd: string,
    arrAirportCd: string,
    depDate: string,
    retDate: string,
    adults: number = 1,
): Promise<string> {
    const url = `${BASE_URL}/v1/products/flight/fare-query-landing-url`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                depAirportCd,
                arrAirportCd,
                tripTypeCd: 'RT',
                depDate,
                retDate,
                adultCnt: adults,
                childCnt: 0,
                infantCnt: 0,
            }),
        });

        if (!response.ok) return buildFallbackUrl(depAirportCd, arrAirportCd, depDate, retDate);

        const data = await response.json();
        // 응답: { data: "https://flights.myrealtrip.com/..." }
        const landingUrl = typeof data?.data === 'string' ? data.data : '';
        return landingUrl || buildFallbackUrl(depAirportCd, arrAirportCd, depDate, retDate);
    } catch {
        return buildFallbackUrl(depAirportCd, arrAirportCd, depDate, retDate);
    }
}

/** 랜딩 URL API 실패 시 직접 URL 조합 */
function buildFallbackUrl(depCode: string, arrCode: string, depDate: string, arrDate: string): string {
    return `https://www.myrealtrip.com/flights/search/${depCode}/${arrCode}/${depDate}/${arrDate}/1/0/0/economy`;
}

/** 항공사 코드 → 한글명 변환 */
function getAirlineName(code: string): string {
    return AIRLINE_CODE_MAP[code] || code || '항공사 미정';
}

/**
 * 마이리얼트립 전체 크롤링
 */
export async function scrapeMyrealtrip(): Promise<Flight[]> {
    console.log('\n=== 마이리얼트립 크롤링 시작 ===');

    if (!API_KEY) {
        console.error('[마이리얼트립] API 키가 없습니다. MYREALTRIP_API_KEY 환경변수를 설정하세요.');
        return [];
    }

    const allFlights: Flight[] = [];
    const processedKeys = new Set<string>();

    // 조회 기간: 오늘 ~ +60일
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 60);

    const startDateStr = formatDateHyphen(today);
    const endDateStr = formatDateHyphen(endDate);

    const TRIP_PERIOD = 3; // 3일 여행
    let totalApiCalls = 0;

    for (const dep of DEPARTURE_CITIES) {
        for (const arr of TARGET_ROUTES) {
            totalApiCalls++;

            const fares = await fetchCalendarFares(
                dep.cityCd,
                arr.cityCd,
                startDateStr,
                endDateStr,
                TRIP_PERIOD,
            );

            if (fares.length > 0) {
                let routeCount = 0;

                for (const fare of fares) {
                    const depDate = fare.departureDate || '';
                    // returnDate가 null이면 period로 계산
                    const retDate = fare.returnDate || addDays(depDate, TRIP_PERIOD);
                    const price = fare.totalPrice || 0;

                    if (!depDate || price <= 0) continue;

                    const key = `${dep.cityCd}|${arr.cityCd}|${depDate}|${retDate}|${price}`;
                    if (processedKeys.has(key)) continue;
                    processedKeys.add(key);

                    const airline = getAirlineName(fare.airline);

                    // 랜딩 URL은 나중에 배치로 보강 (API 호출 최소화)
                    const link = buildFallbackUrl(dep.airportCd, arr.airportCd, depDate, retDate);

                    const flight: Flight = {
                        id: `mrt-${dep.airportCd}-${arr.airportCd}-${depDate.replace(/-/g, '')}-${price}`,
                        source: 'myrealtrip',
                        airline,
                        departure: {
                            city: dep.city,
                            airport: dep.airportCd,
                            date: depDate,
                            time: '',
                        },
                        arrival: {
                            city: arr.city,
                            airport: arr.airportCd,
                            date: retDate,
                            time: '',
                        },
                        price,
                        currency: 'KRW',
                        link,
                        searchLink: link,
                        region: getRegionByCity(arr.city.replace(/\([^)]+\)/g, '').trim()) || '',
                    };

                    allFlights.push(flight);
                    routeCount++;
                }

                if (routeCount > 0) {
                    console.log(`[마이리얼트립] ${dep.city}→${arr.city}: ${routeCount}개 항공편`);
                }
            }

            // Rate limit 방지
            await delay(300);
        }
    }

    // 랜딩 URL 보강 (가격순 상위 50개만 — API 호출 절약)
    const sorted = [...allFlights].sort((a, b) => a.price - b.price);
    const topFlights = sorted.slice(0, 50);
    let urlCount = 0;

    console.log(`[마이리얼트립] 상위 ${topFlights.length}개에 랜딩 URL 보강 중...`);

    for (const f of topFlights) {
        try {
            const landingUrl = await fetchLandingUrl(
                f.departure.airport,
                f.arrival.airport,
                f.departure.date,
                f.arrival.date,
            );
            if (landingUrl && landingUrl.includes('myrealtrip.com')) {
                f.link = landingUrl;
                f.searchLink = landingUrl;
                urlCount++;
            }
        } catch { }
        await delay(200);
    }

    console.log(`[마이리얼트립] 랜딩 URL 보강: ${urlCount}/${topFlights.length}개`);
    console.log(`[마이리얼트립] 완료: API ${totalApiCalls}회 호출, ${allFlights.length}개 항공편 수집`);

    return allFlights;
}
