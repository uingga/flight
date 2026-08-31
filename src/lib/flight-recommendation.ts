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

export type TopRecommendationTier = 0 | 1 | 2;

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
        | 'price-freshness';
    multiplier: number;
    detail: string;
}

export interface RecommendationScoreExplanation {
    effectivePrice: number;
    comparisonTier: 0 | 1 | 2;
    comparisonPrice: number | null;
    interparkMonth: string | null;
    scoreBeforeRouteCorrection: number;
    score: number;
    routePriceCorrectionApplied: boolean;
    topRecommendationTier: TopRecommendationTier;
    regionPricePercentile: number | null;
    routeHistoryPercentile: number | null;
    priceAppealPercentile: number | null;
    priceAttractive: boolean;
    nearbyDateCompetitive: boolean | null;
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

function comparisonMultiplier(effectivePrice: number, comparisonPrice: number): number {
    const ratio = (effectivePrice - comparisonPrice) / comparisonPrice;
    if (ratio <= -0.20) return 0.3;
    if (ratio <= -0.15) return 0.375;
    if (ratio <= -0.10) return 0.45;
    if (ratio <= -0.05) return 0.55;
    if (ratio <= 0) return 0.65;
    if (ratio <= 0.05) return 1.05;
    if (ratio <= 0.10) return 1.15;
    if (ratio <= 0.15) return 1.3;
    if (ratio <= 0.20) return 1.5;
    return 2;
}

/** 네이버가 더 싸더라도 상단 후보를 유지할 수 있는 작은 가격 차이다. */
export function getAllowedNaverPriceGap(effectivePrice: number): number {
    return Math.min(20_000, Math.max(7_500, Math.round(effectivePrice * 0.05)));
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
    const routeHistoryPercentile = percentileOf(
        effectivePrice,
        context.routeHistoryPrices.get(routeKey(flight)) || [],
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
        priceAppealPercentile,
        priceAttractive: priceAppealPercentile !== null
            && priceAppealPercentile <= ATTRACTIVE_PRICE_PERCENTILE,
    };
}

function getTopRecommendationTier(
    effectivePrice: number,
    comparisonPrice: number | null,
    priceAttractive: boolean,
    nearbyDateCompetitive: boolean | null,
): { tier: TopRecommendationTier; naverAllowedGap: number } {
    const naverAllowedGap = getAllowedNaverPriceGap(effectivePrice);
    const naverCheaperOrEqual = comparisonPrice !== null && effectivePrice <= comparisonPrice;
    const naverWithinTolerance = comparisonPrice !== null
        && effectivePrice > comparisonPrice
        && effectivePrice - comparisonPrice <= naverAllowedGap;

    if (priceAttractive && nearbyDateCompetitive === true && naverCheaperOrEqual) {
        return { tier: 0, naverAllowedGap };
    }
    if (
        naverCheaperOrEqual
        || (priceAttractive
            && nearbyDateCompetitive === true
            && (comparisonPrice === null || naverWithinTolerance))
    ) {
        return { tier: 1, naverAllowedGap };
    }
    return { tier: 2, naverAllowedGap };
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
    let month = departureMonth || null;
    let data = departureMonth ? cityData?.[departureMonth] : undefined;
    if (!data && cityData && departureMonth) {
        const closest = Object.keys(cityData).sort().reduce((best, candidateMonth) => {
            const diff = Math.abs(candidateMonth.localeCompare(departureMonth));
            const bestDiff = best ? Math.abs(best.localeCompare(departureMonth)) : Infinity;
            return diff < bestDiff ? candidateMonth : best;
        }, '' as string);
        if (closest) {
            month = closest;
            data = cityData[closest];
        }
    }
    return { month: data ? month : null, data: data || null };
}

function scoreFlight(
    flight: Flight,
    interparkPrices: InterparkPrices,
    now: number,
    priceAppealContext: PriceAppealContext,
): RecommendationScoreExplanation {
    const effectivePrice = getEffectivePrice(flight);
    const { month, data: interparkMonth } = closestInterparkMonth(flight, interparkPrices);
    const comparisonUsable = Boolean(
        flight.naverLowest
        && flight.naverLowest > 0
        && getComparisonFreshness(flight.naverCheckedAt, now).usable,
    );
    const comparisonPrice = comparisonUsable ? flight.naverLowest! : null;
    const isComparisonCheaper = Boolean(comparisonPrice && effectivePrice <= comparisonPrice);
    const factors: RecommendationScoreFactor[] = [];
    const priceAppeal = priceAppealForFlight(flight, effectivePrice, priceAppealContext);
    const nearbyBaseline = Number(flight.nearbyNaverBaseline);
    const nearbyDateCompetitive = Number.isFinite(nearbyBaseline) && nearbyBaseline > 0
        ? effectivePrice <= nearbyBaseline * 1.1
        : null;
    const topTier = getTopRecommendationTier(
        effectivePrice,
        comparisonPrice,
        priceAppeal.priceAttractive,
        nearbyDateCompetitive,
    );

    let score = effectivePrice;
    if (!interparkMonth) {
        score *= 1.1;
        factors.push({ rule: 'interpark-missing', multiplier: 1.1, detail: '월간 벤치마크 없음' });
    } else if (effectivePrice <= interparkMonth.lowest) {
        factors.push({ rule: 'interpark-monthly-lowest', multiplier: 1, detail: '월간 최저가 이하' });
    } else if (effectivePrice <= interparkMonth.lowest * 1.2) {
        score *= 1.15;
        factors.push({ rule: 'interpark-near-lowest', multiplier: 1.15, detail: '월간 최저가의 120% 이하' });
    } else if (effectivePrice < interparkMonth.avg) {
        score *= 1.3;
        factors.push({ rule: 'interpark-below-average', multiplier: 1.3, detail: '월간 평균 미만' });
    } else {
        const multiplier = isComparisonCheaper ? 1.3 : 10;
        score *= multiplier;
        factors.push({
            rule: 'interpark-average-or-higher',
            multiplier,
            detail: isComparisonCheaper ? '월간 평균 이상이지만 비교 최저가 이하' : '월간 평균 이상',
        });
    }

    if (comparisonPrice) {
        const multiplier = comparisonMultiplier(effectivePrice, comparisonPrice);
        score *= multiplier;
        factors.push({ rule: 'comparison-price', multiplier, detail: '24시간 이내 외부 비교가 반영' });
    }

    const freshness = getRecommendationFreshness(flight.priceCheckedAt, now);
    score *= freshness.multiplier;
    factors.push({ rule: 'price-freshness', multiplier: freshness.multiplier, detail: freshness.label });

    return {
        effectivePrice,
        comparisonTier: getComparisonPriceTier(flight, now),
        comparisonPrice,
        interparkMonth: month,
        scoreBeforeRouteCorrection: score,
        score,
        routePriceCorrectionApplied: false,
        topRecommendationTier: topTier.tier,
        ...priceAppeal,
        nearbyDateCompetitive,
        naverAllowedGap: topTier.naverAllowedGap,
        factors,
    };
}

/** 가격 품질과 신선도 점수를 계산하고, 같은 노선·가격 경쟁력 구간 안의 가격 역전만 보정한다. */
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

