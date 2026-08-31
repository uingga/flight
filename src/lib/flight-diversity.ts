import type { Flight } from '@/types/flight';
import { normalizeCity } from '@/lib/utils/flight-helpers';

export interface FlightDiversityOptions {
    topWindow?: number;
    maxPerDestination?: number;
    maxConsecutiveDestinations?: number;
    leadingFlights?: Flight[];
    scoreOf?: (flight: Flight) => number;
    balanceIncheon?: boolean;
}

export type FlightDiversityConstraintRule =
    | 'strict'
    | 'relaxed-top-window-limit'
    | 'relaxed-departure-balance'
    | 'relaxed-top-window-and-departure'
    | 'relaxed-first-nine-limit'
    | 'relaxed-all-limits'
    | 'only-remaining-destination';

export type FlightDiversityPreferenceRule =
    | 'original-rank'
    | 'incheon-balance-within-15-percent'
    | 'unseen-destination-within-15-percent';

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

function parseTravelDate(value: string): number | null {
    const match = value
        .replace(/\([^)]*\)/g, '')
        .match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const time = Date.UTC(year, month - 1, day);
    const parsed = new Date(time);
    if (
        parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day
    ) return null;
    return time;
}

/** 첫 9개에서 날짜만 바뀐 사실상 같은 표를 한 장으로 취급하기 위한 키다. */
function firstNineNearDuplicateKey(flight: Flight): string | null {
    const departureDate = parseTravelDate(flight.departure.date);
    const returnDate = parseTravelDate(flight.arrival.date);
    if (departureDate === null || returnDate === null || returnDate < departureDate) return null;

    const origin = flight.departure.airport?.trim().toUpperCase()
        || normalizeCity(flight.departure.city);
    const destination = normalizeCity(flight.arrival.city);
    const airline = flight.airline?.replace(/\s+/g, '').toLowerCase();
    const tripDays = Math.round((returnDate - departureDate) / 86_400_000);
    if (!origin || !destination || !airline || !Number.isFinite(flight.price)) return null;

    return [origin, destination, flight.price, airline, tripDays].join('|');
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
 * 뒤로 미룬다. 첫 9개에서는 출발지·목적지·가격·항공사·여행기간이 모두 같은 표도
 * 대표 한 장만 남긴다. 대체 표가 전혀 없을 때만 목록을 버리지 않기 위해 최종 완화한다.
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
        balanceIncheon = true,
    } = options;
    const remaining = [...items];
    const result: Flight[] = [];
    const decisions: FlightDiversityDecision[] = [];
    const sequence: Flight[] = [...leadingFlights];
    const topDestinationCounts = new Map<string, number>();
    const firstNineNearDuplicateKeys = new Set<string>();
    const originalIndexes = new Map(items.map((flight, index) => [flight, index]));

    sequence.slice(0, topWindow).forEach(flight => {
        const destination = normalizeCity(flight.arrival.city);
        topDestinationCounts.set(destination, (topDestinationCounts.get(destination) || 0) + 1);
    });
    sequence.slice(0, 9).forEach(flight => {
        const key = firstNineNearDuplicateKey(flight);
        if (key) firstNineNearDuplicateKeys.add(key);
    });

    while (remaining.length > 0) {
        const insideTopWindow = sequence.length < topWindow;
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

        const findCandidate = (
            keepTopLimit: boolean,
            keepFirstNineCap: boolean,
            keepDepartureBalance: boolean,
        ): { index: number; preferenceRule: FlightDiversityPreferenceRule } | null => {
            const eligibleIndexes = remaining
                .map((_, index) => index)
                .filter(index => {
                    const flight = remaining[index];
                    const destination = normalizeCity(flight.arrival.city);
                    const nearDuplicateKey = firstNineNearDuplicateKey(flight);
                    const destinationStreak = trailingDestinationStreak(destinationSequence, destination);
                    const departsFromIncheonArea = isIncheonAreaDeparture(flight);
                    return destinationStreak < maxConsecutiveDestinations
                        && (!keepTopLimit || !insideTopWindow || (topDestinationCounts.get(destination) || 0) < maxPerDestination)
                        && (!keepFirstNineCap || sequence.length >= 9 || (topDestinationCounts.get(destination) || 0) < maxPerDestination)
                        && (!keepFirstNineCap || sequence.length >= 9 || !nearDuplicateKey || !firstNineNearDuplicateKeys.has(nearDuplicateKey))
                        && (!keepDepartureBalance || !mustChooseIncheon || departsFromIncheonArea)
                        && (!keepDepartureBalance || incheonCount < 6 || !departsFromIncheonArea);
                });
            if (eligibleIndexes.length === 0) return null;

            const bestIndex = eligibleIndexes[0];
            const bestScore = scoreOf?.(remaining[bestIndex]);
            if (!insideTopWindow || !Number.isFinite(bestScore)) {
                return { index: bestIndex, preferenceRule: 'original-rank' };
            }

            if (balanceIncheon && incheonCount < desiredIncheonCount) {
                const incheonIndex = eligibleIndexes.find(index => {
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
                return { index: bestIndex, preferenceRule: 'original-rank' };
            }

            const unseenIndex = eligibleIndexes.find(index => {
                const flight = remaining[index];
                const destination = normalizeCity(flight.arrival.city);
                const score = scoreOf?.(flight);
                return (topDestinationCounts.get(destination) || 0) === 0
                    && Number.isFinite(score)
                    && score! <= bestScore! * 1.15;
            });
            return unseenIndex === undefined
                ? { index: bestIndex, preferenceRule: 'original-rank' }
                : { index: unseenIndex, preferenceRule: 'unseen-destination-within-15-percent' };
        };

        const attempts: Array<{
            rule: FlightDiversityConstraintRule;
            keepTopLimit: boolean;
            keepFirstNineCap: boolean;
            keepDepartureBalance: boolean;
        }> = [
            { rule: 'strict', keepTopLimit: true, keepFirstNineCap: true, keepDepartureBalance: true },
            { rule: 'relaxed-top-window-limit', keepTopLimit: false, keepFirstNineCap: true, keepDepartureBalance: true },
            { rule: 'relaxed-departure-balance', keepTopLimit: true, keepFirstNineCap: true, keepDepartureBalance: false },
            { rule: 'relaxed-top-window-and-departure', keepTopLimit: false, keepFirstNineCap: true, keepDepartureBalance: false },
            { rule: 'relaxed-first-nine-limit', keepTopLimit: true, keepFirstNineCap: false, keepDepartureBalance: true },
            { rule: 'relaxed-all-limits', keepTopLimit: false, keepFirstNineCap: false, keepDepartureBalance: false },
        ];
        let selection: { index: number; preferenceRule: FlightDiversityPreferenceRule } | null = null;
        let constraintRule: FlightDiversityConstraintRule = 'only-remaining-destination';
        for (const attempt of attempts) {
            selection = findCandidate(
                attempt.keepTopLimit,
                attempt.keepFirstNineCap,
                attempt.keepDepartureBalance,
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
        if (sequence.length <= 9) {
            const nearDuplicateKey = firstNineNearDuplicateKey(next);
            if (nearDuplicateKey) firstNineNearDuplicateKeys.add(nearDuplicateKey);
        }
        if (sequence.length <= topWindow) {
            topDestinationCounts.set(destination, (topDestinationCounts.get(destination) || 0) + 1);
        }
    }

    return { flights: result, decisions };
}
