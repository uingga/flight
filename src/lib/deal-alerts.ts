import type { Flight } from '../types/flight';
import { normalizeCity } from './utils/flight-helpers';
import { getComparisonFreshness } from './price-quality';

export const DEAL_ALERT_PREFIX = '@deal:';
export const DEAL_ALERT_SCORE_THRESHOLD = 65;
export const DEAL_ALERT_REGIONS = ['일본', '동남아', '중국', '남태평양', 'all'] as const;

export type DealAlertRegion = (typeof DEAL_ALERT_REGIONS)[number];

export interface DealAlertCondition {
    id: string;
    departureCity: string;
    region: DealAlertRegion;
    maxPrice: number;
    createdAt?: string;
}

export interface DealScoreBreakdown {
    history: number;
    comparison: number;
    schedule: number;
    novelty: number;
    freshness: number;
}

export interface DealCandidate {
    flightId: string;
    departureCity: string;
    arrivalCity: string;
    region: string;
    departureDate: string;
    returnDate: string;
    airline: string;
    source: string;
    price: number;
    effectivePrice: number;
    feeNote?: string;
    score: number;
    scoreBreakdown: DealScoreBreakdown;
    reasons: string[];
    priceCheckedAt?: string;
}

export interface DealAlertReview {
    condition: DealAlertCondition;
    matchingFlights: number;
    qualifiedCount: number;
    candidates: DealCandidate[];
    rejectionCounts: {
        otherDeparture: number;
        otherRegion: number;
        overBudget: number;
        expired: number;
        stale: number;
        lowScore: number;
    };
}

type ReviewFlight = Flight & { firstSeen?: string };
type PriceHistory = Record<string, Array<{ date?: string; minPrice?: number; avgPrice?: number }>>;

export function encodeDealAlertRegion(region: DealAlertRegion): string {
    return `${DEAL_ALERT_PREFIX}${region}`;
}

export function decodeDealAlertRegion(value?: string): DealAlertRegion | null {
    if (!value?.startsWith(DEAL_ALERT_PREFIX)) return null;
    const region = value.slice(DEAL_ALERT_PREFIX.length) as DealAlertRegion;
    return DEAL_ALERT_REGIONS.includes(region) ? region : null;
}

export function isDealAlertDestination(value?: string): boolean {
    return decodeDealAlertRegion(value) !== null;
}

