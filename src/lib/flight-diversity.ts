import type { Flight } from '@/types/flight';
import { getEffectivePrice } from '@/lib/price-quality';
import { normalizeCity } from '@/lib/utils/flight-helpers';

export interface FlightDiversityOptions {
    topWindow?: number;
    maxPerDestination?: number;
    maxConsecutiveDestinations?: number;
    leadingFlights?: Flight[];
    scoreOf?: (flight: Flight) => number;
    routeCompetitivenessTierOf?: (flight: Flight) => number;
    expensivePromotionEligibleOf?: (flight: Flight) => boolean;
    balanceIncheon?: boolean;
}

export type FlightDiversityConstraintRule =
    | 'strict'
    | 'relaxed-top-window-limit'
    | 'relaxed-departure-balance'
    | 'relaxed-first-nine-limit'
    | 'relaxed-top-and-first-nine-limits'
    | 'relaxed-price-composition'
    | 'only-remaining-destination';

export type FlightDiversityPreferenceRule =
    | 'original-rank'
    | 'incheon-balance-within-15-percent'
    | 'unseen-destination-within-15-percent'
    | 'avoid-alternating-destinations';

/** 추천 배열의 순서를 바꾸지 않고, 각 카드를 고를 때 실제 적용된 규칙만 기록한다. */
export interface FlightDiversityDecision {
    flightId: string;
    selectionIndex: number;
    originalIndex: number;
    destination: string;
    constraintRule: FlightDiversityConstraintRule;
    preferenceRule: FlightDiversityPreferenceRule;
    insideTopWindow: boolean;
    firstNine: boolean;
    blockPosition: number;
    incheonCountBefore: number;
    destinationCountBefore: number;
    trailingDestinationCountBefore: number;
    departsFromIncheonArea: boolean;
}

export interface FlightDiversityResult {
    flights: Flight[];
    decisions: FlightDiversityDecision[];
}

function departureAreaKey(flight: Flight): string {
    const airport = flight.departure.airport?.trim().toUpperCase();
    if (airport === 'ICN' || airport === 'GMP') return 'SEOUL';
    if (airport === 'PUS') return 'BUSAN';
    if (airport === 'TAE') return 'DAEGU';
    if (airport === 'CJJ') return 'CHEONGJU';
    if (airport === 'CJU') return 'JEJU';

    const city = normalizeCity(flight.departure.city);
    if (/서울|인천|김포/.test(city)) return 'SEOUL';
    if (/부산|김해/.test(city)) return 'BUSAN';
    return airport || city;
}

/** 첫 9개에서 같은 출발권역·목적지를 한 선택지로 묶는 키다. */
function firstNineRouteKey(flight: Flight): string | null {
    const origin = departureAreaKey(flight);
    const destination = normalizeCity(flight.arrival.city);
    if (!origin || !destination) return null;
    return `${origin}|${destination}`;
}

/** 같은 노선에서는 가장 좋은 가격 경쟁력 구간을 먼저 고르고, 그 안의 최저가만 첫 9개 대표가 된다. */
function firstNineRouteRepresentativeIds(
    items: Flight[],
    routeCompetitivenessTierOf: (flight: Flight) => number = () => 0,
): Set<string> {
    const bestTierByRoute = new Map<string, number>();
    const lowestByRouteAndTier = new Map<string, number>();
    for (const flight of items) {
        const key = firstNineRouteKey(flight);
        if (!key) continue;
        const tier = routeCompetitivenessTierOf(flight);
        const price = getEffectivePrice(flight);
        const bestTier = bestTierByRoute.get(key);
        if (bestTier === undefined || tier < bestTier) bestTierByRoute.set(key, tier);
        const routeTierKey = `${key}|${tier}`;
        const current = lowestByRouteAndTier.get(routeTierKey);
        if (current === undefined || price < current) lowestByRouteAndTier.set(routeTierKey, price);
    }
    return new Set(items
        .filter(flight => {
            const key = firstNineRouteKey(flight);
            if (!key) return false;
            const tier = routeCompetitivenessTierOf(flight);
            return tier === bestTierByRoute.get(key)
                && getEffectivePrice(flight) === lowestByRouteAndTier.get(`${key}|${tier}`);
        })
        .map(flight => flight.id));
}

