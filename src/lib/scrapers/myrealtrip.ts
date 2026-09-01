import { Flight } from '@/types/flight';
import { lookupRegionByCity } from '@/lib/utils/region-mapper';
import fs from 'fs';
import path from 'path';
import {
    assertNoSourceAccessBlockText,
    assertNoSourceResponseCollapse,
    fetchSourceText,
    retrySourceOperation,
    SourceResponseError,
} from './source-response';
import {
    normalizePopularLowestRoutes,
    type InterparkBenchmark,
} from './interpark';

/**
 * 마이리얼트립 항공권 스크래퍼 v5 (최종)
 *
 * 1단계: Bulk Lowest API → 전체 도시 목록 + 도시명/지역 정보
 * 2단계: Public Calendar API → 각 노선의 실시간 최저가 + 최저 날짜
 *        (offers.k1 페이지가 사용하는 동일한 API, 인증 불필요)
 * 3단계: gid-map.json → 파트너 딥링크 생성
 *
 * Calendar API 가격 = 유저가 실제 보는 검색 결과 가격
 */

const BULK_API_URL = 'https://api3.myrealtrip.com/flight/api/price/calendar/bulk-lowest';
const CALENDAR_API_URL = 'https://api3.myrealtrip.com/flight/api/price/calendar';

// 파트너 광고 링크 설정
const PARTNER_LINK_ID = process.env.MYREALTRIP_LINK_ID || '1849392';
const PARTNER_BRIDGE_BASE = 'https://www.myrealtrip.com/bridge/marketing/';

// 최저가 수집 대상 가격 상한
const MAX_PRICE = 1_500_000;

// 출발 도시
const DEPARTURE_CITIES = [
    { city: '서울', cityCd: 'ICN', calendarFrom: 'SEL' },
    { city: '부산', cityCd: 'PUS', calendarFrom: 'PUS' },
];

// 도시코드 → 한글 도시명 매핑
const CITY_NAME_MAP: Record<string, string> = {
    'NRT': '도쿄(나리타)', 'HND': '도쿄(하네다)', 'TYO': '도쿄',
    'KIX': '오사카(간사이)', 'ITM': '오사카(이타미)', 'OSA': '오사카',
    'FUK': '후쿠오카', 'CTS': '삿포로', 'OKA': '오키나와',
    'NGO': '나고야', 'NGS': '나가사키', 'KMJ': '구마모토',
    'KOJ': '가고시마', 'TAK': '다카마쓰', 'MYJ': '마츠야마',
    'SDJ': '센다이', 'HIJ': '히로시마', 'KMQ': '고마쓰',
    'AOJ': '아오모리', 'MMY': '미야코지마', 'ISG': '이시가키',
    'KKJ': '기타큐슈',
    'DAD': '다낭', 'CXR': '나트랑', 'HAN': '하노이',
    'SGN': '호치민', 'PQC': '푸꾸옥', 'HPH': '하이퐁',
    'BKK': '방콕', 'CNX': '치앙마이', 'HKT': '푸켓',
    'USM': '코사무이', 'DMK': '방콕(돈무앙)',
    'CEB': '세부', 'KLO': '보라카이(칼리보)', 'MNL': '마닐라',
    'CRK': '클라크', 'TAG': '보홀',
    'SIN': '싱가포르', 'KUL': '쿠알라룸푸르', 'BKI': '코타키나발루',
    'DPS': '발리', 'CGK': '자카르타', 'RGN': '양곤',
    'PNH': '프놈펜', 'REP': '시엠립', 'VTE': '비엔티안',
    'LPQ': '루앙프라방',
    'TPE': '타이베이', 'KHH': '가오슝', 'HKG': '홍콩',
    'MFM': '마카오', 'PVG': '상하이(푸동)', 'SHA': '상하이',
    'PEK': '베이징', 'CAN': '광저우', 'SZX': '선전',
    'CTU': '청두', 'HRB': '하얼빈', 'DLC': '다롄',
    'TAO': '칭다오', 'WEH': '웨이하이', 'YNT': '옌타이',
    'CSX': '창사', 'KWE': '구이양', 'XMN': '샤먼',
    'NKG': '난징', 'HGH': '항저우', 'CKG': '충칭',
    'KMG': '쿤밍', 'SYX': '싼야', 'HAK': '하이커우',
    'TNA': '지난', 'ZHA': '잔장', 'WUH': '우한',
    'XIY': '시안', 'CGO': '정저우', 'TSN': '톈진',
    'SHE': '선양', 'CGQ': '창춘', 'MDG': '무단장',
    'YNJ': '옌지',
    'GUM': '괌', 'SPN': '사이판',
    'UBN': '울란바토르', 'DEL': '델리', 'BOM': '뭄바이',
    'CMB': '콜롬보', 'MLE': '몰디브',
};

