import {
    assertNoSourceAccessBlockText,
    fetchSourceText,
    isExplicitAccessRestrictionStatus,
    SourceResponseError,
} from './source-response';

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

export interface InterparkPopularLowestRoute {
    originCity: {
        code: 'SEL';
        name: string;
    };
    destinationCity: {
        code: string;
        name: string;
    };
    tripType: 'ROUND_TRIP';
    isDirect: boolean;
    outboundDate: string;
    inboundDate: string;
    airlineCode: string;
    price: number;
}

export interface InterparkBenchmark {
    timestamp: string;
    /** 이전 서울 전용 캐시·소비자 호환용. 새 수집은 pricesByOrigin.SEL에도 같은 값을 둔다. */
    originCity?: 'SEL';
    originAirports?: ['ICN', 'GMP'];
    prices: Record<string, Record<string, { lowest: number; avg: number; depDate: string; arrDate: string }>>;
    /** 출발 권역별 월별 가격. 키 형식: 출발 도시 코드 → 도착 도시 코드 → YYYY-MM. */
    pricesByOrigin?: Record<string, InterparkBenchmark['prices']>;
    /** 도시별 월평균가를 마지막으로 정상 갱신한 시각 */
    cityUpdatedAt?: Record<string, string>;
    /** 빈 응답·일시 오류를 포함해 마지막으로 확인을 시도한 시각 */
    cityCheckedAt?: Record<string, string>;
    /** 출발지까지 포함한 마지막 정상 갱신 시각. 키 형식: SEL|FUK */
    pairUpdatedAt?: Record<string, string>;
    /** 빈 응답·일시 오류를 포함한 출발지별 마지막 확인 시각. 키 형식: SEL|FUK */
    pairCheckedAt?: Record<string, string>;
    /** 과거 캐시 호환용. 새 수집은 이 값을 월별 기준가 파일에 저장하지 않는다. */
    popularLowestRoutes?: InterparkPopularLowestRoute[];
    /** 과거 캐시 호환용. */
    popularUpdatedAt?: string;
    refresh?: {
        planned: number;
        attempted: number;
        succeeded: number;
        empty: number;
        failed: number;
        stoppedReason?: 'access-restriction' | 'consecutive-failures' | 'response-collapse';
    };
}

export interface InterparkRefreshOptions {
    previousBenchmark?: InterparkBenchmark | null;
    maxPairsPerRun?: number;
    /** @deprecated maxPairsPerRun을 사용한다. 기존 호출 호환용. */
    maxCitiesPerRun?: number;
    now?: Date;
    pairTtlMs?: number;
}

export interface InterparkRouteTarget {
    originCity: string;
    destinationCity: string;
}

const DEFAULT_MAX_PAIRS_PER_REFRESH = 5;
export const DEFAULT_INTERPARK_PAIR_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const randomDelay = (minSeconds: number, maxSeconds: number) =>
    new Promise(resolve => setTimeout(
        resolve,
        (Math.random() * (maxSeconds - minSeconds) + minSeconds) * 1000,
    ));

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
    // 땡처리닷컴 추가
    'TAO': 'TAO',  // 칭다오
    'YNT': 'YNT',  // 옌타이
    'WEH': 'WEH',  // 웨이하이
    'HKD': 'HKD',  // 하코다테
    'PVG': 'PVG',  // 상해 푸동
    'KKJ': 'KKJ',  // 기타큐슈
    'UKB': 'UKB',  // 고베
    'KHH': 'KHH',  // 카오슝
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
    // 땡처리닷컴 추가 도시
    '칭다오': 'TAO', '청도': 'TAO',
    '옌타이': 'YNT', '연태': 'YNT',
    '웨이하이': 'WEH', '위해': 'WEH',
    '하코다테': 'HKD',
    '상해': 'PVG', '푸동': 'PVG',
    '기타큐슈': 'KKJ',
    '고베': 'UKB',
    '카오슝': 'KHH',
    '삼아': 'SYX',
};

