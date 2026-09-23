import { resolveCityCode } from '../../src/lib/scrapers/interpark';
import { getInterparkRouteMonths, isInterparkBenchmarkApplicable } from '../../src/lib/interpark-benchmark';
import { getRecommendationFreshness } from '../../src/lib/flight-recommendation';
import { buildNaverPriceKey, getExactRouteAirports, formatNaverRoute } from '../../src/lib/naver-route';
import { buildNaverSourceSignature, getNaverSourcePrice, type NaverRefreshConfig, type NaverRefreshReason } from '../../src/lib/naver-refresh-policy';
import { selectNaverCrawlCandidates, type NaverCrawlPriorityGroup } from '../../src/lib/naver-crawl-priority';
import { type NaverCrawlPageState } from '../../src/lib/naver-crawl-page-state';
interface FlightData {
    departure: { airport: string; city: string; date: string; time?: string; arrivalTime?: string };
    arrival: { airport: string; city: string; date: string; time?: string; arrivalTime?: string };
    price: number;
    airline: string;
    flightNumber?: string;
    source: string;
    discountRate?: number;
    priceCheckedAt?: string;
    firstSeen?: string;
    routeAirports?: {
        outboundDeparture: string;
        outboundArrival: string;
        returnDeparture: string;
        returnArrival: string;
    };
}

interface NaverPriceEntry {
    naverLowest?: number;
    crawledAt?: string;
    route?: string;
    depDate?: string;
    retDate?: string;
    lastAttemptAt?: string;
    sameDayRecheckAt?: string;
    lastAttemptStatus?: 'success' | 'miss' | Exclude<NaverCrawlPageState, 'results'>;
    lastAttemptDetail?: string;
    lastFinalUrl?: string;
    sourceSignature?: string;
    sourcePrice?: number;
    firstQueuedAt?: string;
}