export function dealAlertRegionLabel(region: DealAlertRegion): string {
    if (region === 'all') return '아무데나';
    // 저장값은 기존 구독과의 호환을 위해 `중국`을 유지하되 사용자 화면에서는
    // 중국 본토·대만·홍콩·마카오를 함께 아우르는 이름으로 보여준다.
    return region === '중국' ? '중화권' : region;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function parseDate(value?: string): Date | null {
    if (!value) return null;
    const match = value.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if (!match) return null;
    const parsed = new Date(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00+09:00`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function daysBetween(start?: string, end?: string): number | null {
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    if (!startDate || !endDate) return null;
    return Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function routeHistoryBaseline(flight: ReviewFlight, priceHistory: PriceHistory): number | null {
    const route = `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;
    const entries = priceHistory[route] || [];
    return median(entries.map(entry => Number(entry.minPrice)).filter(price => Number.isFinite(price) && price > 0));
}

function historyScore(price: number, baseline: number | null): number {
    if (!baseline) return 14;
    const ratio = price / baseline;
    if (ratio <= 0.75) return 30;
    if (ratio <= 0.85) return 27;
    if (ratio <= 0.95) return 23;
    if (ratio <= 1) return 19;
    if (ratio <= 1.05) return 14;
    if (ratio <= 1.1) return 9;
    return 3;
}

function comparisonScore(effectivePrice: number, comparisonPrice?: number): number {
    if (!comparisonPrice || comparisonPrice <= 0) return 13;
    const ratio = effectivePrice / comparisonPrice;
    if (ratio <= 0.9) return 25;
    if (ratio <= 0.95) return 23;
    if (ratio <= 1) return 20;
    if (ratio <= 1.05) return 16;
    if (ratio <= 1.1) return 11;
    if (ratio <= 1.15) return 5;
    return 0;
}

function scheduleScore(flight: ReviewFlight): number {
    const duration = daysBetween(flight.departure.date, flight.arrival.date);
    let score = 8;
    if (duration !== null) {
        if (duration >= 2 && duration <= 4) score = 15;
        else if (duration >= 1 && duration <= 6) score = 12;
        else if (duration >= 7 && duration <= 10) score = 8;
        else score = 4;
    }

    const departureDate = parseDate(flight.departure.date);
    const returnDate = parseDate(flight.arrival.date);
    if (departureDate && returnDate) {
        for (let cursor = new Date(departureDate); cursor <= returnDate; cursor.setDate(cursor.getDate() + 1)) {
            if (cursor.getDay() === 0 || cursor.getDay() === 6) {
                score += 5;
                break;
            }
        }
    }
    return clamp(score, 0, 20);
}

function noveltyScore(firstSeen?: string, now = new Date()): number {
    const seenAt = parseDate(firstSeen);
    if (!seenAt) return 6;
    const ageDays = Math.max(0, (now.getTime() - seenAt.getTime()) / 86_400_000);
    if (ageDays <= 1) return 15;
    if (ageDays <= 3) return 12;
    if (ageDays <= 7) return 9;
    return 5;
}

function freshnessInfo(checkedAt?: string, now = new Date()): { score: number; ageHours: number | null } {
    if (!checkedAt) return { score: 4, ageHours: null };
    const checked = new Date(checkedAt).getTime();
    if (!Number.isFinite(checked)) return { score: 4, ageHours: null };
    const ageHours = Math.max(0, (now.getTime() - checked) / 3_600_000);
    if (ageHours < 24) return { score: 10, ageHours };
    if (ageHours < 48) return { score: 7, ageHours };
    if (ageHours < 72) return { score: 3, ageHours };
    return { score: 0, ageHours };
}

function effectivePrice(flight: ReviewFlight): { price: number; feeNote?: string } {
    if (flight.source === 'ttang') {
        return { price: flight.price + 20_000, feeNote: '발권수수료 2만원 반영' };
    }
    return { price: flight.price };
}

function candidateReasons(
    flight: ReviewFlight,
    effective: number,
    baseline: number | null,
    comparisonPrice: number | undefined,
    freshness: { score: number; ageHours: number | null },
): string[] {
    const reasons: string[] = [];
    if (baseline && effective < baseline) {
        reasons.push(`평소 이 노선 시세보다 ${Math.round((1 - effective / baseline) * 100)}% 저렴`);
    }
    if (comparisonPrice && effective <= comparisonPrice) {
        const savingRate = Math.round((1 - effective / comparisonPrice) * 100);
        reasons.push(savingRate > 0
            ? `외부 비교 최저가보다 ${savingRate}% 저렴`
            : '외부 비교 최저가 이하');
    }
    const duration = daysBetween(flight.departure.date, flight.arrival.date);
    if (duration !== null) reasons.push(`${duration}박 ${duration + 1}일 일정`);
    if (freshness.ageHours !== null && freshness.ageHours < 24) reasons.push('24시간 이내 확인된 가격');
    if (reasons.length === 0) reasons.push('예산과 특가 점수 기준 충족');
    return reasons.slice(0, 3);
}

function scoreFlight(
    flight: ReviewFlight,
    priceHistory: PriceHistory,
    checkedAt: string | undefined,
    now: Date,
): DealCandidate {
    const effective = effectivePrice(flight);
    const baseline = routeHistoryBaseline(flight, priceHistory);
    const freshness = freshnessInfo(checkedAt, now);
    const comparisonPrice = flight.naverLowest
        && getComparisonFreshness(flight.naverCheckedAt, now.getTime()).usable
        ? flight.naverLowest
        : undefined;
    const breakdown: DealScoreBreakdown = {
        history: historyScore(effective.price, baseline),
        comparison: comparisonScore(effective.price, comparisonPrice),
        schedule: scheduleScore(flight),
        novelty: noveltyScore(flight.firstSeen, now),
        freshness: freshness.score,
    };
    const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    return {
        flightId: flight.id,
        departureCity: normalizeCity(flight.departure.city),
        arrivalCity: normalizeCity(flight.arrival.city),
        region: flight.region || '기타',
        departureDate: flight.departure.date,
        returnDate: flight.arrival.date,
        airline: flight.airline,
        source: flight.source,
        price: flight.price,
        effectivePrice: effective.price,
        feeNote: effective.feeNote,
        score,
        scoreBreakdown: breakdown,
        reasons: candidateReasons(flight, effective.price, baseline, comparisonPrice, freshness),
        priceCheckedAt: checkedAt,
    };
}

export function evaluateDealAlert(
    condition: DealAlertCondition,
    flights: ReviewFlight[],
    priceHistory: PriceHistory = {},
    sourceUpdatedAt: Record<string, string> = {},
    now = new Date(),
): DealAlertReview {
    const rejectionCounts: DealAlertReview['rejectionCounts'] = {
        otherDeparture: 0,
        otherRegion: 0,
        overBudget: 0,
        expired: 0,
        stale: 0,
        lowScore: 0,
    };
    const candidates: DealCandidate[] = [];
    let matchingFlights = 0;
    const today = new Date(now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }) + 'T00:00:00+09:00');

    for (const flight of flights) {
        if (normalizeCity(flight.departure.city) !== normalizeCity(condition.departureCity)) {
            rejectionCounts.otherDeparture++;
            continue;
        }
        if (condition.region !== 'all' && flight.region !== condition.region) {
            rejectionCounts.otherRegion++;
            continue;
        }

        const payable = effectivePrice(flight).price;
        if (payable > condition.maxPrice) {
            rejectionCounts.overBudget++;
            continue;
        }

        const departureDate = parseDate(flight.departure.date);
        if (!departureDate || departureDate < today) {
            rejectionCounts.expired++;
            continue;
        }

        matchingFlights++;
        const checkedAt = flight.priceCheckedAt || sourceUpdatedAt[flight.source];
        const freshness = freshnessInfo(checkedAt, now);
        if (freshness.ageHours !== null && freshness.ageHours >= 72) {
            rejectionCounts.stale++;
            continue;
        }

        const candidate = scoreFlight(flight, priceHistory, checkedAt, now);
        if (candidate.score < DEAL_ALERT_SCORE_THRESHOLD) {
            rejectionCounts.lowScore++;
            continue;
        }
        candidates.push(candidate);
    }

    const bestByDestination = new Map<string, DealCandidate>();
    for (const candidate of candidates) {
        const current = bestByDestination.get(candidate.arrivalCity);
        if (!current || candidate.score > current.score
            || (candidate.score === current.score && candidate.effectivePrice < current.effectivePrice)) {
            bestByDestination.set(candidate.arrivalCity, candidate);
        }
    }
    const ranked = Array.from(bestByDestination.values())
        .sort((a, b) => b.score - a.score || a.effectivePrice - b.effectivePrice);

    return {
        condition,
        matchingFlights,
        qualifiedCount: ranked.length,
        candidates: ranked.slice(0, 5),
        rejectionCounts,
    };
}
