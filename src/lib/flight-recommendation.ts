import type { Flight } from '../types/flight';
import {
    diversifyFlightDestinationsWithDecisions,
    excludePinnedDestination,
    type FlightDiversityDecision,
} from './flight-diversity';
import {
    getComparisonFreshness,
    getComparisonPriceTier,
    getEffectivePrice,
} from './price-quality';
import { normalizeCity } from './utils/flight-helpers';

export type InterparkPrices = Record<string, Record<string, { avg: number; lowest: number }>>;

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
        factors,
    };
}

/** 가격 품질과 신선도 점수를 계산하고, 같은 노선 안의 가격 역전만 기존 방식대로 보정한다. */
export function buildRecommendationScoreState(
    flights: Flight[],
    interparkPrices: InterparkPrices,
    now = Date.now(),
): RecommendationScoreState {
    const explanations = new Map<string, RecommendationScoreExplanation>();
    const scores = new Map<string, number>();
    for (const flight of flights) {
        const explanation = scoreFlight(flight, interparkPrices, now);
        explanations.set(flight.id, explanation);
        scores.set(flight.id, explanation.score);
    }

    const byRoute = new Map<string, Flight[]>();
    for (const flight of flights) {
        const key = `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;
        const group = byRoute.get(key);
        if (group) group.push(flight);
        else byRoute.set(key, [flight]);
    }
    for (const group of Array.from(byRoute.values())) {
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
                    detail: `최근 14일 인접 일정 ${flight.nearbyNaverSampleCount || 0}건 기준보다 비쌈`,
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
): number {
    const tierComparison = getComparisonPriceTier(a, now) - getComparisonPriceTier(b, now);
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
        const result: Flight[] = [];
        const leadingFlights: Flight[] = [];
        for (const tier of [0, 1, 2] as const) {
            const group = diversifyFlightDestinationsWithDecisions(
                pool.filter(flight => getComparisonPriceTier(flight, now) === tier),
                {
                    maxConsecutiveDestinations: 2,
                    topWindow: 20,
                    maxPerDestination: 2,
                    leadingFlights,
                    scoreOf: flight => scoreState.scores.get(flight.id) ?? Infinity,
                    balanceIncheon,
                },
            );
            result.push(...group.flights);
            group.decisions.forEach(decision => diversityByFlightId.set(decision.flightId, decision));
            leadingFlights.push(...group.flights);
        }
        orderedFlights = result;
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
