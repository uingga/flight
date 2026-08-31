import type { Flight } from '../types/flight';
import { buildNaverPriceKey, normalizeComparisonDate } from './naver-route';
import { getComparisonFreshness, getEffectivePrice } from './price-quality';

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 60;
const PRIMARY_DEPARTURE_WINDOW_DAYS = 30;
const FALLBACK_DEPARTURE_WINDOW_DAYS = 60;
const DURATION_TOLERANCE_DAYS = 1;
const MIN_SAMPLE_COUNT = 5;

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
 * 먼저 출발일 ±30일을 보고, 표본이 부족할 때만 ±60일까지 넓힌다.
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

/** 같은 노선·여행기간 ±1일에서 출발일 ±30일, 부족하면 ±60일의 하위 25% 가격을 반환한다. */
export function getNearbyNaverPriceContext(
    index: NearbyNaverPriceIndex,
    flight: Flight,
): NearbyNaverPriceContext {
    const route = routeKeyFromFlight(flight);
    if (!route) return { baseline: null, sampleCount: 0 };
    const comparableSamples = (index.byRoute.get(route.routeKey) || [])
        .filter(sample => (
            sample.key !== route.exactKey
            && Math.abs(sample.durationDays - route.durationDays) <= DURATION_TOLERANCE_DAYS
            && Math.abs(sample.departureDay - route.departureDay) <= FALLBACK_DEPARTURE_WINDOW_DAYS
        ));
    const primaryPrices = comparableSamples
        .filter(sample => (
            Math.abs(sample.departureDay - route.departureDay) <= PRIMARY_DEPARTURE_WINDOW_DAYS
        ))
        .map(sample => sample.price);
    const prices = (primaryPrices.length >= MIN_SAMPLE_COUNT
        ? primaryPrices
        : comparableSamples.map(sample => sample.price))
        .sort((left, right) => left - right);

    if (prices.length < MIN_SAMPLE_COUNT) {
        return { baseline: null, sampleCount: prices.length };
    }
    // 최저가 한 건이 그대로 기준이 되지 않도록 25백분위 위치의 양옆 가격을 선형 보간한다.
    const quartilePosition = (prices.length - 1) * 0.25;
    const lowerIndex = Math.floor(quartilePosition);
    const upperIndex = Math.ceil(quartilePosition);
    const fraction = quartilePosition - lowerIndex;
    const baseline = Math.round(
        prices[lowerIndex] + (prices[upperIndex] - prices[lowerIndex]) * fraction,
    );
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
        || sampleCount < MIN_SAMPLE_COUNT
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