// 국가 코드 → 대시보드 지역명 (API의 arrivalRegion보다 정확)
// API의 '동아시아'에는 일본·인도·카자흐스탄·러시아까지 섞여 있어 그대로 쓸 수 없다.
const COUNTRY_REGION_MAP: Record<string, string> = {
    'JP': '일본',
    'CN': '중국', 'TW': '중국', 'HK': '중국', 'MO': '중국',
    'TH': '동남아', 'VN': '동남아', 'PH': '동남아', 'SG': '동남아',
    'MY': '동남아', 'ID': '동남아', 'KH': '동남아', 'LA': '동남아',
    'MM': '동남아', 'BN': '동남아',
    'US': '미주', 'CA': '미주', 'MX': '미주', 'BR': '미주',
    // 괌/북마리아나(사이판)는 API가 '미주'로 분류하므로 반드시 덮어써야 한다.
    'GU': '남태평양', 'MP': '남태평양',
    'AU': '남태평양', 'NZ': '남태평양', 'FJ': '남태평양',
    // API가 '동아시아'로 묶어버리는 남아시아·중앙아시아 국가들
    'IN': '기타', 'KZ': '기타', 'PK': '기타', 'BD': '기타', 'KG': '기타',
    'LK': '기타', 'MN': '기타', 'NP': '기타', 'UZ': '기타',
};

// API 지역명 → 대시보드 지역명
// 주의: '동아시아'는 일본·중국·대만을 모두 포함하므로 최후의 폴백으로만 사용한다.
const API_REGION_MAP: Record<string, string> = {
    '동아시아': '중국', '동남아시아': '동남아', '아시아': '동남아',
    '대양주': '남태평양', '유럽': '유럽', '미주': '미주',
    '중남미': '미주', '아프리카': '기타', '중동': '기타',
};

export interface BulkLowestFare {
    departureDate: string;
    arrivalDate: string;
    totalPrice: number;
    departureCity: string;
    period: number;
    arrivalCity: string;
    averagePrice: number;
    arrivalCityName: string;
    arrivalRegion: string;
    arrivalCountryCode: string;
    arrivalCountryNameKo: string;
    arrivalCountryNameEn: string;
}

export interface CalendarPrice {
    date: string;
    airline: string;
    price: number;
}

export interface MyrealtripBulkCoverage {
    successfulDepartureAirports: string[];
    emptyDepartureAirports: string[];
}

export interface MyrealtripScrapeResult {
    flights: Flight[];
    bulkCoverage: MyrealtripBulkCoverage;
    quickDepartureSeedCount: number;
}

export interface MyrealtripDateSeedCandidate {
    originCityCode: 'SEL';
    destinationCityCode: string;
    destinationCityName: string;
    departureDate: string;
    returnDate: string;
    referencePrice: number;
    observedAt: string;
}

export interface MyrealtripScrapeOptions {
    dateCandidates?: MyrealtripDateSeedCandidate[];
}

interface MyrealtripCoverageFlight {
    departure?: { airport?: string };
}

/**
 * 원래 비어 있는 출발지와 전체 API 응답 붕괴를 구분한다.
 * 기존에 데이터가 있던 출발지만 사라진 경우에는 차단으로 단정하지 않고
 * 불완전 응답으로 중단해 이전 캐시를 보존한다.
 */
