import { createHash } from 'node:crypto';
import { isInterparkBenchmarkApplicable } from './interpark-benchmark';

export interface NaverRefreshFlight {
    source: string;
    price: number;
    airline?: string;
    flightNumber?: string;
    discountRate?: number;
    departure: {
        airport?: string;
        city?: string;
        date: string;
        time?: string;
        arrivalTime?: string;
    };
    arrival: {
        date: string;
        time?: string;
        arrivalTime?: string;
    };
}

export interface NaverRefreshEntry {
    crawledAt?: string;
    lastAttemptAt?: string;
    lastAttemptStatus?: string;
    sourceSignature?: string;
    sourcePrice?: number;
}

export interface NaverRefreshConfig {
    priorityRefreshDays: number;
    standardRefreshDays: number;
    minSuccessRefreshHours: number;
    priorityDepartureDays: number;
    priorityDiscountRate: number;
    priceChangeAmount: number;
    priceChangeRatio: number;
    missRetryHours: number;
    noResultRetryHours: number;
}

export type NaverRefreshTier = 'priority' | 'standard';
export type NaverRefreshReason =
    | 'new'
    | 'source_changed'
    | 'retry_wait'
    | 'retry_due'
    | 'priority_fresh'
    | 'priority_periodic'
    | 'standard_fresh'
    | 'standard_periodic';