const normalizeDate = (dateStr: string): string => {
    // 다양한 날짜 포맷을 YYYY-MM-DD로 통일
    const clean = dateStr.replace(/\(.*\)/g, '').replace(/\s/g, '').trim();

    // "2026.03.03" → "2026-03-03"
    if (clean.includes('.')) {
        const parts = clean.split('.');
        if (parts.length >= 3) {
            return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
    }

    // 이미 "2026-03-03" 형태
    return clean.substring(0, 10);
};


interface InterparkMonthPrice { avg: number; lowest: number }
export function createNaverSelection(options: {
 refreshConfig: NaverRefreshConfig; topCandidateCount: number; lowCandidateRatio: number;
 maxDeferDays: number; benchmark?: any; clock?: () => number;
}) {
 const REFRESH_CONFIG = options.refreshConfig;
 const TOP_CANDIDATE_COUNT = options.topCandidateCount;
 const LOW_CANDIDATE_RATIO = options.lowCandidateRatio;
 const MAX_DEFER_DAYS = options.maxDeferDays;
 const interparkBenchmark = options.benchmark || {};
 const clock = options.clock || Date.now;
function flightKey(f: FlightData): string {
    return buildNaverPriceKey(f, f.departure.date, f.arrival.date) || '';
}

/** 오래된 네이버 값을 제외하고 실제 추천순과 같은 방향으로 후보 가치를 계산한다. */
function provisionalRecommendationScore(flight: FlightData): number {
    const effectivePrice = getNaverSourcePrice(flight);
    const route = getExactRouteAirports(flight);
    const cityCode = resolveCityCode(
        flight.arrival.city,
        route?.outboundArrival || flight.arrival.airport,
    );
    const departureMonth = normalizeDate(flight.departure.date).substring(0, 7);
    const cityData = isInterparkBenchmarkApplicable(flight) && cityCode
        ? getInterparkRouteMonths(flight, interparkBenchmark) as Record<string, InterparkMonthPrice> | undefined
        : undefined;
    let benchmark = cityData?.[departureMonth];
    if (!benchmark && cityData) {
        const closestMonth = Object.keys(cityData).sort().reduce((best, candidateMonth) => {
            const difference = Math.abs(candidateMonth.localeCompare(departureMonth));
            const bestDifference = best ? Math.abs(best.localeCompare(departureMonth)) : Infinity;
            return difference < bestDifference ? candidateMonth : best;
        }, '');
        if (closestMonth) benchmark = cityData[closestMonth];
    }

    let score = effectivePrice;
    if (!benchmark) score *= 1.1;
    else if (effectivePrice <= benchmark.lowest) score *= 1;
    else if (effectivePrice <= benchmark.lowest * 1.2) score *= 1.15;
    else if (effectivePrice < benchmark.avg) score *= 1.3;
    else score *= 10;

    score *= getRecommendationFreshness(flight.priceCheckedAt).multiplier;
    return score;
}

/**
 * 노선 중복 제거(같은 노선+날짜는 최저가 1건) 후,
 * 오래된 네이버 값을 제외한 임시 추천순으로 하루 검색 대상을 정한다.
 *
 * 우선순위: 7일 마감 → 신규·가격 변경 추천 상위 → 추천 상위 → 보통 → 추천 하위.
 * 같은 그룹 안에서는 동일 노선이 최대 2건까지만 연속되게 분산한다.
 *
 * 차단으로 조기 철수하더라도 가치 있는 노선부터 커버되도록 하기 위함.
 */
function selectFlightsByPriority(
    flights: FlightData[],
    naverPrices: Record<string, NaverPriceEntry>,
    limit: number
): {
    selected: FlightData[];
    pending: FlightData[];
    skippedFresh: number;
    seededSignatures: number;
    reasonCounts: Record<NaverRefreshReason, number>;
    groupCounts: Record<NaverCrawlPriorityGroup, number>;
    selectedGroupCounts: Record<NaverCrawlPriorityGroup, number>;
    priorityByKey: Map<string, NaverCrawlPriorityGroup>;
    candidateCount: number;
} {
    const seen = new Set<string>();
    const unique = [...flights]
        .filter(f => f.price > 0 && Boolean(flightKey(f)))
        .sort((a, b) => getNaverSourcePrice(a) - getNaverSourcePrice(b)) // 같은 노선+날짜 중복 시 실결제가 최저 유지
        .filter(f => {
            const key = flightKey(f);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

    const now = clock();
    let seededSignatures = 0;

    // 기존 기록에는 여행사 실결제가 기준값이 없으므로 현재 최저가 항공권을 기준선으로만
    // 저장한다. crawledAt은 건드리지 않아 오래된 네이버 가격을 새것으로 가장하지 않는다.
    for (const flight of unique) {
        const key = flightKey(flight);
        const entry = naverPrices[key];
        if (entry && (!entry.sourceSignature || !Number.isFinite(Number(entry.sourcePrice)))) {
            entry.sourceSignature = buildNaverSourceSignature(flight);
            entry.sourcePrice = getNaverSourcePrice(flight);
            seededSignatures++;
        }
    }

    const selection = selectNaverCrawlCandidates(unique.map(flight => ({
        key: flightKey(flight),
        flight,
        provisionalScore: provisionalRecommendationScore(flight),
    })), naverPrices, {
        limit,
        now,
        topCandidateCount: TOP_CANDIDATE_COUNT,
        lowCandidateRatio: LOW_CANDIDATE_RATIO,
        maxDeferDays: MAX_DEFER_DAYS,
        refreshConfig: REFRESH_CONFIG,
    });

    const groupOrder: NaverCrawlPriorityGroup[] = ['deadline', 'new', 'top', 'standard', 'low'];
    const orderedRows = groupOrder.flatMap(group => {
        const rows = selection.eligible.filter(row => row.group === group);
        const rowByKey = new Map(rows.map(row => [row.key, row]));
        return spreadRepeatedRoutes(rows.map(row => row.flight), 2)
            .map(flight => rowByKey.get(flightKey(flight))!)
            .filter(Boolean);
    });
    const selectedRows = orderedRows.slice(0, limit);
    const selectedGroupCounts: Record<NaverCrawlPriorityGroup, number> = {
        deadline: 0,
        new: 0,
        top: 0,
        standard: 0,
        low: 0,
    };
    for (const row of selectedRows) selectedGroupCounts[row.group]++;
    const priorityByKey = new Map(orderedRows.map(row => [row.key, row.group]));

    // 아직 한 번도 조회하지 못한 키도 최초 대기 시각을 저장해 7일 마감 승격이 가능하게 한다.
    const firstQueuedAt = new Date(now).toISOString();
    for (const flight of unique) {
        const key = flightKey(flight);
        if (!naverPrices[key]) {
            const route = getExactRouteAirports(flight);
            naverPrices[key] = {
                naverLowest: 0,
                route: route ? formatNaverRoute(route) : undefined,
                depDate: normalizeDate(flight.departure.date),
                retDate: normalizeDate(flight.arrival.date),
                sourceSignature: buildNaverSourceSignature(flight),
                sourcePrice: getNaverSourcePrice(flight),
                firstQueuedAt,
            };
        }
    }

    return {
        selected: selectedRows.map(row => row.flight),
        pending: orderedRows.map(row => row.flight),
        skippedFresh: selection.skippedFresh,
        seededSignatures,
        reasonCounts: selection.reasonCounts,
        groupCounts: selection.groupCounts,
        selectedGroupCounts,
        priorityByKey,
        candidateCount: unique.length,
    };
}

function routeIdentity(flight: FlightData): string {
    const route = getExactRouteAirports(flight);
    return route ? formatNaverRoute(route) : '';
}

function spreadRepeatedRoutes(flights: FlightData[], maxConsecutive: number): FlightData[] {
    const remaining = [...flights];
    const result: FlightData[] = [];
    let previousRoute = '';
    let consecutive = 0;

    while (remaining.length > 0) {
        let index = 0;
        if (previousRoute && consecutive >= maxConsecutive) {
            const differentIndex = remaining.findIndex(flight => routeIdentity(flight) !== previousRoute);
            if (differentIndex >= 0) index = differentIndex;
        }

        const [next] = remaining.splice(index, 1);
        const nextRoute = routeIdentity(next);
        if (nextRoute && nextRoute === previousRoute) consecutive++;
        else {
            previousRoute = nextRoute;
            consecutive = 1;
        }
        result.push(next);
    }
    return result;
}


 return selectFlightsByPriority;
}

