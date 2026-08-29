import {
    evaluateNaverRefresh,
    type NaverRefreshConfig,
    type NaverRefreshDecision,
    type NaverRefreshEntry,
    type NaverRefreshFlight,
    type NaverRefreshReason,
} from './naver-refresh-policy';

export type NaverCrawlPriorityGroup =
    | 'deadline'
    | 'changed_top'
    | 'top'
    | 'standard'
    | 'low';

export interface NaverCrawlPriorityCandidate<T extends NaverRefreshFlight> {
    key: string;
    flight: T;
    provisionalScore: number;
}

export interface NaverCrawlPriorityEntry extends NaverRefreshEntry {
    firstQueuedAt?: string;
}

export interface NaverCrawlPriorityRow<T extends NaverRefreshFlight> {
    key: string;
    flight: T;
    provisionalRank: number;
    group: NaverCrawlPriorityGroup;
    queueAgeDays: number;
    decision: NaverRefreshDecision;
}

export interface NaverCrawlPriorityOptions {
    limit: number;
    now?: number;
    topCandidateCount?: number;
    lowCandidateRatio?: number;
    maxDeferDays?: number;
    refreshConfig: NaverRefreshConfig;
}

export interface NaverCrawlPrioritySelection<T extends NaverRefreshFlight> {
    selected: NaverCrawlPriorityRow<T>[];
    pending: NaverCrawlPriorityRow<T>[];
    eligible: NaverCrawlPriorityRow<T>[];
    skippedFresh: number;
    groupCounts: Record<NaverCrawlPriorityGroup, number>;
    selectedGroupCounts: Record<NaverCrawlPriorityGroup, number>;
    reasonCounts: Record<NaverRefreshReason, number>;
}

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

const kstDayNumber = (timestamp: number): number =>
    Math.floor((timestamp + KST_OFFSET_MS) / DAY_MS);

const priorityOrder: Record<NaverCrawlPriorityGroup, number> = {
    deadline: 0,
    changed_top: 1,
    top: 2,
    standard: 3,
    low: 4,
};

const emptyCounts = (): Record<NaverCrawlPriorityGroup, number> => ({
    deadline: 0,
    changed_top: 0,
    top: 0,
    standard: 0,
    low: 0,
});

function queueAgeDays(entry: NaverCrawlPriorityEntry | undefined, now: number): number {
    const timestamp = new Date(
        entry?.lastAttemptAt
        || entry?.crawledAt
        || entry?.firstQueuedAt
        || '',
    ).getTime();
    if (!Number.isFinite(timestamp)) return 0;
    return Math.max(0, kstDayNumber(now) - kstDayNumber(timestamp));
}

/**
 * 네이버 값을 제외한 임시 추천순을 받아 하루 검색 대상을 정한다.
 *
 * 1. 신규·의미 있는 여행사 가격 변경 + 추천 상위
 * 2. 나머지 추천 상위
 * 3. 추천 중간
 * 4. 추천 하위
 *
 * 단, 마지막 시도 또는 최초 대기 후 maxDeferDays가 된 항목은 deadline으로
 * 승격해 추천 하위 항목도 영구적으로 밀리지 않게 한다.
 */
export function selectNaverCrawlCandidates<T extends NaverRefreshFlight>(
    candidates: NaverCrawlPriorityCandidate<T>[],
    entries: Record<string, NaverCrawlPriorityEntry | undefined>,
    options: NaverCrawlPriorityOptions,
): NaverCrawlPrioritySelection<T> {
    const now = options.now ?? Date.now();
    const limit = Math.max(0, Math.floor(options.limit));
    const topCandidateCount = Math.max(0, Math.floor(options.topCandidateCount ?? 50));
    const lowCandidateRatio = Math.min(1, Math.max(0, options.lowCandidateRatio ?? 0.3));
    const maxDeferDays = Math.max(1, Math.floor(options.maxDeferDays ?? 7));
    const ranked = [...candidates].sort((left, right) => (
        left.provisionalScore - right.provisionalScore
        || left.key.localeCompare(right.key)
    ));
    const rankByKey = new Map(ranked.map((candidate, index) => [candidate.key, index + 1]));
    const lowStartRank = Math.max(
        topCandidateCount + 1,
        Math.floor(ranked.length * (1 - lowCandidateRatio)) + 1,
    );
    const groupCounts = emptyCounts();
    const reasonCounts: Record<NaverRefreshReason, number> = {
        new: 0,
        source_changed: 0,
        retry_wait: 0,
        retry_due: 0,
        priority_fresh: 0,
        priority_periodic: 0,
        standard_fresh: 0,
        standard_periodic: 0,
    };
    let skippedFresh = 0;

    const eligible: NaverCrawlPriorityRow<T>[] = [];
    for (const candidate of ranked) {
        const entry = entries[candidate.key];
        const decision = evaluateNaverRefresh(entry, candidate.flight, now, options.refreshConfig);
        reasonCounts[decision.reason]++;
        if (decision.fresh) {
            skippedFresh++;
            continue;
        }

        const provisionalRank = rankByKey.get(candidate.key) ?? Number.MAX_SAFE_INTEGER;
        const ageDays = queueAgeDays(entry, now);
        const isTop = provisionalRank <= topCandidateCount;
        const isChanged = decision.reason === 'new' || decision.reason === 'source_changed';
        const group: NaverCrawlPriorityGroup = ageDays >= maxDeferDays
            ? 'deadline'
            : isTop && isChanged
                ? 'changed_top'
                : isTop
                    ? 'top'
                    : provisionalRank >= lowStartRank
                        ? 'low'
                        : 'standard';
        groupCounts[group]++;
        eligible.push({
            key: candidate.key,
            flight: candidate.flight,
            provisionalRank,
            group,
            queueAgeDays: ageDays,
            decision,
        });
    }

    eligible.sort((left, right) => {
        const groupDifference = priorityOrder[left.group] - priorityOrder[right.group];
        if (groupDifference !== 0) return groupDifference;
        if (left.group === 'changed_top' || left.group === 'top') {
            return left.provisionalRank - right.provisionalRank
                || right.queueAgeDays - left.queueAgeDays;
        }
        return right.queueAgeDays - left.queueAgeDays
            || left.provisionalRank - right.provisionalRank;
    });

    const selected = eligible.slice(0, limit);
    const selectedGroupCounts = emptyCounts();
    for (const row of selected) selectedGroupCounts[row.group]++;

    return {
        selected,
        pending: eligible.slice(limit),
        eligible,
        skippedFresh,
        groupCounts,
        selectedGroupCounts,
        reasonCounts,
    };
}

export function naverCrawlPriorityGroupLabel(group: NaverCrawlPriorityGroup): string {
    switch (group) {
        case 'deadline': return '7일 마감 승격';
        case 'changed_top': return '신규·가격 변경 추천 상위';
        case 'top': return '추천 상위';
        case 'standard': return '보통';
        case 'low': return '추천 하위';
    }
}