function isIncheonAreaDeparture(flight: Flight): boolean {
    const airport = flight.departure.airport?.toUpperCase();
    return airport === 'ICN'
        || airport === 'GMP'
        || /인천|김포|서울/.test(normalizeCity(flight.departure.city));
}

export function trailingDestinationStreak(destinations: string[], candidate: string): number {
    let streak = 0;
    for (let index = destinations.length - 1; index >= 0; index -= 1) {
        if (destinations[index] !== candidate) break;
        streak += 1;
    }
    return streak;
}

/** 후보를 붙였을 때 A-B-A-B 형태가 완성되는지 확인한다. */
export function createsAlternatingDestinationPattern(destinations: string[], candidate: string): boolean {
    if (destinations.length < 3) return false;
    const last = destinations.length - 1;
    return destinations[last - 2] === destinations[last]
        && destinations[last - 1] === candidate
        && destinations[last] !== candidate;
}

/** 다양성 규칙으로 뽑힌 첫 묶음의 구성은 유지하면서 새로 발견된 날짜순으로 정렬한다. */
export function sortFirstBlockByNewestArrival(items: Flight[], blockSize = 9): Flight[] {
    const firstBlockSize = Math.min(Math.max(0, blockSize), items.length);
    if (firstBlockSize <= 1) return items;

    const firstBlock = items.slice(0, firstBlockSize)
        .map((flight, index) => {
            const parsedFirstSeen = flight.firstSeen ? new Date(flight.firstSeen).getTime() : Number.NaN;
            return {
                flight,
                index,
                firstSeenTime: Number.isFinite(parsedFirstSeen) ? parsedFirstSeen : Number.NEGATIVE_INFINITY,
            };
        })
        .sort((a, b) => b.firstSeenTime - a.firstSeenTime || a.index - b.index)
        .map(item => item.flight);

    return [...firstBlock, ...items.slice(firstBlockSize)];
}

/** 오늘의 표와 같은 목적지는 기본 추천 배열에서 분리해 특별 카드의 의미를 지킨다. */
export function excludePinnedDestination(items: Flight[], pinnedFlight?: Flight): Flight[] {
    if (!pinnedFlight) return items;
    const pinnedDestination = normalizeCity(pinnedFlight.arrival.city);
    return items.filter(flight => (
        flight.id !== pinnedFlight.id
        && normalizeCity(flight.arrival.city) !== pinnedDestination
    ));
}

/**
 * 추천순 카드의 목적지 다양성을 조정한다.
 *
 * 같은 목적지는 두 장까지 연속으로 올 수 있다. 세 번째는 다른 목적지가 남아 있는 한
 * 뒤로 미룬다. 첫 9개에서는 같은 출발권역·목적지의 실질 결제가가 최저가와 같은 표만
 * 최대 두 장까지 남긴다. 더 비싼 날짜·여행사 표는 삭제하지 않고 첫 9개 뒤에서 보여준다.
 */
export function diversifyFlightDestinations(
    items: Flight[],
    options: FlightDiversityOptions = {},
): Flight[] {
    return diversifyFlightDestinationsWithDecisions(items, options).flights;
}

/**
 * 운영 추천순과 같은 선택을 하면서 테스트·어드민 설명에 쓸 결정 기록을 함께 돌려준다.
 * 외부 상태를 읽거나 기록하지 않는 순수 함수다.
 */