/**
 * 인터파크 월별 최저가 API 호출
 */
async function fetchMonthlyPrices(originCity: string, cityCode: string): Promise<InterparkMonthlyPrice[]> {
    const params = new URLSearchParams({ originCity, destinationCity: cityCode });
    const url = `https://travel.interpark.com/air/air-api/inpark-air-web-api/recommendations/cities/monthly-prices?${params}`;
    const label = `인터파크 ${originCity}→${cityCode} 월평균가`;
    const response = await fetchSourceText(label, url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
    }, 20_000);
    assertNoSourceAccessBlockText(label, response.text, response.finalUrl);

    try {
        const data = JSON.parse(response.text);
        if (!Array.isArray(data)) {
            throw new SourceResponseError(
                'schema-mismatch',
                `${label} 응답이 배열이 아닙니다.`,
                response.status,
                response.contentType,
            );
        }
        return data.filter((item): item is InterparkMonthlyPrice => {
            if (!item || typeof item !== 'object') return false;
            const row = item as InterparkMonthlyPrice;
            return /^\d{4}-\d{2}$/.test(String(row.yearMonth || ''))
                && Number.isFinite(Number(row.averagePrice))
                && Number(row.averagePrice) > 0
                && Number.isFinite(Number(row.lowestPrice?.price))
                && Number(row.lowestPrice?.price) > 0
                && /^\d{4}-\d{2}-\d{2}$/.test(String(row.lowestPrice?.departureDate || ''))
                && /^\d{4}-\d{2}-\d{2}$/.test(String(row.lowestPrice?.arrivalDate || ''));
        });
    } catch (error) {
        if (error instanceof SourceResponseError) throw error;
        throw new SourceResponseError(
            'malformed-json',
            `${label} JSON을 해석하지 못했습니다.`,
            response.status,
            response.contentType,
        );
    }
}

/**
 * 인터파크 인기 도시 최저가 API 호출
 */
export function normalizePopularLowestRoutes(value: unknown): InterparkPopularLowestRoute[] {
    if (!Array.isArray(value)) return [];

    const routes = new Map<string, InterparkPopularLowestRoute>();
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const originCity = item.originCity as Record<string, unknown> | undefined;
        const destinationCity = item.destinationCity as Record<string, unknown> | undefined;
        const outboundDate = typeof item.outboundDate === 'string' ? item.outboundDate : '';
        const inboundDate = typeof item.inboundDate === 'string' ? item.inboundDate : '';
        const airlineCode = typeof item.airlineCode === 'string' ? item.airlineCode.trim() : '';
        const price = typeof item.price === 'number' ? item.price : Number.NaN;

        if (originCity?.code !== 'SEL'
            || typeof originCity.name !== 'string'
            || typeof destinationCity?.code !== 'string'
            || typeof destinationCity.name !== 'string'
            || item.tripType !== 'ROUND_TRIP'
            || typeof item.isDirect !== 'boolean'
            || !/^\d{4}-\d{2}-\d{2}$/.test(outboundDate)
            || !/^\d{4}-\d{2}-\d{2}$/.test(inboundDate)
            || !airlineCode
            || !Number.isFinite(price)
            || price <= 0) {
            continue;
        }

        const route: InterparkPopularLowestRoute = {
            originCity: { code: 'SEL', name: originCity.name },
            destinationCity: {
                code: destinationCity.code,
                name: destinationCity.name,
            },
            tripType: 'ROUND_TRIP',
            isDirect: item.isDirect,
            outboundDate,
            inboundDate,
            airlineCode,
            price,
        };
        const key = [
            route.originCity.code,
            route.destinationCity.code,
            route.outboundDate,
            route.inboundDate,
            route.airlineCode,
        ].join('|');
        const previous = routes.get(key);
        if (!previous || route.price < previous.price) routes.set(key, route);
    }

    return Array.from(routes.values());
}

/**
 * 인터파크 메인의 '빠르게 떠나는 최저가 해외항공'을 그 시점에 한 번 읽는다.
 * 월별 기준가와 합치거나 파일에 저장하지 않고, 마이리얼트립 회차의 추가 날짜 후보로만 쓴다.
 */
