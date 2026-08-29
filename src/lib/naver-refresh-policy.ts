import { createHash } from 'node:crypto';

export interface NaverRefreshFlight {
    source: string;
    price: number;
    airline?: string;
    flightNumber?: string;
    discountRate?: number;
    departure: {
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
}

export interface NaverRefreshConfig {
    priorityRefreshDays: number;
    standardRefreshDays: number;
    priorityDepartureDays: number;
    priorityDiscountRate: number;
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
 * 네이버 비교가에 영향을 주는 여행사 쪽 최저가·편명·시간만 지문으로 만든다.
 * 잔여 좌석처럼 자주 바뀌지만 네이버 비교가를 다시 받을 이유가 없는 값은 제외한다.
 */
export function buildNaverSourceSignature(flight: NaverRefreshFlight): string {
    const payload = [
        normalizeText(flight.source),
        Number.isFinite(Number(flight.price)) ? Number(flight.price) : 0,
        normalizeText(flight.airline),
        normalizeText(flight.flightNumber),
        normalizeDate(flight.departure.date),
        normalizeText(flight.departure.time),
        normalizeText(flight.departure.arrivalTime),
        normalizeDate(flight.arrival.date),
        normalizeText(flight.arrival.time),
        normalizeText(flight.arrival.arrivalTime),
    ];

    return createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex')
        .slice(0, 24);
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
    const highDiscount = Number(flight.discountRate || 0) >= config.priorityDiscountRate;

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

    if (!entry) {
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

    if (entry.sourceSignature && entry.sourceSignature !== sourceSignature) {
        return { fresh: false, reason: 'source_changed', tier, refreshDays, sourceSignature };
    }

    const checkedAt = new Date(entry.crawledAt || '').getTime();
    const fresh = Number.isFinite(checkedAt)
        && kstDayNumber(now) - kstDayNumber(checkedAt) < refreshDays;
    const reason = tier === 'priority'
        ? fresh ? 'priority_fresh' : 'priority_periodic'
        : fresh ? 'standard_fresh' : 'standard_periodic';

    return { fresh, reason, tier, refreshDays, sourceSignature };
}
