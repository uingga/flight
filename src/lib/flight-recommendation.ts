import type { Flight } from '../types/flight';
import {
    diversifyRecommendationOrderWithDecisions,
    excludePinnedDestination,
    type FlightDiversityDecision,
} from './flight-diversity';
import {
    getComparisonFreshness,
    getComparisonPriceTier,
    getEffectivePrice,
    getRoutePriceCompetitivenessTier,
} from './price-quality';
import { normalizeCity } from './utils/flight-helpers';
import { getRegionByCity } from './utils/region-mapper';

export type InterparkPrices = Record<string, Record<string, { avg: number; lowest: number }>>;
export type RecommendationPriceHistory = Record<string, Array<{ date: string; minPrice: number }>>;

export type TopRecommendationTier = 0 | 1 | 2 | 3 | 4;
export type PriceEvidenceStrength = 0 | 1 | 2;

const MIN_REGION_SAMPLE_COUNT = 5;
const MIN_ROUTE_HISTORY_SAMPLE_COUNT = 7;
const ATTRACTIVE_PRICE_PERCENTILE = 0.5;

export interface RecommendationScoreFactor {
    rule:
        | 'interpark-missing'
        | 'interpark-monthly-lowest'
        | 'interpark-near-lowest'
        | 'interpark-below-average'
        | 'interpark-average-or-higher'
        | 'comparison-price'
        | 'nearby-date-premium'
        | 'naver-same-date'
        | 'nearby-dates'
        | 'interpark-month-lowest'
        | 'route-history'
        | 'price-freshness';
    multiplier: number;
    detail: string;
}

export interface RecommendationScoreExplanation {
    effectivePrice: number;
    comparisonTier: 0 | 1 | 2;
    comparisonPrice: number | null;
    interparkMonth: string | null;
    interparkMonthlyLowest: number | null;
    interparkMonthlyAverage: number | null;
    scoreBeforeRouteCorrection: number;
    score: number;
    routePriceCorrectionApplied: boolean;
    topRecommendationTier: TopRecommendationTier;
    regionPricePercentile: number | null;
    routeHistoryPercentile: number | null;
    priceAppealPercentile: number | null;
    priceAttractive: boolean;
    nearbyDateCompetitive: boolean | null;
    naverCompetitivenessRank: TopRecommendationTier;
    displayPriceBand: number;
    routeEvidenceRank: number;
    otherDateEvidenceRank: number;
    historyEvidenceRank: number;
    naverEvidenceStrength: PriceEvidenceStrength;
    nearbyEvidenceStrength: PriceEvidenceStrength;
    interparkEvidenceStrength: PriceEvidenceStrength;
    otherDateEvidenceStrength: PriceEvidenceStrength;
    historyEvidenceStrength: PriceEvidenceStrength;
    goodPriceEvidenceCount: number;
    strongPriceEvidenceCount: number;
    monthWideDeal: boolean;
    expensivePromotionEligible: boolean;
    naverAllowedGap: number;
    factors: RecommendationScoreFactor[];
}

export interface RecommendationScoreState {
    scores: Map<string, number>;
    explanations: Map<string, RecommendationScoreExplanation>;
}

export type RecommendationCandidateRule =
    | 'passed-current-filters'
    | 'today-pick-pinned'
    | 'same-destination-as-today-pick';

export interface RecommendationPlacementExplanation {
    flightId: string;
    candidate: {
        inputPosition: number;
        eligibleForRegularList: boolean;
        rule: RecommendationCandidateRule;
    };
    score: RecommendationScoreExplanation;
    display: {
        comparisonTier: 0 | 1 | 2;
        rankedPosition: number;
        regularPosition: number | null;
        displayPosition: number | null;
        rule: 'today-pick-pinned' | 'comparison-tier-then-score' | 'destination-diversity' | 'excluded';
        diversityDecision?: FlightDiversityDecision;
    };
}

export interface RecommendationPresentationOptions {
    pinnedFlight?: Flight;
    diversify?: boolean;
    balanceIncheon?: boolean;
    now?: number;
}

export interface RecommendationPresentation {
    orderedFlights: Flight[];
    explanations: Map<string, RecommendationPlacementExplanation>;
}