export async function fetchInterparkPopularLowestRoutes(): Promise<InterparkPopularLowestRoute[]> {
    const url = 'https://travel.interpark.com/air/air-api/inpark-air/search/international/recommendations/popular-cities/lowest-price';
    const response = await fetchSourceText('인터파크 인기 도시 묶음 최저가', url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
    }, 20_000);
    assertNoSourceAccessBlockText('인터파크 인기 도시 묶음 최저가', response.text, response.finalUrl);

    try {
        const json = JSON.parse(response.text);
        if (!json || !Array.isArray(json.data)) {
            throw new SourceResponseError(
                'schema-mismatch',
                '인터파크 인기 도시 묶음 응답에 data 배열이 없습니다.',
                response.status,
                response.contentType,
            );
        }
        const routes = normalizePopularLowestRoutes(json.data);
        if (json.data.length === 0 || routes.length === 0) {
            throw new SourceResponseError(
                'schema-mismatch',
                '인터파크 인기 도시 묶음 응답에 사용할 수 있는 왕복 항공권이 없습니다.',
                response.status,
                response.contentType,
            );
        }
        return routes;
    } catch (error) {
        if (error instanceof SourceResponseError) throw error;
        throw new SourceResponseError(
            'malformed-json',
            '인터파크 인기 도시 묶음 JSON을 해석하지 못했습니다.',
            response.status,
            response.contentType,
        );
    }
}

export function interparkPairKey(originCity: string, destinationCity: string): string {
    return `${originCity.trim().toUpperCase()}|${destinationCity.trim().toUpperCase()}`;
}

function routePrices(
    benchmark: InterparkBenchmark | null | undefined,
    originCity: string,
    destinationCity: string,
) {
    return benchmark?.pricesByOrigin?.[originCity]?.[destinationCity]
        || (originCity === 'SEL' ? benchmark?.prices?.[destinationCity] : undefined);
}

