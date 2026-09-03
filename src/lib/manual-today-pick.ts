import type { Flight } from '@/types/flight';
import { getEffectivePrice, getRecommendationComparisonFreshness } from '@/lib/price-quality';

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface TodayPickRecord {
    date: string;
    flightId: string;
    source: string | null;
    arrivalCity: string | null;
    destinationKey: string;
    effectivePrice: number;
}

export interface StoredTodayPick extends Partial<TodayPickRecord> {
    selectedAt?: string;
    selectionMode?: string;
    referencePrice?: number | null;
    previousPick?: TodayPickRecord | null;
    recentPicks?: TodayPickRecord[];
    repeatOverride?: {
        previousEffectivePrice?: number;
        previousDate?: string;
        currentEffectivePrice?: number;
        dropAmount?: number;
    } | null;
    selectedBy?: string;
}

export interface ManualTodayPick extends TodayPickRecord {
    selectedAt: string;
    selectionMode: 'manual';
    referencePrice: number | null;
    previousPick: TodayPickRecord | null;
    recentPicks: TodayPickRecord[];
    repeatOverride: null;
    selectedBy: 'admin';
}

function cleanText(value: unknown): string {
    return String(value || '').replace(/\([^)]+\)/g, '').trim();
}

export function todayPickDestinationKey(flight: Flight): string {
    const airport = cleanText(
        flight.routeAirports?.outboundArrival
        || flight.arrival?.airport,
    ).toUpperCase();
    if (airport) return airport;
    return cleanText(flight.arrival?.city).toLocaleLowerCase('ko-KR');
}

export function kstDateKey(now: number | Date = Date.now()): string {
    const timestamp = now instanceof Date ? now.getTime() : now;
    return new Date(timestamp + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function calendarDayDistance(olderDate: string, newerDate: string): number | null {
    const older = new Date(`${olderDate}T00:00:00.000Z`).getTime();
    const newer = new Date(`${newerDate}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(older) || !Number.isFinite(newer)) return null;
    return Math.round((newer - older) / DAY_MS);
}

function snapshotPick(value: StoredTodayPick | TodayPickRecord | null | undefined): TodayPickRecord | null {
    const price = Number(value?.effectivePrice);
    const date = typeof value?.date === 'string' ? value.date : '';
    const flightId = typeof value?.flightId === 'string' ? value.flightId : '';
    const destinationKey = cleanText(value?.destinationKey).toUpperCase();
    if (!date || !flightId || !destinationKey || !Number.isFinite(price) || price <= 0) return null;
    return {
        date,
        flightId,
        source: typeof value?.source === 'string' ? value.source : null,
        arrivalCity: typeof value?.arrivalCity === 'string' ? value.arrivalCity : null,
        destinationKey,
        effectivePrice: price,
    };
}

export function collectManualPickHistory(
    storedPick: StoredTodayPick,
    selectionDate: string,
    lookbackDays = 7,
): TodayPickRecord[] {
    const candidates = [
        snapshotPick(storedPick),
        ...(Array.isArray(storedPick.recentPicks)
            ? storedPick.recentPicks.map(pick => snapshotPick(pick))
            : []),
        snapshotPick(storedPick.previousPick),
    ].filter((pick): pick is TodayPickRecord => Boolean(pick));
    const seen = new Set<string>();

    return candidates
        .filter(pick => {
            const distance = calendarDayDistance(pick.date, selectionDate);
            return distance !== null && distance >= 1 && distance <= lookbackDays;
        })
        .filter(pick => {
            const key = `${pick.date}|${pick.flightId}|${pick.destinationKey}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((left, right) => right.date.localeCompare(left.date));
}

export function buildManualTodayPick(
    storedPick: StoredTodayPick,
    flight: Flight,
    now = Date.now(),
): ManualTodayPick {
    const date = kstDateKey(now);
    const recentPicks = collectManualPickHistory(storedPick, date);
    const naverPrice = Number(flight.naverLowest);
    const usableNaverPrice = Number.isFinite(naverPrice)
        && naverPrice > 0
        && getRecommendationComparisonFreshness(flight.naverCheckedAt, now).usable;

    return {
        date,
        selectedAt: new Date(now).toISOString(),
        flightId: flight.id,
        source: flight.source,
        arrivalCity: cleanText(flight.arrival?.city) || null,
        destinationKey: todayPickDestinationKey(flight),
        effectivePrice: getEffectivePrice(flight),
        selectionMode: 'manual',
        referencePrice: usableNaverPrice ? naverPrice : null,
        previousPick: recentPicks[0] || null,
        recentPicks,
        repeatOverride: null,
        selectedBy: 'admin',
    };
}