export function getRecommendationFreshness(checkedAt?: string, now = Date.now()) {
    if (!checkedAt) return { multiplier: 1.12, label: '확인 시각 미기록', ageHours: null };
    const checkedTime = new Date(checkedAt).getTime();
    if (!Number.isFinite(checkedTime)) {
        return { multiplier: 1.12, label: '확인 시각 미기록', ageHours: null };
    }

    const ageHours = Math.max(0, (now - checkedTime) / 3_600_000);
    if (ageHours <= 8) {
        return { multiplier: 1, label: `${Math.max(1, Math.floor(ageHours))}시간 전 확인`, ageHours };
    }
    if (ageHours <= 16) return { multiplier: 1.03, label: `${Math.floor(ageHours)}시간 전 확인`, ageHours };
    if (ageHours <= 24) return { multiplier: 1.08, label: `${Math.floor(ageHours)}시간 전 확인`, ageHours };
    return { multiplier: 1.35, label: `${Math.floor(ageHours / 24)}일 이상 전 확인`, ageHours };
}

const NAVER_NEAR_AMOUNT = 20_000;
const NAVER_NEAR_RATIO = 0.1;

/** 네이버가 더 싸더라도 경쟁력이 비슷하다고 보는 최대 고정 차액이다. */
export function getAllowedNaverPriceGap(): number {
    return NAVER_NEAR_AMOUNT;
}

function displayPriceBand(effectivePrice: number): number {
    if (effectivePrice < 150_000) return 0;
    if (effectivePrice < 200_000) return 1;
    if (effectivePrice < 250_000) return 2;
    if (effectivePrice < 300_000) return 3;
    if (effectivePrice < 400_000) return 4;
    if (effectivePrice < 500_000) return 5;
    return 6;
}