function checkedAtMillis(
    benchmark: InterparkBenchmark | null | undefined,
    target: InterparkRouteTarget,
): number {
    const key = interparkPairKey(target.originCity, target.destinationCity);
    const checkedAt = benchmark?.pairCheckedAt?.[key]
        || (target.originCity === 'SEL' ? benchmark?.cityCheckedAt?.[target.destinationCity] : '')
        || (routePrices(benchmark, target.originCity, target.destinationCity) ? benchmark?.timestamp : '');
    const parsed = new Date(checkedAt || '').getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

/** 신규 조합을 먼저, 이후 14일이 지난 조합을 가장 오래 확인하지 않은 순서로 고른다. */
export function planInterparkPairRefresh(
    routeTargets: InterparkRouteTarget[],
    previousBenchmark?: InterparkBenchmark | null,
    maxPairsPerRun = DEFAULT_MAX_PAIRS_PER_REFRESH,
    now = new Date(),
    pairTtlMs = DEFAULT_INTERPARK_PAIR_TTL_MS,
): InterparkRouteTarget[] {
    const uniqueByKey = new Map<string, InterparkRouteTarget>();
    for (const raw of routeTargets) {
        const originCity = String(raw.originCity || '').trim().toUpperCase();
        const destinationCity = airportToCityCode(String(raw.destinationCity || '').trim().toUpperCase());
        if (!originCity || !destinationCity || originCity === destinationCity) continue;
        uniqueByKey.set(interparkPairKey(originCity, destinationCity), { originCity, destinationCity });
    }
    const unique = Array.from(uniqueByKey.values()).filter(target => {
        if (!routePrices(previousBenchmark, target.originCity, target.destinationCity)) return true;
        const checkedAt = checkedAtMillis(previousBenchmark, target);
        return checkedAt <= 0 || now.getTime() - checkedAt >= pairTtlMs;
    });
    unique.sort((a, b) => {
        const aMissing = routePrices(previousBenchmark, a.originCity, a.destinationCity) ? 0 : 1;
        const bMissing = routePrices(previousBenchmark, b.originCity, b.destinationCity) ? 0 : 1;
        if (aMissing !== bMissing) return bMissing - aMissing;
        const checkedDiff = checkedAtMillis(previousBenchmark, a) - checkedAtMillis(previousBenchmark, b);
        return checkedDiff || interparkPairKey(a.originCity, a.destinationCity)
            .localeCompare(interparkPairKey(b.originCity, b.destinationCity));
    });
    return unique.slice(0, Math.max(0, Math.floor(maxPairsPerRun)));
}

/** 기존 서울 전용 호출·테스트 호환용. */
export function planInterparkCityRefresh(
    destinationCityCodes: string[],
    previousBenchmark?: InterparkBenchmark | null,
    maxCitiesPerRun = DEFAULT_MAX_PAIRS_PER_REFRESH,
    now = new Date(),
    pairTtlMs = DEFAULT_INTERPARK_PAIR_TTL_MS,
): string[] {
    return planInterparkPairRefresh(
        destinationCityCodes.map(destinationCity => ({ originCity: 'SEL', destinationCity })),
        previousBenchmark,
        maxCitiesPerRun,
        now,
        pairTtlMs,
    ).map(target => target.destinationCity);
}

function isAccessRestriction(error: unknown): boolean {
    return error instanceof SourceResponseError
        && (isExplicitAccessRestrictionStatus(error.status)
            || error.kind === 'html-response'
            || error.kind === 'soft-block');
}

function clonePrices(prices: InterparkBenchmark['prices'] | undefined): InterparkBenchmark['prices'] {
    return JSON.parse(JSON.stringify(prices || {}));
}

function clonePricesByOrigin(previous?: InterparkBenchmark | null): NonNullable<InterparkBenchmark['pricesByOrigin']> {
    const cloned = JSON.parse(JSON.stringify(previous?.pricesByOrigin || {}));
    cloned.SEL = { ...clonePrices(previous?.prices), ...(cloned.SEL || {}) };
    return cloned;
}

/**
 * 인터파크 가격 벤치마크 순환 갱신.
 * 기존 도시 가격은 보존하고 한 회차에 오래된 일부 도시만 천천히 다시 확인한다.
 */
export async function scrapeInterparkBenchmark(
    routeTargets?: InterparkRouteTarget[] | string[],
    options: InterparkRefreshOptions = {},
): Promise<InterparkBenchmark> {
    console.log('\n=== 인터파크 가격 벤치마크 수집 시작 ===');

    const targets: InterparkRouteTarget[] = [];
    if (routeTargets && routeTargets.length > 0) {
        for (const target of routeTargets) {
            if (typeof target === 'string') {
                targets.push({ originCity: 'SEL', destinationCity: airportToCityCode(target) });
            } else {
                targets.push({
                    originCity: target.originCity,
                    destinationCity: airportToCityCode(target.destinationCity),
                });
            }
        }
    } else {
        Object.values(AIRPORT_TO_CITY).forEach(destinationCity => {
            targets.push({ originCity: 'SEL', destinationCity });
        });
    }

    const previous = options.previousBenchmark || null;
    const now = options.now || new Date();
    const nowIso = now.toISOString();
    const configuredLimit = options.maxPairsPerRun
        ?? options.maxCitiesPerRun
        ?? Number(process.env.INTERPARK_MAX_PAIRS_PER_REFRESH || DEFAULT_MAX_PAIRS_PER_REFRESH);
    const maxPairsPerRun = Number.isFinite(configuredLimit)
        ? Math.max(1, Math.floor(configuredLimit))
        : DEFAULT_MAX_PAIRS_PER_REFRESH;
    const pairTtlMs = options.pairTtlMs ?? DEFAULT_INTERPARK_PAIR_TTL_MS;
    const plannedPairs = planInterparkPairRefresh(
        targets,
        previous,
        maxPairsPerRun,
        now,
        pairTtlMs,
    );
    const targetPairCount = new Set(targets.map(target => interparkPairKey(
        target.originCity,
        airportToCityCode(target.destinationCity),
    ))).size;

    console.log(
        `[인터파크] 전체 ${targetPairCount}개 출발지·도착지 조합 중 갱신 대상 ${plannedPairs.length}개: `
        + (plannedPairs.map(target => interparkPairKey(target.originCity, target.destinationCity)).join(', ') || '없음'),
    );

    const pricesByOrigin = clonePricesByOrigin(previous);
    const prices: InterparkBenchmark['prices'] = pricesByOrigin.SEL;
    const cityUpdatedAt: Record<string, string> = { ...(previous?.cityUpdatedAt || {}) };
    const cityCheckedAt: Record<string, string> = { ...(previous?.cityCheckedAt || {}) };
    const pairUpdatedAt: Record<string, string> = { ...(previous?.pairUpdatedAt || {}) };
    const pairCheckedAt: Record<string, string> = { ...(previous?.pairCheckedAt || {}) };
    if (previous?.timestamp) {
        for (const cityCode of Object.keys(previous.prices || {})) {
            cityUpdatedAt[cityCode] ||= previous.timestamp;
            cityCheckedAt[cityCode] ||= previous.timestamp;
            pairUpdatedAt[interparkPairKey('SEL', cityCode)] ||= cityUpdatedAt[cityCode];
            pairCheckedAt[interparkPairKey('SEL', cityCode)] ||= cityCheckedAt[cityCode];
        }
    }

    let attemptedCount = 0;
    let successCount = 0;
    let emptyCount = 0;
    let failedCount = 0;
    let consecutiveFailures = 0;
    let consecutiveKnownEmpty = 0;
    let stoppedReason: 'access-restriction' | 'consecutive-failures' | 'response-collapse' | undefined;

    for (let index = 0; index < plannedPairs.length; index++) {
        const { originCity, destinationCity: cityCode } = plannedPairs[index];
        const pairKey = interparkPairKey(originCity, cityCode);
        attemptedCount++;
        pairCheckedAt[pairKey] = nowIso;
        if (originCity === 'SEL') cityCheckedAt[cityCode] = nowIso;
        try {
            const monthlyPrices = await fetchMonthlyPrices(originCity, cityCode);
            if (monthlyPrices.length === 0) {
                emptyCount++;
                const hadPreviousData = Boolean(routePrices(previous, originCity, cityCode));
                consecutiveFailures = 0;
                consecutiveKnownEmpty = hadPreviousData ? consecutiveKnownEmpty + 1 : 0;
                console.log(`[인터파크] ${pairKey}: 월평균가 없음 — 기존 값 유지`);
                if (consecutiveKnownEmpty >= MAX_CONSECUTIVE_FAILURES) {
                    stoppedReason = 'response-collapse';
                    console.warn('[인터파크] 기존 데이터가 있던 3개 조합이 연속으로 비었습니다 — 남은 요청을 중단합니다.');
                    break;
                }
            } else {
                const nextCityPrices: InterparkBenchmark['prices'][string] = {};
                for (const mp of monthlyPrices) {
                    if (!mp.lowestPrice) continue;
                    nextCityPrices[mp.yearMonth] = {
                        lowest: mp.lowestPrice.price,
                        avg: mp.averagePrice,
                        depDate: mp.lowestPrice.departureDate,
                        arrDate: mp.lowestPrice.arrivalDate,
                    };
                }
                if (Object.keys(nextCityPrices).length > 0) {
                    pricesByOrigin[originCity] ||= {};
                    pricesByOrigin[originCity][cityCode] = nextCityPrices;
                    pairUpdatedAt[pairKey] = nowIso;
                    if (originCity === 'SEL') cityUpdatedAt[cityCode] = nowIso;
                    successCount++;
                } else {
                    emptyCount++;
                }
                consecutiveFailures = 0;
                consecutiveKnownEmpty = 0;
            }
        } catch (error) {
            failedCount++;
            consecutiveFailures++;
            consecutiveKnownEmpty = 0;
            console.warn(
                `[인터파크] ${pairKey} 갱신 실패 — 기존 값 유지: `
                + (error instanceof Error ? error.message : String(error)),
            );
            if (isAccessRestriction(error)) {
                stoppedReason = 'access-restriction';
                console.warn('[인터파크] 접근 제한 신호 감지 — 인기 도시 요청과 남은 도시 갱신을 중단합니다.');
                break;
            }
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                stoppedReason = 'consecutive-failures';
                console.warn(`[인터파크] ${MAX_CONSECUTIVE_FAILURES}개 조합 연속 실패 — 남은 요청을 중단합니다.`);
                break;
            }
        }

        if (index < plannedPairs.length - 1) {
            await randomDelay(1.2, 2.4);
            if ((index + 1) % 10 === 0) await randomDelay(8, 15);
        }
    }

    const benchmark: InterparkBenchmark = {
        timestamp: nowIso,
        originCity: 'SEL',
        originAirports: ['ICN', 'GMP'],
        prices,
        pricesByOrigin,
        cityUpdatedAt,
        cityCheckedAt,
        pairUpdatedAt,
        pairCheckedAt,
        refresh: {
            planned: plannedPairs.length,
            attempted: attemptedCount,
            succeeded: successCount,
            empty: emptyCount,
            failed: failedCount,
            ...(stoppedReason ? { stoppedReason } : {}),
        },
    };

    console.log(
        `[인터파크] 순환 갱신 완료: 계획 ${plannedPairs.length}개, 실제 조합 요청 ${attemptedCount}, `
        + `성공 ${successCount}, 빈 응답 ${emptyCount}, 실패 ${failedCount}, `
        + `전체 보존 ${Object.values(pricesByOrigin).reduce((sum, value) => sum + Object.keys(value).length, 0)}개 조합`,
    );

    // 요약 출력
    let totalRoutes = 0;
    for (const originPrices of Object.values(pricesByOrigin)) {
        for (const city of Object.keys(originPrices)) totalRoutes += Object.keys(originPrices[city]).length;
    }
    console.log(`[인터파크] 총 ${totalRoutes}개 월별 가격 데이터 수집`);

    return benchmark;
}

