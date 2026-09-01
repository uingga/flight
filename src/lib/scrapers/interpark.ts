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

export interface InterparkBenchmark {
    timestamp: string;
    /** 출발지를 받지 않는 공식 추천 API의 화면상 기준. 기존 캐시에는 없을 수 있다. */
    originCity?: 'SEL';
    originAirports?: ['ICN', 'GMP'];
    prices: Record<string, Record<string, { lowest: number; avg: number; depDate: string; arrDate: string }>>;
    /** 도시별 월평균가를 마지막으로 정상 갱신한 시각 */
    cityUpdatedAt?: Record<string, string>;
    /** 빈 응답·일시 오류를 포함해 마지막으로 확인을 시도한 시각 */
    cityCheckedAt?: Record<string, string>;
    popularUpdatedAt?: string;
    refresh?: {
        planned: number;
        attempted: number;
        succeeded: number;
        empty: number;
        failed: number;
        popularRequested: boolean;
        stoppedReason?: 'access-restriction' | 'consecutive-failures' | 'response-collapse';
    };
}

export interface InterparkRefreshOptions {
    previousBenchmark?: InterparkBenchmark | null;
    maxCitiesPerRun?: number;
    now?: Date;
}

const DEFAULT_MAX_CITIES_PER_REFRESH = 25;
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
async function fetchMonthlyPrices(cityCode: string): Promise<InterparkMonthlyPrice[]> {
    const url = `https://travel.interpark.com/air/air-api/inpark-air-web-api/recommendations/cities/monthly-prices?destinationCity=${cityCode}`;
    const response = await fetchSourceText(`인터파크 ${cityCode} 월평균가`, url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
    }, 20_000);
    assertNoSourceAccessBlockText(`인터파크 ${cityCode} 월평균가`, response.text, response.finalUrl);

    try {
        const data = JSON.parse(response.text);
        if (!Array.isArray(data)) {
            throw new SourceResponseError(
                'schema-mismatch',
                `인터파크 ${cityCode} 월평균가 응답이 배열이 아닙니다.`,
                response.status,
                response.contentType,
            );
        }
        return data;
    } catch (error) {
        if (error instanceof SourceResponseError) throw error;
        throw new SourceResponseError(
            'malformed-json',
            `인터파크 ${cityCode} 월평균가 JSON을 해석하지 못했습니다.`,
            response.status,
            response.contentType,
        );
    }
}

/**
 * 인터파크 인기 도시 최저가 API 호출
 */