export function diversifyFlightDestinationsWithDecisions(
    items: Flight[],
    options: FlightDiversityOptions = {},
): FlightDiversityResult {
    if (items.length === 0) return { flights: items, decisions: [] };

    const {
        topWindow = 20,
        maxPerDestination = 2,
        maxConsecutiveDestinations = 2,
        leadingFlights = [],
        scoreOf,
        routeCompetitivenessTierOf,
        expensivePromotionEligibleOf = () => false,
        balanceIncheon = true,
    } = options;
    const remaining = [...items];
    const result: Flight[] = [];
    const decisions: FlightDiversityDecision[] = [];
    const sequence: Flight[] = [...leadingFlights];
    const topDestinationCounts = new Map<string, number>();
    const representativeIds = firstNineRouteRepresentativeIds(items, routeCompetitivenessTierOf);
    const originalIndexes = new Map(items.map((flight, index) => [flight, index]));

    sequence.slice(0, topWindow).forEach(flight => {
        const destination = normalizeCity(flight.arrival.city);
        topDestinationCounts.set(destination, (topDestinationCounts.get(destination) || 0) + 1);
    });
    while (remaining.length > 0) {
        const insideTopWindow = sequence.length < topWindow;
        const allDestinationSequence = sequence.map(flight => normalizeCity(flight.arrival.city));
        const destinationSequence = sequence
            .slice(-maxConsecutiveDestinations)
            .map(flight => normalizeCity(flight.arrival.city));
        const blockPosition = sequence.length % 9;
        const block = sequence.slice(sequence.length - blockPosition);
        const incheonCount = block.filter(isIncheonAreaDeparture).length;
        const positionsAfterNext = 8 - blockPosition;
        const availableIncheon = remaining.filter(isIncheonAreaDeparture).length;
        const canReachIncheonMinimum = incheonCount
            + Math.min(availableIncheon, positionsAfterNext + 1) >= 6;
        const mustChooseIncheon = balanceIncheon
            && canReachIncheonMinimum
            && incheonCount + positionsAfterNext < 6;
        const desiredIncheonCount = Math.floor(((blockPosition + 1) * 6) / 9);
        const firstNine = sequence.length < 9;
        const affordableCount = block.filter(isAffordableFirstScreenFlight).length;
        const availableAffordable = remaining.filter(isAffordableFirstScreenFlight).length;
        const canReachAffordableMinimum = affordableCount
            + Math.min(availableAffordable, positionsAfterNext + 1) >= 6;
        const mustChooseAffordable = firstNine
            && canReachAffordableMinimum
            && affordableCount + positionsAfterNext < 6;
        const priceBandCounts = block.reduce((counts, flight) => {
            const band = expensivePriceBand(flight);
            counts[band] += 1;
            return counts;
        }, {
            'under-300': 0,
            '300-400': 0,
            '400-500': 0,
            '500-plus': 0,
        });
        const over400Count = priceBandCounts['400-500'] + priceBandCounts['500-plus'];
        const eighteenBlockPosition = sequence.length % 18;
        const eighteenBlock = sequence.slice(sequence.length - eighteenBlockPosition);
        const fiveHundredPlusCount = eighteenBlock.filter(flight => (
            expensivePriceBand(flight) === '500-plus'
        )).length;

        const findCandidate = (
            keepTopLimit: boolean,
            keepFirstNineCap: boolean,
            keepDepartureBalance: boolean,
            keepPriceComposition: boolean,
        ): { index: number; preferenceRule: FlightDiversityPreferenceRule } | null => {
            const eligibleIndexes = remaining
                .map((_, index) => index)
                .filter(index => {
                    const flight = remaining[index];
                    const destination = normalizeCity(flight.arrival.city);
                    const routeKey = firstNineRouteKey(flight);
                    const destinationStreak = trailingDestinationStreak(destinationSequence, destination);
                    const departsFromIncheonArea = isIncheonAreaDeparture(flight);
                    const priceBand = expensivePriceBand(flight);
                    const affordable = isAffordableFirstScreenFlight(flight);
                    const priceCompositionAllowed = !keepPriceComposition || (
                        (!mustChooseAffordable || affordable)
                        && (getEffectivePrice(flight) < 300_000 || expensivePromotionEligibleOf(flight))
                        && (priceBand !== '300-400' || priceBandCounts['300-400'] < 2)
                        && (priceBand !== '400-500' || priceBandCounts['400-500'] < 1)
                        && (priceBand !== '500-plus' || fiveHundredPlusCount < 1)
                        && (getEffectivePrice(flight) < 400_000 || over400Count < 1)
                    );
                    return destinationStreak < maxConsecutiveDestinations
                        && (!keepTopLimit || !insideTopWindow || (topDestinationCounts.get(destination) || 0) < maxPerDestination)
                        && (!keepFirstNineCap || sequence.length >= 9 || (topDestinationCounts.get(destination) || 0) < maxPerDestination)
                        && (!keepFirstNineCap || sequence.length >= 9 || !routeKey || representativeIds.has(flight.id))
                        && (!keepDepartureBalance || !mustChooseIncheon || departsFromIncheonArea)
                        && (!keepDepartureBalance || !balanceIncheon || incheonCount < 6 || !departsFromIncheonArea)
                        && priceCompositionAllowed;
                });
            if (eligibleIndexes.length === 0) return null;

            const nonAlternatingIndexes = eligibleIndexes.filter(index => (
                !createsAlternatingDestinationPattern(
                    allDestinationSequence,
                    normalizeCity(remaining[index].arrival.city),
                )
            ));
            const candidateIndexes = nonAlternatingIndexes.length > 0
                ? nonAlternatingIndexes
                : eligibleIndexes;
            const avoidedAlternatingPattern = candidateIndexes[0] !== eligibleIndexes[0];

            const bestIndex = candidateIndexes[0];
            const bestScore = scoreOf?.(remaining[bestIndex]);
            if (!insideTopWindow || !Number.isFinite(bestScore)) {
                return {
                    index: bestIndex,
                    preferenceRule: avoidedAlternatingPattern
                        ? 'avoid-alternating-destinations'
                        : 'original-rank',
                };
            }

            if (balanceIncheon && incheonCount < desiredIncheonCount) {
                const incheonIndex = candidateIndexes.find(index => {
                    const score = scoreOf?.(remaining[index]);
                    return isIncheonAreaDeparture(remaining[index])
                        && Number.isFinite(score)
                        && score! <= bestScore! * 1.15;
                });
                if (incheonIndex !== undefined) {
                    return { index: incheonIndex, preferenceRule: 'incheon-balance-within-15-percent' };
                }
            }

            const bestDestination = normalizeCity(remaining[bestIndex].arrival.city);
            // 최고 후보가 직전 목적지와 같다면 두 번째 카드까지는 원래 순위를 존중한다.
            // 이 예외가 없으면 아래 unseen 우선순위가 사실상 같은 목적지 연속을 계속 막는다.
            if (trailingDestinationStreak(destinationSequence, bestDestination) === 1) {
                return {
                    index: bestIndex,
                    preferenceRule: avoidedAlternatingPattern
                        ? 'avoid-alternating-destinations'
                        : 'original-rank',
                };
            }

            const unseenIndex = candidateIndexes.find(index => {
                const flight = remaining[index];
                const destination = normalizeCity(flight.arrival.city);
                const score = scoreOf?.(flight);
                return (topDestinationCounts.get(destination) || 0) === 0
                    && Number.isFinite(score)
                    && score! <= bestScore! * 1.15;
            });
            return unseenIndex === undefined
                ? {
                    index: bestIndex,
                    preferenceRule: avoidedAlternatingPattern
                        ? 'avoid-alternating-destinations'
                        : 'original-rank',
                }
                : { index: unseenIndex, preferenceRule: 'unseen-destination-within-15-percent' };
        };

        const attempts: Array<{
            rule: FlightDiversityConstraintRule;
            keepTopLimit: boolean;
            keepFirstNineCap: boolean;
            keepDepartureBalance: boolean;
            keepPriceComposition: boolean;
        }> = [
            { rule: 'strict', keepTopLimit: true, keepFirstNineCap: true, keepDepartureBalance: true, keepPriceComposition: true },
            { rule: 'relaxed-top-window-limit', keepTopLimit: false, keepFirstNineCap: true, keepDepartureBalance: true, keepPriceComposition: true },
            { rule: 'relaxed-first-nine-limit', keepTopLimit: true, keepFirstNineCap: false, keepDepartureBalance: true, keepPriceComposition: true },
            { rule: 'relaxed-top-and-first-nine-limits', keepTopLimit: false, keepFirstNineCap: false, keepDepartureBalance: true, keepPriceComposition: true },
            { rule: 'relaxed-price-composition', keepTopLimit: false, keepFirstNineCap: false, keepDepartureBalance: true, keepPriceComposition: false },
            { rule: 'relaxed-departure-balance', keepTopLimit: false, keepFirstNineCap: false, keepDepartureBalance: false, keepPriceComposition: false },
        ];
        let selection: { index: number; preferenceRule: FlightDiversityPreferenceRule } | null = null;
        let constraintRule: FlightDiversityConstraintRule = 'only-remaining-destination';
        for (const attempt of attempts) {
            selection = findCandidate(
                attempt.keepTopLimit,
                attempt.keepFirstNineCap,
                attempt.keepDepartureBalance,
                attempt.keepPriceComposition,
            );
            if (selection) {
                constraintRule = attempt.rule;
                break;
            }
        }
        // 남은 표가 모두 같은 목적지라면 목록을 유실시키지 않고 최종적으로만 제한을 푼다.
        if (!selection) selection = { index: 0, preferenceRule: 'original-rank' };

        const [next] = remaining.splice(selection.index, 1);
        const destination = normalizeCity(next.arrival.city);
        decisions.push({
            flightId: next.id,
            selectionIndex: result.length,
            originalIndex: originalIndexes.get(next) ?? -1,
            destination,
            constraintRule,
            preferenceRule: selection.preferenceRule,
            insideTopWindow,
            firstNine: sequence.length < 9,
            blockPosition,
            incheonCountBefore: incheonCount,
            destinationCountBefore: topDestinationCounts.get(destination) || 0,
            trailingDestinationCountBefore: trailingDestinationStreak(destinationSequence, destination),
            departsFromIncheonArea: isIncheonAreaDeparture(next),
        });
        result.push(next);
        sequence.push(next);
        if (sequence.length <= topWindow) {
            topDestinationCounts.set(destination, (topDestinationCounts.get(destination) || 0) + 1);
        }
    }

    return { flights: result, decisions };
}

