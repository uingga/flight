import type { Flight } from '../types/flight';
import { buildNaverPriceKey, normalizeComparisonDate } from './naver-route';
import { getComparisonFreshness, getEffectivePrice } from './price-quality';

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 60;
const DEPARTURE_WINDOW_DAYS = 14;
const MIN_STRONG_SAMPLE_COUNT = 2;

export interface NearbyNaverPriceEntry {
    naverLowest?: unknown;
    crawledAt?: string;
    lastAttemptStatus?: string;
}

interface NearbyNaverSample {
    key: string;
    departureDay: number;
    durationDays: number;
    price: number;
}

export interface NearbyNaverPriceIndex {
    byRoute: Map<string, NearbyNaverSample[]>;
}

export interface NearbyNaverPriceContext {
    baseline: number | null;
    sampleCount: number;
}

export interface NearbyNaverRecommendationAdjustment {
    multiplier: number;
    premiumRatio: number | null;
    premiumAmount: number | null;
    todayPickExcluded: boolean;
}

const parseKstDay = (value: unknown): number => {
    const date = normalizeComparisonDate(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NaN;
    return Math.floor(Date.parse(`${date}T00:00:00+09:00`) / DAY_MS);
};

const parsePriceKey = (key: string): {
    routeKey: string;
    departureDay: number;
    durationDays: number;
} | null => {
    const match = key.match(/^(.*)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
    if (!match) return null;
    const departureDay = parseKstDay(match[2]);
    const returnDay = parseKstDay(match[3]);
    if (!Number.isFinite(departureDay) || !Number.isFinite(returnDay)) return null;
    return {
        routeKey: match[1],
        departureDay,
        durationDays: returnDay - departureDay,
    };
};

const routeKeyFromFlight = (flight: Flight): {
    exactKey: string;
    routeKey: string;
    departureDay: number;
    durationDays: number;
} | null => {
    const exactKey = buildNaverPriceKey(flight, flight.departure?.date, flight.arrival?.date);
    if (!exactKey) return null;
    const parsed = parsePriceKey(exactKey);
    return parsed ? { exactKey, ...parsed } : null;
};

/**
 * 최근 60일 안에 정상 수집된 인접 일정 네이버 가격을 동일 가중치로 색인한다.
 * 실제 비교 범위는 후보 출발일 앞뒤 14일이며 1~14일 표본을 동일 가중치로 쓴다.
 * 여행 기간은 제한하지 않는다.
 */
export function buildNearbyNaverPriceIndex(
    entries: Record<string, NearbyNaverPriceEntry | undefined>,
    now = Date.now(),
): NearbyNaverPriceIndex {
    const byRoute = new Map<string, NearbyNaverSample[]>();
    for (const [key, entry] of Object.entries(entries)) {
        if (!entry) continue;
        const price = Number(entry.naverLowest);
        const checkedAt = new Date(entry.crawledAt || '').getTime();
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(checkedAt)) continue;
        if (now - checkedAt < 0 || now - checkedAt > LOOKBACK_DAYS * DAY_MS) continue;
        if (entry.lastAttemptStatus && entry.lastAttemptStatus !== 'success') continue;

        const parsed = parsePriceKey(key);
        if (!parsed) continue;
        const sample: NearbyNaverSample = {
            key,
            departureDay: parsed.departureDay,
            durationDays: parsed.durationDays,
            price,
        };
        const routeSamples = byRoute.get(parsed.routeKey);
        if (routeSamples) routeSamples.push(sample);
        else byRoute.set(parsed.routeKey, [sample]);
    }
    return { byRoute };
}

/** 같은 노선의 출발일 앞뒤 14일 가격 중간값을 반환한다. 여행 기간은 달라도 된다. */
export function getNearbyNaverPriceContext(
    index: NearbyNaverPriceIndex,
    flight: Flight,
): NearbyNaverPriceContext {
    const route = routeKeyFromFlight(flight);
    if (!route) return { baseline: null, sampleCount: 0 };
    const prices = (index.byRoute.get(route.routeKey) || [])
        .filter(sample => (
            sample.key !== route.exactKey
            && Math.abs(sample.departureDay - route.departureDay) <= DEPARTURE_WINDOW_DAYS
        ))
        .map(sample => sample.price)
        .sort((left, right) => left - right);

    if (prices.length === 0) {
        return { baseline: null, sampleCount: prices.length };
    }
    const middle = Math.floor(prices.length / 2);
    const baseline = prices.length % 2 === 0
        ? Math.round((prices[middle - 1] + prices[middle]) / 2)
        : prices[middle];
    return { baseline, sampleCount: prices.length };
}

/**
 * 정확한 일정에서 네이버 이하로 확인된 표에만 인접 일정 가격 프리미엄을 느슨하게 반영한다.
 */
export function getNearbyNaverRecommendationAdjustment(
    flight: Flight,
    now = Date.now(),
): NearbyNaverRecommendationAdjustment {
    const baseline = Number(flight.nearbyNaverBaseline);
    const sampleCount = Number(flight.nearbyNaverSampleCount || 0);
    const exactComparisonUsable = Boolean(
        flight.naverLowest
        && flight.naverLowest > 0
        && getComparisonFreshness(flight.naverCheckedAt, now).usable,
    );
    const effectivePrice = getEffectivePrice(flight);
    if (
        !exactComparisonUsable
        || effectivePrice > Number(flight.naverLowest)
        || !Number.isFinite(baseline)
        || baseline <= 0
        || sampleCount < MIN_STRONG_SAMPLE_COUNT
    ) {
        return {
            multiplier: 1,
            premiumRatio: null,
            premiumAmount: null,
            todayPickExcluded: false,
        };
    }

    const premiumAmount = effectivePrice - baseline;
    const premiumRatio = premiumAmount / baseline;
    const multiplier = premiumRatio <= 0.1
        ? 1
        : premiumRatio <= 0.2
            ? 1.08
            : premiumRatio <= 0.3
                ? 1.18
                : 1.3;

    return {
        multiplier,
        premiumRatio,
        premiumAmount,
        todayPickExcluded: premiumRatio >= 0.3 && premiumAmount >= 50_000,
    };
}