export function assertMyrealtripSeedReplacementSafe(
    freshFlights: MyrealtripCoverageFlight[],
    previousFlights: MyrealtripCoverageFlight[],
    bulkCoverage: MyrealtripBulkCoverage,
    minRetentionRatio = 0.6,
): void {
    if (bulkCoverage.successfulDepartureAirports.length === 0) {
        throw new SourceResponseError(
            'soft-block',
            '마이리얼트립 모든 출발지의 Bulk 목록이 0건입니다.',
            200,
        );
    }

    const emptySet = new Set(bulkCoverage.emptyDepartureAirports);
    const missingPreviousCounts = new Map<string, number>();
    for (const flight of previousFlights) {
        const airport = flight.departure?.airport || '';
        if (!emptySet.has(airport)) continue;
        missingPreviousCounts.set(airport, (missingPreviousCounts.get(airport) || 0) + 1);
    }
    if (missingPreviousCounts.size > 0) {
        const detail = Array.from(missingPreviousCounts.entries())
            .map(([airport, count]) => `${airport} ${count}건→0건`)
            .join(', ');
        throw new SourceResponseError(
            'api-error',
            `마이리얼트립 출발지별 Bulk 응답이 불완전합니다: ${detail}. 기존 캐시를 보존합니다.`,
            200,
        );
    }

    if (freshFlights.length === 0) {
        throw new SourceResponseError(
            'soft-block',
            '마이리얼트립 공개 API 결과가 전체 0건입니다.',
            200,
        );
    }

    // 한 출발지의 급감을 다른 출발지 신규 데이터가 상쇄하지 못하게 출발지별로 비교한다.
    for (const airport of bulkCoverage.successfulDepartureAirports) {
        const previousCount = previousFlights.filter(flight => flight.departure?.airport === airport).length;
        if (previousCount === 0) continue;
        const freshCount = freshFlights.filter(flight => flight.departure?.airport === airport).length;
        if (freshCount >= previousCount * minRetentionRatio) continue;
        throw new SourceResponseError(
            'soft-block',
            `마이리얼트립 ${airport} 공개 API 결과가 기준선의 ${Math.round(minRetentionRatio * 100)}% 미만입니다: `
            + `${previousCount}건→${freshCount}건`,
            200,
        );
    }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── GID 매핑 ──────────────────────────────────────────

function loadGidMap(): Record<string, number> {
    const FALLBACK: Record<string, number> = {
        'NRT': 3531201, 'HND': 3537336, 'KIX': 3531274, 'FUK': 3531245,
        'CTS': 3531237, 'OKA': 3531360, 'NGO': 3533947, 'MYJ': 3534304,
        'KMJ': 3555883, 'TAK': 3531273, 'KKJ': 3536878, 'HIJ': 3538127,
        'DAD': 3531265, 'CXR': 3531263, 'HAN': 3533492, 'SGN': 3533892,
        'PQC': 3531359, 'BKK': 3531351, 'DMK': 3533145, 'CNX': 3531390,
        'HKT': 3531355, 'CEB': 3531346, 'TAG': 3531327, 'KLO': 3531418,
        'MNL': 3567286, 'SIN': 3531395, 'DPS': 3531212, 'BKI': 3533245,
        'KUL': 3531367, 'HKG': 3533329, 'TPE': 3531208, 'KHH': 3533248,
        'GUM': 3531205, 'SPN': 3533022, 'UBN': 3533449, 'PVG': 3531409,
        'PEK': 3756210, 'TAO': 3539921, 'SYD': 3532825,
    };
    try {
        const filePath = path.resolve(process.cwd(), 'data/gid-map.json');
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const map: Record<string, number> = {};
        for (const [code, val] of Object.entries(parsed)) {
            if (typeof val === 'number') map[code] = val;
            else if (typeof val === 'object' && val && 'gid' in val) map[code] = (val as any).gid;
        }
        if (Object.keys(map).length > 0) {
            console.log(`[마이리얼트립] gid-map.json 로드: ${Object.keys(map).length}개 노선`);
            return map;
        }
    } catch {}
    console.log(`[마이리얼트립] gid-map.json 없음, 폴백 사용: ${Object.keys(FALLBACK).length}개`);
    return FALLBACK;
}

const ROUTE_GID_MAP = loadGidMap();

const INTERPARK_TO_MYREALTRIP_DESTINATION: Record<string, string> = {
    SPK: 'CTS',
    NHA: 'CXR',
};

const DESTINATION_AIRPORT_GROUPS: Record<string, string[]> = {
    OSA: ['KIX', 'ITM', 'UKB'],
    TYO: ['NRT', 'HND'],
    SPK: ['CTS', 'OKD'],
    NHA: ['CXR'],
    BJS: ['PEK', 'PKX'],
    SHA: ['PVG', 'SHA'],
};

const QUICK_DEPARTURE_SEED_PREFIX = 'mrt-quick-';
const DEFAULT_QUICK_DEPARTURE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUICK_DEPARTURE_MAX_CANDIDATES = 8;
const DEFAULT_QUICK_DEPARTURE_MAX_DAYS_AHEAD = 60;

function formatKstDate(date: Date): string {
    return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function resolveMyrealtripDestinationCode(interparkCode: string): string {
    return INTERPARK_TO_MYREALTRIP_DESTINATION[interparkCode] || interparkCode;
}

function canonicalDestinationCode(code: string): string {
    const upper = code.toUpperCase();
    for (const [cityCode, airports] of Object.entries(DESTINATION_AIRPORT_GROUPS)) {
        if (upper === cityCode || airports.includes(upper)) return cityCode;
    }
    return upper;
}

function dateSeedIdentity(
    departureAirport: string,
    destinationCode: string,
    departureDate: string,
    returnDate: string,
): string {
    return [
        departureAirport === 'GMP' ? 'SEL' : departureAirport === 'ICN' ? 'SEL' : departureAirport,
        canonicalDestinationCode(destinationCode),
        departureDate,
        returnDate,
    ].join('|');
}

export function selectInterparkMyrealtripDateCandidates(
    benchmark: Pick<InterparkBenchmark, 'popularLowestRoutes' | 'popularUpdatedAt'> | null | undefined,
    options: {
        now?: Date;
        maxAgeMs?: number;
        maxCandidates?: number;
        maxDaysAhead?: number;
    } = {},
): MyrealtripDateSeedCandidate[] {
    const now = options.now || new Date();
    const observedAt = benchmark?.popularUpdatedAt || '';
    const observedAtMs = new Date(observedAt).getTime();
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_QUICK_DEPARTURE_MAX_AGE_MS;
    if (!Number.isFinite(observedAtMs) || now.getTime() - observedAtMs > maxAgeMs) return [];

    const today = formatKstDate(now);
    const cutoffDate = new Date(now.getTime() + (
        options.maxDaysAhead ?? DEFAULT_QUICK_DEPARTURE_MAX_DAYS_AHEAD
    ) * 24 * 60 * 60 * 1000);
    const cutoff = formatKstDate(cutoffDate);
    const configuredMaxCandidates = options.maxCandidates ?? DEFAULT_QUICK_DEPARTURE_MAX_CANDIDATES;
    const maxCandidates = Number.isFinite(configuredMaxCandidates)
        ? Math.max(
            0,
            Math.min(DEFAULT_QUICK_DEPARTURE_MAX_CANDIDATES, Math.floor(configuredMaxCandidates)),
        )
        : DEFAULT_QUICK_DEPARTURE_MAX_CANDIDATES;

    const selected = new Map<string, MyrealtripDateSeedCandidate>();
    for (const route of normalizePopularLowestRoutes(benchmark?.popularLowestRoutes)) {
        const destinationCode = resolveMyrealtripDestinationCode(route.destinationCity.code);
        if (!ROUTE_GID_MAP[destinationCode]
            || route.outboundDate < today
            || route.outboundDate > cutoff
            || route.inboundDate <= route.outboundDate) {
            continue;
        }

        const candidate: MyrealtripDateSeedCandidate = {
            originCityCode: 'SEL',
            destinationCityCode: destinationCode,
            destinationCityName: route.destinationCity.name,
            departureDate: route.outboundDate,
            returnDate: route.inboundDate,
            referencePrice: route.price,
            observedAt,
        };
        const key = dateSeedIdentity('ICN', destinationCode, route.outboundDate, route.inboundDate);
        const previous = selected.get(key);
        if (!previous || candidate.referencePrice < previous.referencePrice) selected.set(key, candidate);
    }

    return Array.from(selected.values())
        .sort((a, b) => a.departureDate.localeCompare(b.departureDate) || a.referencePrice - b.referencePrice)
        .slice(0, maxCandidates);
}

export function appendMyrealtripDateSeedFlights(
    flights: Flight[],
    candidates: MyrealtripDateSeedCandidate[],
): Flight[] {
    const existingKeys = new Set(flights.map(flight => dateSeedIdentity(
        flight.departure.airport,
        flight.arrival.airport,
        flight.departure.date,
        flight.arrival.date,
    )));
    const added: Flight[] = [];

    for (const candidate of candidates) {
        const key = dateSeedIdentity(
            'ICN',
            candidate.destinationCityCode,
            candidate.departureDate,
            candidate.returnDate,
        );
        if (existingKeys.has(key)) continue;

        const cityName = CITY_NAME_MAP[candidate.destinationCityCode]
            || candidate.destinationCityName
            || candidate.destinationCityCode;
        const flight: Flight = {
            id: `${QUICK_DEPARTURE_SEED_PREFIX}ICN-${candidate.destinationCityCode}-${candidate.departureDate.replace(/-/g, '')}-${candidate.returnDate.replace(/-/g, '')}`,
            source: 'myrealtrip',
            airline: '항공사 미정',
            departure: {
                city: '서울(인천)',
                airport: 'ICN',
                date: candidate.departureDate,
                time: '',
            },
            arrival: {
                city: cityName,
                airport: candidate.destinationCityCode,
                date: candidate.returnDate,
                time: '',
            },
            price: candidate.referencePrice,
            currency: 'KRW',
            link: buildPartnerLink(
                candidate.destinationCityCode,
                candidate.departureDate,
                candidate.returnDate,
            ),
            searchLink: buildPartnerLink(
                candidate.destinationCityCode,
                candidate.departureDate,
                candidate.returnDate,
            ),
            region: lookupRegionByCity(cityName.replace(/\([^)]+\)/g, '').trim()) || '기타',
        };
        flights.push(flight);
        added.push(flight);
        existingKeys.add(key);
    }

    return added;
}

export function isMyrealtripQuickDepartureSeed(flight: { id?: string }): boolean {
    return String(flight.id || '').startsWith(QUICK_DEPARTURE_SEED_PREFIX);
}

export function matchesMyrealtripQuickDepartureRoute(
    flight: { arrival: { airport: string } },
    result: {
        isDirect?: boolean;
        depTime?: string;
        arrTime?: string;
        retDepTime?: string;
        retArrTime?: string;
        routeAirports?: {
            outboundDeparture: string;
            outboundArrival: string;
            returnDeparture: string;
            returnArrival: string;
        };
    },
): boolean {
    if (!result.isDirect
        || !result.routeAirports
        || !result.depTime
        || !result.arrTime
        || !result.retDepTime
        || !result.retArrTime) {
        return false;
    }
    const expectedDestination = canonicalDestinationCode(flight.arrival.airport);
    const actualOutbound = canonicalDestinationCode(result.routeAirports.outboundArrival);
    const actualReturn = canonicalDestinationCode(result.routeAirports.returnDeparture);
    const validOriginAirports = new Set(['ICN', 'GMP']);
    return validOriginAirports.has(result.routeAirports.outboundDeparture)
        && validOriginAirports.has(result.routeAirports.returnArrival)
        && actualOutbound === expectedDestination
        && actualReturn === expectedDestination;
}

// ── API 호출 ──────────────────────────────────────────

async function fetchMyrealtripJson(label: string, url: string, body: Record<string, unknown>): Promise<unknown> {
    return retrySourceOperation(label, async () => {
        const response = await fetchSourceText(label, url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'Referer': 'https://flights.myrealtrip.com/',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
            },
            body: JSON.stringify(body),
        }, 20_000);
        assertNoSourceAccessBlockText(label, response.text, response.finalUrl);
        try {
            return JSON.parse(response.text);
        } catch {
            throw new SourceResponseError(
                'malformed-json',
                `${label} 응답 JSON을 해석하지 못했습니다.`,
                response.status,
                response.contentType,
                undefined,
                response.finalUrl,
            );
        }
    }, {
        maxAttempts: 2,
        delaysMs: [2_000],
        onRetry: (error) => console.warn(`[마이리얼트립] ${label} 일시 오류 재시도: ${error.message}`),
    });
}