export interface NaverRefreshDecision {
    fresh: boolean;
    reason: NaverRefreshReason;
    tier: NaverRefreshTier;
    refreshDays: number;
    sourceSignature: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

const kstDayNumber = (timestamp: number): number =>
    Math.floor((timestamp + KST_OFFSET_MS) / DAY_MS);

const normalizeDate = (value: unknown): string => String(value || '')
    .replace(/\(.*\)/g, '')
    .replace(/\./g, '-')
    .replace(/\s/g, '')
    .trim()
    .substring(0, 10);

const normalizeText = (value: unknown): string => String(value || '').trim();

/**
 * 같은 공항·날짜 검색키에서 여행사 실결제가가 달라졌는지만 판별한다.
 * 항공사·편명·시간은 네이버의 해당 날짜 전체 최저가를 다시 받을 이유가 아니므로 제외한다.
 */
export function buildNaverSourceSignature(flight: NaverRefreshFlight): string {
    const payload = [getNaverSourcePrice(flight)];

    return createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex')
        .slice(0, 24);
}

/** 땡처리닷컴 발권수수료까지 포함해 네이버 비교 판단에 쓰는 여행사 실결제가. */
export function getNaverSourcePrice(flight: NaverRefreshFlight): number {
    const price = Number.isFinite(Number(flight.price)) ? Number(flight.price) : 0;
    return price + (normalizeText(flight.source) === 'ttang' ? 20_000 : 0);
}

export function getNaverRefreshTier(
    flight: NaverRefreshFlight,
    now = Date.now(),
    config: Pick<NaverRefreshConfig, 'priorityDepartureDays' | 'priorityDiscountRate'>,
): NaverRefreshTier {
    const departureDate = normalizeDate(flight.departure.date);
    const departureTimestamp = /^\d{4}-\d{2}-\d{2}$/.test(departureDate)
        ? Date.parse(`${departureDate}T00:00:00+09:00`)
        : Number.NaN;
    const daysUntilDeparture = Number.isFinite(departureTimestamp)
        ? kstDayNumber(departureTimestamp) - kstDayNumber(now)
        : Number.POSITIVE_INFINITY;
    const departsSoon = daysUntilDeparture >= 0 && daysUntilDeparture <= config.priorityDepartureDays;
    const highDiscount = isInterparkBenchmarkApplicable(flight)
        && Number(flight.discountRate || 0) >= config.priorityDiscountRate;

    return departsSoon || highDiscount ? 'priority' : 'standard';
}

export function evaluateNaverRefresh(
    entry: NaverRefreshEntry | undefined,
    flight: NaverRefreshFlight,
    now = Date.now(),
    config: NaverRefreshConfig,
): NaverRefreshDecision {
    const tier = getNaverRefreshTier(flight, now, config);
    const refreshDays = tier === 'priority'
        ? config.priorityRefreshDays
        : config.standardRefreshDays;
    const sourceSignature = buildNaverSourceSignature(flight);
    const sourcePrice = getNaverSourcePrice(flight);

    const hasSuccessfulPrice = Boolean(
        entry
        && Number.isFinite(new Date(entry.crawledAt || '').getTime())
        && (!entry.lastAttemptStatus || entry.lastAttemptStatus === 'success'),
    );
    if (!entry || !hasSuccessfulPrice) {
        if (entry?.lastAttemptStatus && entry.lastAttemptStatus !== 'success') {
            const attemptedAt = new Date(entry.lastAttemptAt || entry.crawledAt || '').getTime();
            if (Number.isFinite(attemptedAt)) {
                const retryHours = entry.lastAttemptStatus === 'no_result'
                    || entry.lastAttemptStatus === 'route_error'
                    || entry.lastAttemptStatus === 'miss'
                    ? config.noResultRetryHours
                    : config.missRetryHours;
                const fresh = now - attemptedAt < retryHours * HOUR_MS;
                return {
                    fresh,
                    reason: fresh ? 'retry_wait' : 'retry_due',
                    tier,
                    refreshDays,
                    sourceSignature,
                };
            }
        }
        return { fresh: false, reason: 'new', tier, refreshDays, sourceSignature };
    }

    const isMiss = Boolean(entry.lastAttemptStatus && entry.lastAttemptStatus !== 'success');
    const timestamp = isMiss ? entry.lastAttemptAt : entry.crawledAt;
    const attemptedAt = new Date(timestamp || '').getTime();

    // 접근 이상 뒤에는 여행사 가격이 바뀌어도 쿨다운을 우선한다.
    if (isMiss && Number.isFinite(attemptedAt)) {
        const retryHours = entry.lastAttemptStatus === 'no_result'
            || entry.lastAttemptStatus === 'route_error'
            || entry.lastAttemptStatus === 'miss'
            ? config.noResultRetryHours
            : config.missRetryHours;
        const fresh = now - attemptedAt < retryHours * HOUR_MS;
        return {
            fresh,
            reason: fresh ? 'retry_wait' : 'retry_due',
            tier,
            refreshDays,
            sourceSignature,
        };
    }

    // KST 날짜가 바뀌었다는 이유만으로 전날 늦은 회차의 동일 노선을 다시
    // 요청하지 않는다. 의미 있는 여행사 가격 변경도 이 최소 휴식 뒤에만 반영한다.
    const checkedAt = new Date(entry.crawledAt || '').getTime();
    if (
        Number.isFinite(checkedAt)
        && now - checkedAt < Math.max(0, config.minSuccessRefreshHours) * HOUR_MS
    ) {
        return {
            fresh: true,
            reason: tier === 'priority' ? 'priority_fresh' : 'standard_fresh',
            tier,
            refreshDays,
            sourceSignature,
        };
    }

    if (entry.sourceSignature && entry.sourceSignature !== sourceSignature) {
        const previousSourcePrice = Number(entry.sourcePrice);
        const absoluteChange = Number.isFinite(previousSourcePrice)
            ? Math.abs(sourcePrice - previousSourcePrice)
            : Number.POSITIVE_INFINITY;
        const relativeChange = Number.isFinite(previousSourcePrice) && previousSourcePrice > 0
            ? absoluteChange / previousSourcePrice
            : Number.POSITIVE_INFINITY;
        if (absoluteChange >= config.priceChangeAmount || relativeChange >= config.priceChangeRatio) {
            return { fresh: false, reason: 'source_changed', tier, refreshDays, sourceSignature };
        }
    }

    const fresh = Number.isFinite(checkedAt)
        && kstDayNumber(now) - kstDayNumber(checkedAt) < refreshDays;
    const reason = tier === 'priority'
        ? fresh ? 'priority_fresh' : 'priority_periodic'
        : fresh ? 'standard_fresh' : 'standard_periodic';

    return { fresh, reason, tier, refreshDays, sourceSignature };
}
