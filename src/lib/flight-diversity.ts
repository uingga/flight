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
 * 뒤로 미루며, 대체 목적지가 전혀 없을 때만 목록을 버리지 않기 위해 최종 완화한다.
 */
export function diversifyFlightDestinations(
    items: Flight[],
    options: FlightDiversityOptions = {},
): Flight[] {
    if (items.length <= 1) return items;

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
    const sequence: Flight[] = [...leadingFlights];
    const topDestinationCounts = new Map<string, number>();

    sequence.slice(0, topWindow).forEach(flight => {
        const destination = normalizeCity(flight.arrival.city);
        topDestinationCounts.set(destination, (topDestinationCounts.get(destination) || 0) + 1);
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
        ) => {
            const eligibleIndexes = remaining
                .map((_, index) => index)
                .filter(index => {
                    const flight = remaining[index];
                    const destination = normalizeCity(flight.arrival.city);
                    const destinationStreak = trailingDestinationStreak(destinationSequence, destination);
                    const departsFromIncheonArea = isIncheonAreaDeparture(flight);
                    return destinationStreak < maxConsecutiveDestinations
                        && (!keepTopLimit || !insideTopWindow || (topDestinationCounts.get(destination) || 0) < maxPerDestination)
                        && (!keepFirstNineCap || sequence.length >= 9 || (topDestinationCounts.get(destination) || 0) < maxPerDestination)
                        && (!keepDepartureBalance || !mustChooseIncheon || departsFromIncheonArea)
                        && (!keepDepartureBalance || incheonCount < 6 || !departsFromIncheonArea);
                });
            if (eligibleIndexes.length === 0) return -1;

            const bestIndex = eligibleIndexes[0];
            const bestScore = scoreOf?.(remaining[bestIndex]);
            if (!insideTopWindow || !Number.isFinite(bestScore)) return bestIndex;

            if (balanceIncheon && incheonCount < desiredIncheonCount) {
                const incheonIndex = eligibleIndexes.find(index => {
                    const score = scoreOf?.(remaining[index]);
                    return isIncheonAreaDeparture(remaining[index])
                        && Number.isFinite(score)
                        && score! <= bestScore! * 1.15;
                });
                if (incheonIndex !== undefined) return incheonIndex;
            }

            const bestDestination = normalizeCity(remaining[bestIndex].arrival.city);
            // 최고 후보가 직전 목적지와 같다면 두 번째 카드까지는 원래 순위를 존중한다.
            // 이 예외가 없으면 아래 unseen 우선순위가 사실상 같은 목적지 연속을 계속 막는다.
            if (trailingDestinationStreak(destinationSequence, bestDestination) === 1) return bestIndex;

            const unseenIndex = eligibleIndexes.find(index => {
                const flight = remaining[index];
                const destination = normalizeCity(flight.arrival.city);
                const score = scoreOf?.(flight);
                return (topDestinationCounts.get(destination) || 0) === 0
                    && Number.isFinite(score)
                    && score! <= bestScore! * 1.15;
            });
            return unseenIndex ?? bestIndex;
        };

        let candidateIndex = findCandidate(true, true, true);
        if (candidateIndex < 0) candidateIndex = findCandidate(false, true, true);
        if (candidateIndex < 0) candidateIndex = findCandidate(true, true, false);
        if (candidateIndex < 0) candidateIndex = findCandidate(false, true, false);
        if (candidateIndex < 0) candidateIndex = findCandidate(true, false, true);
        if (candidateIndex < 0) candidateIndex = findCandidate(false, false, false);
        // 남은 표가 모두 같은 목적지라면 목록을 유실시키지 않고 최종적으로만 제한을 푼다.
        if (candidateIndex < 0) candidateIndex = 0;

        const [next] = remaining.splice(candidateIndex, 1);
        result.push(next);
        sequence.push(next);
        if (sequence.length <= topWindow) {
            const destination = normalizeCity(next.arrival.city);
            topDestinationCounts.set(destination, (topDestinationCounts.get(destination) || 0) + 1);
        }
    }

    return result;
}