export function parseMyrealtripBulkPayload(data: unknown): BulkLowestFare[] {
    if (!data || typeof data !== 'object' || !Array.isArray((data as any).lowestPriceInfoList)) {
        throw new SourceResponseError('schema-mismatch', '마이리얼트립 Bulk API 응답 구조가 바뀌었습니다.');
    }
    return (data as any).lowestPriceInfoList;
}

export function parseMyrealtripCalendarPayload(data: unknown): CalendarPrice[] {
    if (!data || typeof data !== 'object' || !Array.isArray((data as any).flightCalendarInfoResults)) {
        throw new SourceResponseError('schema-mismatch', '마이리얼트립 Calendar API 응답 구조가 바뀌었습니다.');
    }
    return (data as any).flightCalendarInfoResults;
}

async function fetchBulkLowestFares(departureCity: string): Promise<BulkLowestFare[]> {
    const data = await fetchMyrealtripJson('마이리얼트립 Bulk API', BULK_API_URL, {
        departureCity,
        period: -1,
        airlines: ['ALL'],
        transfer: -1,
    });
    return parseMyrealtripBulkPayload(data);
}

/**
 * 공개 캘린더 API — offers.k1 페이지와 동일한 API
 * 실시간 가격 반환, 인증 불필요
 */
async function fetchCalendarPrices(
    fromCity: string,
    toCity: string,
    departureDate: string,
): Promise<CalendarPrice[]> {
    const data = await fetchMyrealtripJson('마이리얼트립 Calendar API', CALENDAR_API_URL, {
        from: fromCity,
        to: toCity,
        departureDate,
        airlines: ['All'],
        period: 30,
        transfer: -1,
        international: true,
    });
    return parseMyrealtripCalendarPayload(data);
}