export interface RecommendationDiversityOptions extends FlightDiversityOptions {
    tierOf: (flight: Flight) => number;
    firstBlockSize?: number;
}

function isAffordableFirstScreenFlight(flight: Flight): boolean {
    return getEffectivePrice(flight) <= 250_000;
}

function expensivePriceBand(flight: Flight): 'under-300' | '300-400' | '400-500' | '500-plus' {
    const price = getEffectivePrice(flight);
    if (price < 300_000) return 'under-300';
    if (price < 400_000) return '300-400';
    if (price < 500_000) return '400-500';
    return '500-plus';
}

/**
 * 비교가 구간 순서를 지키면서 첫 묶음은 노선별 최저가 일정만 구성한다.
 * 첫 묶음에 들지 않은 다른 일정은 같은 정렬 규칙으로 뒤에 이어 붙인다.
 */
export function diversifyRecommendationOrderWithDecisions(
    items: Flight[],
    options: RecommendationDiversityOptions,
): FlightDiversityResult {
    if (items.length === 0) return { flights: [], decisions: [] };

    const {
        firstBlockSize = 9,
        leadingFlights = [],
        ...diversityOptions
    } = options;
    // 추천 본체가 이미 가격 근거를 모두 반영해 정렬한 순서를 그대로 받는다.
    // 진열 단계에서는 목적지·출발지·가격대 구성만 조정하고 추천 점수를 다시 계산하지 않는다.
    const rankedItems = items.slice();
    const representativeIds = firstNineRouteRepresentativeIds(items, options.routeCompetitivenessTierOf);
    const representativePool = rankedItems.filter(flight => representativeIds.has(flight.id));
    const representativeResult = diversifyFlightDestinationsWithDecisions(
        representativePool,
        {
            ...diversityOptions,
            topWindow: firstBlockSize,
            leadingFlights,
        },
    );
    const availableSlots = Math.max(0, firstBlockSize - leadingFlights.length);
    const selectedFirstBlock = representativeResult.flights.slice(0, availableSlots);
    const firstBlock = selectedFirstBlock;
    const firstBlockIds = new Set(firstBlock.map(flight => flight.id));
    const firstBlockDecisionById = new Map(
        representativeResult.decisions.map(decision => [decision.flightId, decision]),
    );
    const tailResult = diversifyFlightDestinationsWithDecisions(
        rankedItems.filter(flight => !firstBlockIds.has(flight.id)),
        {
            ...diversityOptions,
            leadingFlights: [...leadingFlights, ...firstBlock],
            topWindow: 0,
            maxConsecutiveDestinations: 2,
            balanceIncheon: false,
        },
    );

    return {
        flights: [...firstBlock, ...tailResult.flights],
        decisions: [
            ...firstBlock.map((flight, index) => ({
                ...firstBlockDecisionById.get(flight.id)!,
                selectionIndex: index,
                firstNine: true,
            })),
            ...tailResult.decisions.map((decision, index) => ({
                ...decision,
                selectionIndex: firstBlock.length + index,
                firstNine: false,
            })),
        ],
    };
}

export function diversifyRecommendationOrder(
    items: Flight[],
    options: RecommendationDiversityOptions,
): Flight[] {
    return diversifyRecommendationOrderWithDecisions(items, options).flights;
}