async function fetchPopularLowestPrices(): Promise<any[]> {
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
        return json.data;
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

function checkedAtMillis(benchmark: InterparkBenchmark | null | undefined, cityCode: string): number {
    const checkedAt = benchmark?.cityCheckedAt?.[cityCode]
        || (benchmark?.prices?.[cityCode] ? benchmark.timestamp : '');
    const parsed = new Date(checkedAt).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

/** 기존 데이터가 없는 도시를 먼저, 그다음 가장 오래 확인하지 않은 도시부터 고른다. */
export function planInterparkCityRefresh(
    destinationCityCodes: string[],
    previousBenchmark?: InterparkBenchmark | null,
    maxCitiesPerRun = DEFAULT_MAX_CITIES_PER_REFRESH,
): string[] {
    const unique = Array.from(new Set(destinationCityCodes.filter(Boolean)));
    unique.sort((a, b) => {
        const aMissing = previousBenchmark?.prices?.[a] ? 0 : 1;
        const bMissing = previousBenchmark?.prices?.[b] ? 0 : 1;
        if (aMissing !== bMissing) return bMissing - aMissing;
        const checkedDiff = checkedAtMillis(previousBenchmark, a) - checkedAtMillis(previousBenchmark, b);
        return checkedDiff || a.localeCompare(b);
    });
    return unique.slice(0, Math.max(1, Math.floor(maxCitiesPerRun)));
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

/**
 * 인터파크 가격 벤치마크 순환 갱신.
 * 기존 도시 가격은 보존하고 한 회차에 오래된 일부 도시만 천천히 다시 확인한다.
 */
export async function scrapeInterparkBenchmark(
    destinationCityCodes?: string[],
    options: InterparkRefreshOptions = {},
): Promise<InterparkBenchmark> {
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

    const previous = options.previousBenchmark || null;
    const now = options.now || new Date();
    const nowIso = now.toISOString();
    const configuredLimit = options.maxCitiesPerRun
        ?? Number(process.env.INTERPARK_MAX_CITIES_PER_REFRESH || DEFAULT_MAX_CITIES_PER_REFRESH);
    const maxCitiesPerRun = Number.isFinite(configuredLimit)
        ? Math.max(1, Math.floor(configuredLimit))
        : DEFAULT_MAX_CITIES_PER_REFRESH;
    const plannedCities = planInterparkCityRefresh(
        Array.from(targetCities),
        previous,
        maxCitiesPerRun,
    );

    console.log(
        `[인터파크] 전체 ${targetCities.size}개 중 오래된 ${plannedCities.length}개만 순환 갱신: `
        + plannedCities.join(', '),
    );

    const prices: InterparkBenchmark['prices'] = clonePrices(previous?.prices);
    const cityUpdatedAt: Record<string, string> = { ...(previous?.cityUpdatedAt || {}) };
    const cityCheckedAt: Record<string, string> = { ...(previous?.cityCheckedAt || {}) };
    if (previous?.timestamp) {
        for (const cityCode of Object.keys(previous.prices || {})) {
            cityUpdatedAt[cityCode] ||= previous.timestamp;
            cityCheckedAt[cityCode] ||= previous.timestamp;
        }
    }

    let attemptedCount = 0;
    let successCount = 0;
    let emptyCount = 0;
    let failedCount = 0;
    let consecutiveFailures = 0;
    let consecutiveKnownEmpty = 0;
    let stoppedReason: 'access-restriction' | 'consecutive-failures' | 'response-collapse' | undefined;

    // 한 번에 25개만 순차 호출하고, 매 요청과 10개 단위 사이에 충분히 쉰다.
    for (let index = 0; index < plannedCities.length; index++) {
        const cityCode = plannedCities[index];
        attemptedCount++;
        cityCheckedAt[cityCode] = nowIso;
        try {
            const monthlyPrices = await fetchMonthlyPrices(cityCode);
            if (monthlyPrices.length === 0) {
                emptyCount++;
                const hadPreviousData = Boolean(previous?.prices?.[cityCode]);
                consecutiveFailures = 0;
                consecutiveKnownEmpty = hadPreviousData ? consecutiveKnownEmpty + 1 : 0;
                console.log(`[인터파크] ${cityCode}: 월평균가 없음 — 기존 값 유지`);
                if (consecutiveKnownEmpty >= MAX_CONSECUTIVE_FAILURES) {
                    stoppedReason = 'response-collapse';
                    console.warn('[인터파크] 기존 데이터가 있던 3개 도시가 연속으로 비었습니다 — 남은 요청을 중단합니다.');
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
                    prices[cityCode] = nextCityPrices;
                    cityUpdatedAt[cityCode] = nowIso;
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
                `[인터파크] ${cityCode} 갱신 실패 — 기존 값 유지: `
                + (error instanceof Error ? error.message : String(error)),
            );
            if (isAccessRestriction(error)) {
                stoppedReason = 'access-restriction';
                console.warn('[인터파크] 접근 제한 신호 감지 — 인기 도시 요청과 남은 도시 갱신을 중단합니다.');
                break;
            }
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                stoppedReason = 'consecutive-failures';
                console.warn(`[인터파크] ${MAX_CONSECUTIVE_FAILURES}개 도시 연속 실패 — 남은 요청을 중단합니다.`);
                break;
            }
        }

        if (index < plannedCities.length - 1) {
            await randomDelay(1.2, 2.4);
            if ((index + 1) % 10 === 0) await randomDelay(8, 15);
        }
    }

    // 여러 인기 도시를 한 응답으로 주는 묶음 API다. 접근 제한 신호가 없을 때만 딱 한 번 호출한다.
    let popularUpdatedAt = previous?.popularUpdatedAt;
    let popularRequested = false;
    if (!stoppedReason) {
        try {
            await randomDelay(3, 6);
            popularRequested = true;
            const popularPrices = await fetchPopularLowestPrices();
            for (const pp of popularPrices) {
                const cityCode = pp.destinationCity?.code;
                if (cityCode && prices[cityCode]) {
                    const yearMonth = pp.outboundDate?.substring(0, 7);
                    if (yearMonth && prices[cityCode][yearMonth]) {
                        const existingLowest = prices[cityCode][yearMonth].lowest;
                        if (pp.price < existingLowest) {
                            prices[cityCode][yearMonth].lowest = pp.price;
                            prices[cityCode][yearMonth].depDate = pp.outboundDate;
                            prices[cityCode][yearMonth].arrDate = pp.inboundDate;
                        }
                    }
                }
            }
            popularUpdatedAt = nowIso;
        } catch (error) {
            console.warn(
                '[인터파크] 인기 도시 묶음 갱신 실패 — 기존 값 유지: '
                + (error instanceof Error ? error.message : String(error)),
            );
        }
    }

    const benchmark: InterparkBenchmark = {
        timestamp: nowIso,
        originCity: 'SEL',
        originAirports: ['ICN', 'GMP'],
        prices,
        cityUpdatedAt,
        cityCheckedAt,
        ...(popularUpdatedAt ? { popularUpdatedAt } : {}),
        refresh: {
            planned: plannedCities.length,
            attempted: attemptedCount,
            succeeded: successCount,
            empty: emptyCount,
            failed: failedCount,
            popularRequested,
            ...(stoppedReason ? { stoppedReason } : {}),
        },
    };

    console.log(
        `[인터파크] 순환 갱신 완료: 계획 ${plannedCities.length}개, 실제 도시 요청 ${attemptedCount}, `
        + `성공 ${successCount}, 빈 응답 ${emptyCount}, 실패 ${failedCount}, `
        + `인기 도시 요청 ${popularRequested ? 1 : 0}, 전체 보존 ${Object.keys(prices).length}개 도시`,
    );

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