// ── 링크 생성 ──────────────────────────────────────────

function buildPartnerLink(arrCode: string, depDate: string, arrDate: string): string {
    const gid = ROUTE_GID_MAP[arrCode];
    let flightUrl: string;
    if (gid) {
        flightUrl = `https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=${gid}&depdt=${depDate}&arrdt=${arrDate}&cabin=Y&adult=1&child=0&infant=0`;
    } else {
        flightUrl = `https://www.myrealtrip.com/flights`;
    }
    return `${PARTNER_BRIDGE_BASE}?return_url=${encodeURIComponent(flightUrl)}&mylink_id=${PARTNER_LINK_ID}&utm_source=mktpartner&t_scope=86400`;
}

// ── 도시/지역 결정 ──────────────────────────────────────

function getCityName(fare: BulkLowestFare): string {
    if (CITY_NAME_MAP[fare.arrivalCity]) return CITY_NAME_MAP[fare.arrivalCity];
    if (fare.arrivalCityName?.length > 0) return fare.arrivalCityName;
    return fare.arrivalCity;
}

function getRegion(fare: BulkLowestFare, cityName: string): string {
    // 국가 코드가 가장 신뢰할 수 있는 신호다. (100% 채워져 있고, 대시보드 지역은
    // 국가 내에서 나뉘지 않는다.) 한글 도시명 충돌(예: 인도 코치 vs 일본 고치)을
    // 국가 코드로 원천 차단하기 위해 이름 매핑보다 먼저 적용한다.
    const byCountry = COUNTRY_REGION_MAP[fare.arrivalCountryCode];
    if (byCountry) return byCountry;

    // 국가 코드 매핑에 없는 나라(유럽·아프리카 등)는 도시명 매핑으로 보완한다.
    // '기타'로 매핑된 도시도 유효한 결과이므로 폴백하지 않는다.
    const baseCity = cityName.replace(/\([^)]+\)/g, '').trim();
    const regionByCity = lookupRegionByCity(baseCity) ?? lookupRegionByCity(cityName);
    if (regionByCity) return regionByCity;

    // 최후 폴백 — API의 arrivalRegion('동아시아')은 일본/중국을 구분하지 못하므로 마지막에만 쓴다.
    if (fare.arrivalRegion && API_REGION_MAP[fare.arrivalRegion]) return API_REGION_MAP[fare.arrivalRegion];
    return '기타';
}

