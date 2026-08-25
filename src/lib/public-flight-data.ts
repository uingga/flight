import { normalizeCity } from '@/lib/utils/flight-helpers';

export const PUBLIC_PRICE_HISTORY_DAYS = 60;

export interface PublicPriceHistoryEntry {
    date: string;
    minPrice: number;
    count?: number;
}

export type PublicPriceHistory = Record<string, PublicPriceHistoryEntry[]>;

interface CompactPublicPriceHistoryOptions {
    now?: Date;
    days?: number;
    allowedRoutes?: ReadonlySet<string>;
}

function kstDateKey(date: Date) {
    return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function cutoffDateKey(todayKey: string, days: number) {
    const cutoff = new Date(`${todayKey}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
    return cutoff.toISOString().slice(0, 10);
}

export function publicFlightRouteKey(departureCity: string, arrivalCity: string) {
    const departure = normalizeCity(departureCity || '');
    const arrival = normalizeCity(arrivalCity || '');
    return departure && arrival ? `${departure}-${arrival}` : '';
}

function normalizeHistoryRoute(route: string) {
    const separator = route.indexOf('-');
    if (separator < 1 || separator >= route.length - 1) return '';
    return publicFlightRouteKey(route.slice(0, separator), route.slice(separator + 1));
}

function positiveInteger(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
}

/**
 * 장기 가격 기록을 브라우저에 필요한 최소 형태로 줄인다.
 *
 * - KST 오늘을 포함한 최근 60일만 유지
 * - 도시 별칭을 사이트 공통 이름으로 정규화
 * - 같은 노선·날짜가 겹치면 최저가는 최소값, 표본 수는 합계로 병합
 * - 평균가를 비롯한 내부 필드는 공개하지 않음
 */
export function compactPublicPriceHistory(
    input: unknown,
    options: CompactPublicPriceHistoryOptions = {},
): PublicPriceHistory {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

    const days = Number.isInteger(options.days) && Number(options.days) > 0
        ? Number(options.days)
        : PUBLIC_PRICE_HISTORY_DAYS;
    const today = kstDateKey(options.now || new Date());
    const cutoff = cutoffDateKey(today, days);
    const routes = new Map<string, Map<string, PublicPriceHistoryEntry>>();

    for (const [rawRoute, rawEntries] of Object.entries(input as Record<string, unknown>)) {
        if (!Array.isArray(rawEntries)) continue;
        const route = normalizeHistoryRoute(rawRoute);
        if (!route || (options.allowedRoutes && !options.allowedRoutes.has(route))) continue;

        let byDate = routes.get(route);
        if (!byDate) {
            byDate = new Map();
            routes.set(route, byDate);
        }

        for (const rawEntry of rawEntries) {
            if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
            const entry = rawEntry as Record<string, unknown>;
            const date = typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
                ? entry.date
                : '';
            const minPrice = positiveInteger(entry.minPrice);
            if (!date || date < cutoff || date > today || !minPrice) continue;

            const count = positiveInteger(entry.count);
            const existing = byDate.get(date);
            if (!existing) {
                byDate.set(date, {
                    date,
                    minPrice,
                    ...(count ? { count } : {}),
                });
                continue;
            }

            const mergedCount = (existing.count || 0) + (count || 0);
            byDate.set(date, {
                date,
                minPrice: Math.min(existing.minPrice, minPrice),
                ...(mergedCount > 0 ? { count: mergedCount } : {}),
            });
        }
    }

    return Object.fromEntries(
        Array.from(routes.entries())
            .map(([route, byDate]) => [
                route,
                Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date)),
            ] as const)
            .filter(([, entries]) => entries.length > 0)
            .sort(([left], [right]) => left.localeCompare(right)),
    );
}