function medianOf(samples: number[], minimumSamples: number): number | null {
    const sorted = samples.filter(sample => Number.isFinite(sample) && sample > 0).sort((a, b) => a - b);
    if (sorted.length < minimumSamples) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function evidenceStrength(
    effectivePrice: number,
    baseline: number | null,
    strongDiscountRatio: number,
): PriceEvidenceStrength {
    if (!baseline || baseline <= 0) return 0;
    if (effectivePrice <= baseline * (1 - strongDiscountRatio)) return 2;
    if (effectivePrice <= baseline) return 1;
    return 0;
}

function naverCompetitiveness(
    effectivePrice: number,
    comparisonPrice: number | null,
): { rank: TopRecommendationTier; strength: PriceEvidenceStrength } {
    if (!comparisonPrice || comparisonPrice <= 0) return { rank: 3, strength: 0 };
    const difference = effectivePrice - comparisonPrice;
    const ratio = difference / comparisonPrice;
    if (ratio <= -0.1) return { rank: 0, strength: 2 };
    if (difference <= 0) return { rank: 1, strength: 1 };
    if (difference <= NAVER_NEAR_AMOUNT || ratio <= NAVER_NEAR_RATIO) {
        return { rank: 2, strength: 0 };
    }
    return { rank: 4, strength: 0 };
}

function departureAreaKey(flight: Flight): string {
    const airport = flight.departure.airport?.trim().toUpperCase();
    if (airport === 'ICN' || airport === 'GMP') return 'SEOUL';
    if (airport === 'PUS') return 'BUSAN';
    if (airport === 'TAE') return 'DAEGU';
    if (airport === 'CJJ') return 'CHEONGJU';
    if (airport === 'CJU') return 'JEJU';
    return normalizeCity(flight.departure.city) || airport || 'UNKNOWN';
}

function routeKey(flight: Flight): string {
    return `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;
}

function regionKey(flight: Flight): string {
    const region = flight.region || getRegionByCity(normalizeCity(flight.arrival.city));
    return `${departureAreaKey(flight)}-${region}`;
}

function percentileOf(value: number, samples: number[], minimumSamples: number): number | null {
    const sorted = samples.filter(sample => Number.isFinite(sample) && sample > 0).sort((a, b) => a - b);
    if (sorted.length < minimumSamples) return null;
    if (sorted.length === 1) return 0;

    const lower = sorted.findIndex(sample => sample >= value);
    if (lower < 0) return 1;
    let upper = -1;
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
        if (sorted[index] <= value) {
            upper = index;
            break;
        }
    }
    return Math.max(0, Math.min(1, ((lower + Math.max(lower, upper)) / 2) / (sorted.length - 1)));
}

interface PriceAppealContext {
    regionPrices: Map<string, number[]>;
    routeHistoryPrices: Map<string, number[]>;
}

function buildPriceAppealContext(
    flights: Flight[],
    priceHistory: RecommendationPriceHistory,
): PriceAppealContext {
    const regionPrices = new Map<string, number[]>();
    for (const flight of flights) {
        const key = regionKey(flight);
        const prices = regionPrices.get(key) || [];
        prices.push(getEffectivePrice(flight));
        regionPrices.set(key, prices);
    }

    const routeHistoryPrices = new Map<string, number[]>();
    for (const [key, entries] of Object.entries(priceHistory)) {
        routeHistoryPrices.set(
            key,
            entries.map(entry => Number(entry.minPrice)).filter(price => Number.isFinite(price) && price > 0),
        );
    }
    return { regionPrices, routeHistoryPrices };
}

function priceAppealForFlight(
    flight: Flight,
    effectivePrice: number,
    context: PriceAppealContext,
) {
    const regionPricePercentile = percentileOf(
        effectivePrice,
        context.regionPrices.get(regionKey(flight)) || [],
        MIN_REGION_SAMPLE_COUNT,
    );
    const routeHistorySamples = context.routeHistoryPrices.get(routeKey(flight)) || [];
    const routeHistoryPercentile = percentileOf(
        effectivePrice,
        routeHistorySamples,
        MIN_ROUTE_HISTORY_SAMPLE_COUNT,
    );
    const available = [regionPricePercentile, routeHistoryPercentile]
        .filter((value): value is number => value !== null);
    const priceAppealPercentile = available.length
        ? available.reduce((sum, value) => sum + value, 0) / available.length
        : null;
    return {
        regionPricePercentile,
        routeHistoryPercentile,
        routeHistoryMedian: medianOf(routeHistorySamples, MIN_ROUTE_HISTORY_SAMPLE_COUNT),
        priceAppealPercentile,
        priceAttractive: priceAppealPercentile !== null
            && priceAppealPercentile <= ATTRACTIVE_PRICE_PERCENTILE,
    };
}

function evidenceRank(strength: PriceEvidenceStrength, known: boolean): number {
    if (strength === 2) return 0;
    if (strength === 1) return 1;
    return known ? 3 : 2;
}

function combinedOtherDateEvidence(
    nearbyStrength: PriceEvidenceStrength,
    nearbyKnown: boolean,
    interparkStrength: PriceEvidenceStrength,
    interparkKnown: boolean,
): { strength: PriceEvidenceStrength; rank: number } {
    const goodCount = Number(nearbyStrength >= 1) + Number(interparkStrength >= 1);
    const strength: PriceEvidenceStrength = nearbyStrength === 2
        || interparkStrength === 2
        || goodCount === 2
        ? 2
        : goodCount === 1
            ? 1
            : 0;
    return {
        strength,
        rank: evidenceRank(strength, nearbyKnown || interparkKnown),
    };
}

function closestInterparkMonth(
    flight: Flight,
    interparkPrices: InterparkPrices,
): { month: string | null; data: { avg: number; lowest: number } | null } {
    const city = flight.arrival.city?.replace(/\([^)]+\)/, '').trim();
    const departureMonth = flight.departure.date
        ?.replace(/\./g, '-')
        .replace(/\(.*\)/g, '')
        .trim()
        .substring(0, 7);
    const cityData = interparkPrices[city];
    const data = departureMonth ? cityData?.[departureMonth] : undefined;
    return { month: data ? departureMonth : null, data: data || null };
}

function scoreFlight(
    flight: Flight,
    interparkPrices: InterparkPrices,
    now: number,
    priceAppealContext: PriceAppealContext,
): RecommendationScoreExplanation {
    const effectivePrice = getEffectivePrice(flight);
    const interparkContext = departureAreaKey(flight) === 'SEOUL'
        ? closestInterparkMonth(flight, interparkPrices)
        : { month: null, data: null };
    const { month, data: interparkMonth } = interparkContext;
    const comparisonUsable = Boolean(
        flight.naverLowest
        && flight.naverLowest > 0
        && getComparisonFreshness(flight.naverCheckedAt, now).usable,
    );
    const comparisonPrice = comparisonUsable ? flight.naverLowest! : null;
    const factors: RecommendationScoreFactor[] = [];
    const priceAppeal = priceAppealForFlight(flight, effectivePrice, priceAppealContext);
    const naver = naverCompetitiveness(effectivePrice, comparisonPrice);
    const nearbyBaseline = Number(flight.nearbyNaverBaseline);
    const nearbyKnown = Number(flight.nearbyNaverSampleCount || 0) >= 2
        && Number.isFinite(nearbyBaseline)
        && nearbyBaseline > 0;
    const nearbyDateCompetitive = nearbyKnown ? effectivePrice <= nearbyBaseline * 1.1 : null;
    const nearbyEvidenceStrength: PriceEvidenceStrength = !nearbyKnown
        ? 0
        : effectivePrice <= nearbyBaseline * 0.85
            ? 2
            : effectivePrice <= nearbyBaseline * 1.1
                ? 1
                : 0;
    const interparkLowest = Number(interparkMonth?.lowest);
    const interparkKnown = Number.isFinite(interparkLowest) && interparkLowest > 0;
    const interparkDifference = effectivePrice - interparkLowest;
    const interparkRatio = interparkKnown ? interparkDifference / interparkLowest : Infinity;
    const interparkEvidenceStrength: PriceEvidenceStrength = !interparkKnown
        ? 0
        : interparkDifference <= 0
            ? 2
            : interparkDifference <= NAVER_NEAR_AMOUNT || interparkRatio <= NAVER_NEAR_RATIO
                ? 1
                : 0;
    const otherDates = combinedOtherDateEvidence(
        nearbyEvidenceStrength,
        nearbyKnown,
        interparkEvidenceStrength,
        interparkKnown,
    );
    let historyEvidenceStrength = evidenceStrength(
        effectivePrice,
        priceAppeal.routeHistoryMedian,
        0.15,
    );
    const monthWideDeal = Boolean(
        interparkEvidenceStrength >= 1
        && priceAppeal.routeHistoryMedian
        && effectivePrice <= priceAppeal.routeHistoryMedian,
    );
    if (monthWideDeal && historyEvidenceStrength === 0) historyEvidenceStrength = 1;
    const historyKnown = Boolean(priceAppeal.routeHistoryMedian && priceAppeal.routeHistoryMedian > 0);
    const historyEvidenceRank = evidenceRank(historyEvidenceStrength, historyKnown);
    const priceEvidenceStrengths = [
        naver.strength,
        otherDates.strength,
        historyEvidenceStrength,
    ];
    const goodPriceEvidenceCount = priceEvidenceStrengths.filter(strength => strength >= 1).length;
    const strongPriceEvidenceCount = priceEvidenceStrengths.filter(strength => strength >= 2).length;
    const expensivePromotionEligible = effectivePrice < 300_000
        || (effectivePrice < 400_000 && goodPriceEvidenceCount >= 2)
        || (effectivePrice < 500_000
            && (goodPriceEvidenceCount === 3 || strongPriceEvidenceCount >= 2))
        || (effectivePrice >= 500_000
            && goodPriceEvidenceCount === 3
            && strongPriceEvidenceCount >= 2);

    const naverMultiplier = [0.65, 0.8, 1, 1.15, 1.6][naver.rank];
    const otherDateMultiplier = [0.85, 0.95, 1.05, 1.15][otherDates.rank];
    const historyMultiplier = [0.9, 0.97, 1.03, 1.1][historyEvidenceRank];
    let score = effectivePrice * naverMultiplier * otherDateMultiplier * historyMultiplier;
    factors.push({
        rule: 'naver-same-date',
        multiplier: naverMultiplier,
        detail: comparisonPrice ? `동일 일정 ${comparisonPrice.toLocaleString()}원` : '동일 일정 비교가 없음',
    });
    if (nearbyKnown) {
        factors.push({
            rule: 'nearby-dates',
            multiplier: nearbyEvidenceStrength === 2 ? 0.85 : nearbyEvidenceStrength === 1 ? 0.95 : 1.15,
            detail: `앞뒤 7일 ${flight.nearbyNaverSampleCount || 0}건 중간값 ${nearbyBaseline.toLocaleString()}원`,
        });
    }
    if (interparkKnown) {
        factors.push({
            rule: 'interpark-month-lowest',
            multiplier: interparkEvidenceStrength === 2 ? 0.85 : interparkEvidenceStrength === 1 ? 0.95 : 1.15,
            detail: `${month} 월 최저 ${interparkLowest.toLocaleString()}원`,
        });
    }
    if (historyKnown) {
        factors.push({
            rule: 'route-history',
            multiplier: historyMultiplier,
            detail: `최근 노선 중간값 ${Math.round(priceAppeal.routeHistoryMedian!).toLocaleString()}원`,
        });
    }

    const freshness = getRecommendationFreshness(flight.priceCheckedAt, now);
    score *= freshness.multiplier;
    factors.push({ rule: 'price-freshness', multiplier: freshness.multiplier, detail: freshness.label });

    return {
        effectivePrice,
        comparisonTier: getComparisonPriceTier(flight, now),
        comparisonPrice,
        interparkMonth: month,
        interparkMonthlyLowest: interparkKnown ? interparkLowest : null,
        interparkMonthlyAverage: interparkKnown && Number(interparkMonth?.avg) > 0
            ? Number(interparkMonth?.avg)
            : null,
        scoreBeforeRouteCorrection: score,
        score,
        routePriceCorrectionApplied: false,
        topRecommendationTier: naver.rank,
        ...priceAppeal,
        nearbyDateCompetitive,
        naverCompetitivenessRank: naver.rank,
        displayPriceBand: displayPriceBand(effectivePrice),
        routeEvidenceRank: Math.min(3, otherDates.rank + historyEvidenceRank),
        otherDateEvidenceRank: otherDates.rank,
        historyEvidenceRank,
        naverEvidenceStrength: naver.strength,
        nearbyEvidenceStrength,
        interparkEvidenceStrength,
        otherDateEvidenceStrength: otherDates.strength,
        historyEvidenceStrength,
        goodPriceEvidenceCount,
        strongPriceEvidenceCount,
        monthWideDeal,
        expensivePromotionEligible,
        naverAllowedGap: NAVER_NEAR_AMOUNT,
        factors,
    };
}

/** 새 추천 근거를 한 번만 계산한다. 이전 인터파크 배수점수와 노선 점수 교환은 사용하지 않는다. */
export function buildRecommendationScoreState(
    flights: Flight[],
    interparkPrices: InterparkPrices,
    now = Date.now(),
    priceHistory: RecommendationPriceHistory = {},
): RecommendationScoreState {
    const explanations = new Map<string, RecommendationScoreExplanation>();
    const scores = new Map<string, number>();
    const priceAppealContext = buildPriceAppealContext(flights, priceHistory);
    for (const flight of flights) {
        const explanation = scoreFlight(flight, interparkPrices, now, priceAppealContext);
        explanations.set(flight.id, explanation);
        scores.set(flight.id, explanation.score);
    }

    return { scores, explanations };
}

function firstSeenTimestamp(flight: Flight): number {
    const timestamp = flight.firstSeen ? new Date(flight.firstSeen).getTime() : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

/** 합의한 새 추천 근거를 순서대로 비교한다. 이전 추천 배수점수는 순위 결정에 사용하지 않는다. */
export function compareRecommendedFlights(
    a: Flight,
    b: Flight,
    scores: Map<string, number>,
    now = Date.now(),
    explanations?: Map<string, RecommendationScoreExplanation>,
): number {
    const sameRoute = normalizeCity(a.departure.city) === normalizeCity(b.departure.city)
        && normalizeCity(a.arrival.city) === normalizeCity(b.arrival.city);
    if (sameRoute) {
        const competitiveness = getRoutePriceCompetitivenessTier(a, now)
            - getRoutePriceCompetitivenessTier(b, now);
        if (competitiveness !== 0) return competitiveness;

        const priceComparison = getEffectivePrice(a) - getEffectivePrice(b);
        if (priceComparison !== 0) return priceComparison;
    }

    const aExplanation = explanations?.get(a.id);
    const bExplanation = explanations?.get(b.id);
    if (!aExplanation || !bExplanation) {
        const tierComparison = getComparisonPriceTier(a, now) - getComparisonPriceTier(b, now);
        return tierComparison || (scores.get(a.id) ?? Infinity) - (scores.get(b.id) ?? Infinity);
    }

    const naverComparison = aExplanation.naverCompetitivenessRank
        - bExplanation.naverCompetitivenessRank;
    if (naverComparison !== 0) return naverComparison;

    const priceBandComparison = aExplanation.displayPriceBand - bExplanation.displayPriceBand;
    if (priceBandComparison !== 0) return priceBandComparison;

    const otherDatesComparison = aExplanation.otherDateEvidenceRank
        - bExplanation.otherDateEvidenceRank;
    if (otherDatesComparison !== 0) return otherDatesComparison;

    const historyComparison = aExplanation.historyEvidenceRank
        - bExplanation.historyEvidenceRank;
    if (historyComparison !== 0) return historyComparison;

    const newnessComparison = firstSeenTimestamp(b) - firstSeenTimestamp(a);
    if (newnessComparison !== 0) return newnessComparison;

    const priceComparison = getEffectivePrice(a) - getEffectivePrice(b);
    if (priceComparison !== 0) return priceComparison;

    return (scores.get(a.id) ?? Infinity) - (scores.get(b.id) ?? Infinity)
        || a.id.localeCompare(b.id);
}

/**
 * 이미 추천 비교 함수로 정렬된 후보를 실제 카드 진열 순서로 옮기고 모든 단계의 설명을 남긴다.
 * 오늘의 표, 첫 9개 목적지 제한, 9장 단위 출발지 비율과 15% 이내 다양성 선택을 그대로 따른다.
 */
export function buildRecommendationPresentation(
    rankedCandidates: Flight[],
    scoreState: RecommendationScoreState,
    options: RecommendationPresentationOptions = {},
): RecommendationPresentation {
    const {
        pinnedFlight,
        diversify = true,
        balanceIncheon = true,
        now = Date.now(),
    } = options;
    const pool = excludePinnedDestination(rankedCandidates, pinnedFlight);
    const diversityByFlightId = new Map<string, FlightDiversityDecision>();
    let orderedFlights = pool;

    if (diversify) {
        const result = diversifyRecommendationOrderWithDecisions(pool, {
            tierOf: flight => scoreState.explanations.get(flight.id)?.topRecommendationTier
                ?? getComparisonPriceTier(flight, now),
            maxConsecutiveDestinations: 1,
            topWindow: 9,
            maxPerDestination: 2,
            leadingFlights: pinnedFlight ? [pinnedFlight] : [],
            scoreOf: flight => scoreState.scores.get(flight.id) ?? Infinity,
            routeCompetitivenessTierOf: flight => getRoutePriceCompetitivenessTier(flight, now),
            expensivePromotionEligibleOf: flight => Boolean(
                scoreState.explanations.get(flight.id)?.expensivePromotionEligible
            ),
            balanceIncheon,
        });
        result.decisions.forEach(decision => diversityByFlightId.set(decision.flightId, decision));
        orderedFlights = result.flights;
    }

    const pinnedDestination = pinnedFlight ? normalizeCity(pinnedFlight.arrival.city) : null;
    const regularPositions = new Map(orderedFlights.map((flight, index) => [flight.id, index + 1]));
    const explanations = new Map<string, RecommendationPlacementExplanation>();
    rankedCandidates.forEach((flight, index) => {
        const isPinned = Boolean(pinnedFlight && flight.id === pinnedFlight.id);
        const samePinnedDestination = Boolean(
            pinnedDestination
            && normalizeCity(flight.arrival.city) === pinnedDestination,
        );
        const regularPosition = regularPositions.get(flight.id) ?? null;
        const score = scoreState.explanations.get(flight.id);
        if (!score) throw new Error('Missing recommendation score for candidate');
        const candidateRule: RecommendationCandidateRule = isPinned
            ? 'today-pick-pinned'
            : samePinnedDestination
                ? 'same-destination-as-today-pick'
                : 'passed-current-filters';
        explanations.set(flight.id, {
            flightId: flight.id,
            candidate: {
                inputPosition: index + 1,
                eligibleForRegularList: !isPinned && !samePinnedDestination,
                rule: candidateRule,
            },
            score,
            display: {
                comparisonTier: score.comparisonTier,
                rankedPosition: index + 1,
                regularPosition,
                displayPosition: isPinned ? 1 : regularPosition === null
                    ? null
                    : regularPosition + (pinnedFlight ? 1 : 0),
                rule: isPinned
                    ? 'today-pick-pinned'
                    : regularPosition === null
                        ? 'excluded'
                        : diversify
                            ? 'destination-diversity'
                            : 'comparison-tier-then-score',
                diversityDecision: diversityByFlightId.get(flight.id),
            },
        });
    });

    return { orderedFlights, explanations };
}