// ── 메인 크롤링 ──────────────────────────────────────────

export async function scrapeMyrealtripWithDiagnostics(
    options: MyrealtripScrapeOptions = {},
): Promise<MyrealtripScrapeResult> {
    console.log('\n=== 마이리얼트립 크롤링 시작 (실시간 캘린더 API) ===');

    const allFlights: Flight[] = [];
    const processedKeys = new Set<string>();
    const successfulDepartureAirports: string[] = [];
    const emptyDepartureAirports: string[] = [];
    let calendarProcessed = 0;
    let calendarSucceeded = 0;
    let consecutiveCalendarEmpty = 0;

    for (const dep of DEPARTURE_CITIES) {
        console.log(`[마이리얼트립] ${dep.city}(${dep.cityCd}) 출발 조회 중...`);

        // 1단계: Bulk API로 도시 목록 가져오기
        const fares = await fetchBulkLowestFares(dep.cityCd);
        if (fares.length === 0) {
            emptyDepartureAirports.push(dep.cityCd);
            console.warn(`[마이리얼트립] ${dep.city} Bulk 목록 0건 — 다른 출발지 결과와 함께 판정합니다.`);
            if (dep !== DEPARTURE_CITIES[DEPARTURE_CITIES.length - 1]) {
                await delay(2_000 + Math.random() * 2_000);
            }
            continue;
        }
        successfulDepartureAirports.push(dep.cityCd);
        console.log(`[마이리얼트립] ${dep.city}: ${fares.length}개 도시 발견`);

        let collected = 0, filtered = 0, calendarUsed = 0, bulkFallback = 0;
        const today = new Date().toISOString().split('T')[0];

        // 2단계: 각 도시별 Calendar API로 실시간 최저가 조회
        for (const fare of fares) {
            const cityName = getCityName(fare);
            const region = getRegion(fare, cityName);

            // Calendar API 호출 (Bulk 출발일의 실제 가격 조회)
            const bulkDepDate = fare.departureDate || '';
            const bulkArrDate = fare.arrivalDate || '';
            if (!bulkDepDate) continue;

            const calPrices = await fetchCalendarPrices(dep.calendarFrom, fare.arrivalCity, today);
            calendarProcessed++;
            if (calPrices.length > 0) {
                calendarSucceeded++;
                consecutiveCalendarEmpty = 0;
            } else {
                consecutiveCalendarEmpty++;
            }
            assertNoSourceResponseCollapse('마이리얼트립 Calendar API', {
                processed: calendarProcessed,
                succeeded: calendarSucceeded,
                consecutiveFailures: consecutiveCalendarEmpty,
            }, {
                maxConsecutiveFailures: 12,
                minSamples: 20,
                minSuccessRatio: 0.1,
            });
            // 가격 조건이나 필드 문제로 아래에서 건너뛰더라도 모든 API 요청 뒤에는 쉰다.
            await delay(800 + Math.random() * 800);

            let price: number;
            let airline: string;

            // Calendar API에서 Bulk 출발일과 같은 날짜의 가격 찾기
            const matchingCal = calPrices.find(p => p.date === bulkDepDate);
            if (matchingCal) {
                price = matchingCal.price;
                const rawAirline = matchingCal.airline || '';
                airline = (rawAirline.length > 20 || rawAirline.includes('스케줄') || rawAirline.includes('기착')) 
                    ? '항공사 미정' : (rawAirline || '항공사 미정');
                calendarUsed++;
            } else if (calPrices.length > 0) {
                // 같은 날짜가 없으면 Calendar 최저가 사용 (날짜는 여전히 Bulk 기준)
                const cheapest = calPrices.reduce((a, b) => a.price < b.price ? a : b);
                price = cheapest.price;
                const rawAirline = cheapest.airline || '';
                airline = (rawAirline.length > 20 || rawAirline.includes('스케줄') || rawAirline.includes('기착')) 
                    ? '항공사 미정' : (rawAirline || '항공사 미정');
                calendarUsed++;
            } else {
                // Calendar API 데이터 없으면 Bulk API 가격 사용 (폴백)
                price = fare.totalPrice || 0;
                airline = '항공사 미정';
                bulkFallback++;
            }

            const depDate = bulkDepDate;
            if (price <= 0) continue;
            if (price > MAX_PRICE) { filtered++; continue; }

            // 귀국일: Bulk API의 arrivalDate 사용
            let arrDate: string;
            if (bulkArrDate) {
                arrDate = bulkArrDate;
            } else {
                const period = fare.period || 3;
                const depD = new Date(depDate);
                depD.setDate(depD.getDate() + period);
                arrDate = depD.toISOString().split('T')[0];
            }

            const key = `mrt|${dep.cityCd}|${fare.arrivalCity}`;
            if (processedKeys.has(key)) continue;
            processedKeys.add(key);

            const flight: Flight = {
                id: `mrt-${dep.cityCd}-${fare.arrivalCity}-${depDate.replace(/-/g, '')}-${price}`,
                source: 'myrealtrip',
                airline,
                departure: {
                    city: dep.city === '서울' ? '서울(인천)' : dep.city,
                    airport: dep.cityCd,
                    date: depDate,
                    time: '',
                },
                arrival: {
                    city: cityName,
                    airport: fare.arrivalCity,
                    date: arrDate,
                    time: '',
                },
                price,
                currency: 'KRW',
                link: buildPartnerLink(fare.arrivalCity, depDate, arrDate),
                searchLink: buildPartnerLink(fare.arrivalCity, depDate, arrDate),
                region,
            };

            allFlights.push(flight);
            collected++;

        }

        console.log(`[마이리얼트립] ${dep.city}: ${collected}개 수집, ${filtered}개 제외`);
        console.log(`  실시간 가격: ${calendarUsed}개 / Bulk 폴백: ${bulkFallback}개`);

        if (dep !== DEPARTURE_CITIES[DEPARTURE_CITIES.length - 1]) {
            await delay(2_000 + Math.random() * 2_000);
        }
    }

    const bulkCoverage = {
        successfulDepartureAirports,
        emptyDepartureAirports,
    };
    if (successfulDepartureAirports.length === 0) {
        throw new SourceResponseError(
            'soft-block',
            '마이리얼트립 모든 출발지의 Bulk 목록이 0건입니다.',
            200,
        );
    }

    const quickDepartureSeeds = appendMyrealtripDateSeedFlights(
        allFlights,
        options.dateCandidates || [],
    );
    if (quickDepartureSeeds.length > 0) {
        console.log(
            `[마이리얼트립] 빠른 출발 후보 ${quickDepartureSeeds.length}개를 실제 예약 화면 검증 대상으로 추가`,
        );
    }

    console.log(`\n[마이리얼트립] 완료: ${allFlights.length}개 항공편 수집`);
    if (emptyDepartureAirports.length > 0) {
        console.log(`[마이리얼트립] 원래 비어 있을 수 있는 출발지: ${emptyDepartureAirports.join(', ')}`);
    }
    return {
        flights: allFlights,
        bulkCoverage,
        quickDepartureSeedCount: quickDepartureSeeds.length,
    };
}

export async function scrapeMyrealtrip(): Promise<Flight[]> {
    const result = await scrapeMyrealtripWithDiagnostics();
    return result.flights;
}