    const byRouteAndCompetitiveness = new Map<string, Flight[]>();
    for (const flight of flights) {
        const route = `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;
        const competitiveness = getRoutePriceCompetitivenessTier(flight, now);
        const key = `${route}|${competitiveness}`;
        const group = byRouteAndCompetitiveness.get(key);
        if (group) group.push(flight);
        else byRouteAndCompetitiveness.set(key, [flight]);
    }
    for (const group of Array.from(byRouteAndCompetitiveness.values())) {
        if (group.length < 2) continue;
        const slots = group.map(flight => scores.get(flight.id)!).sort((a, b) => a - b);
        group.slice()
            .sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b) || scores.get(a.id)! - scores.get(b.id)!)
            .forEach((flight, index) => {
                const correctedScore = slots[index];
                const explanation = explanations.get(flight.id)!;
                scores.set(flight.id, correctedScore);
                explanations.set(flight.id, {
                    ...explanation,
                    score: correctedScore,
                    routePriceCorrectionApplied: correctedScore !== explanation.scoreBeforeRouteCorrection,
                });
            });
    }

    // 같은 노선 안의 가격 역전 보정을 마친 뒤 해당 일정의 날짜 프리미엄을 적용한다.
    // 먼저 적용하면 다른 날짜의 점수 슬롯으로 감점이 이동할 수 있다.
    for (const flight of flights) {
        const multiplier = Number(flight.nearbyNaverRecommendationMultiplier || 1);
        if (!Number.isFinite(multiplier) || multiplier <= 1) continue;
        const currentScore = scores.get(flight.id) ?? Infinity;
        const adjustedScore = currentScore * multiplier;
        const explanation = explanations.get(flight.id)!;
        scores.set(flight.id, adjustedScore);
        explanations.set(flight.id, {
            ...explanation,
            score: adjustedScore,
            factors: [
                ...explanation.factors,
                {
                    rule: 'nearby-date-premium',
                    multiplier,
                    detail: `인접 일정 ${flight.nearbyNaverSampleCount || 0}건 기준보다 비쌈`,
                },
            ],
        });
    }

    return { scores, explanations };
}

/** 비교가 구간을 먼저, 같은 구간에서는 품질·신선도 점수를 적용하는 운영 추천 비교 함수다. */
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

    const tierComparison = (explanations?.get(a.id)?.topRecommendationTier ?? getComparisonPriceTier(a, now))
        - (explanations?.get(b.id)?.topRecommendationTier ?? getComparisonPriceTier(b, now));
    if (tierComparison !== 0) return tierComparison;
    return (scores.get(a.id) ?? Infinity) - (scores.get(b.id) ?? Infinity);
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