/**
 * 항공편 도시명에서 인터파크 도시코드를 추출
 * "오사카(KIX)", "오사카(간사이)", "나트랑", "도쿄(NRT)" 등 모든 형식 지원
 */
export function resolveCityCode(cityString: string, airportCode?: string): string | null {
    if (!cityString && !airportCode) return null;

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

    // 5. fallback: 항공편 데이터의 공항코드를 직접 사용
    if (airportCode) {
        return AIRPORT_TO_CITY[airportCode] || airportCode;
    }

    return null;
}

/**
 * 공항코드를 인터파크 도시코드로 변환 (하위 호환)
 */
export function airportToCityCode(airportCode: string): string {
    return AIRPORT_TO_CITY[airportCode] || airportCode;
}

/** 인터파크 월별 API가 받는 국내 출발 도시 코드로 정규화한다. */
export function resolveInterparkOriginCityCode(
    departureCity?: string,
    departureAirport?: string,
): string | null {
    const airport = String(departureAirport || '').trim().toUpperCase();
    if (airport === 'ICN' || airport === 'GMP' || airport === 'SEL') return 'SEL';
    if (['PUS', 'CJJ', 'TAE', 'CJU', 'MWX'].includes(airport)) return airport;
    if (/^[A-Z]{3}$/.test(airport)) return null;

    const city = String(departureCity || '').replace(/\s+/g, '');
    if (/서울|인천|김포/.test(city)) return 'SEL';
    if (/부산|김해/.test(city)) return 'PUS';
    if (/청주/.test(city)) return 'CJJ';
    if (/대구/.test(city)) return 'TAE';
    if (/제주/.test(city)) return 'CJU';
    if (/무안/.test(city)) return 'MWX';
    return null;
}
