import {
    getComparisonFreshness,
    getRecommendationComparisonFreshness,
} from './price-quality';

export interface NaverComparisonEntry {
    naverLowest?: unknown;
    crawledAt?: string;
    lastAttemptStatus?: string;
}

/**
 * 항공권 제거·알림처럼 오래된 가격을 공격적으로 쓰면 안 되는 단계의 24시간 비교가.
 * 정상 빈 결과/잘못된 노선 뒤에 과거 가격이 계속 붙는 일을 막고,
 * 일시 오류 때도 24시간 이내 성공값만 유지한다.
 */
export function getUsableNaverComparison(
    entry: NaverComparisonEntry | null | undefined,
    now = Date.now(),
): { price: number; checkedAt: string } | null {
    if (!entry) return null;

    const price = Number(entry.naverLowest);
    if (!Number.isFinite(price) || price <= 0 || !entry.crawledAt) return null;
    if (!getComparisonFreshness(entry.crawledAt, now).usable) return null;

    const status = entry.lastAttemptStatus;
    if (status === 'no_result' || status === 'route_error' || status === 'miss') return null;

    return { price, checkedAt: entry.crawledAt };
}

/**
 * 추천·표시 단계는 부분 수집 주기에 맞춰 72시간까지 가격을 전달한다.
 * 48시간 이후의 실제 감점은 추천 점수 계산기가 담당하며, 제거 필터에는 사용하지 않는다.
 */
export function getRecommendationNaverComparison(
    entry: NaverComparisonEntry | null | undefined,
    now = Date.now(),
): { price: number; checkedAt: string } | null {
    if (!entry) return null;

    const price = Number(entry.naverLowest);
    if (!Number.isFinite(price) || price <= 0 || !entry.crawledAt) return null;
    if (!getRecommendationComparisonFreshness(entry.crawledAt, now).usable) return null;

    const status = entry.lastAttemptStatus;
    if (status === 'no_result' || status === 'route_error' || status === 'miss') return null;

    return { price, checkedAt: entry.crawledAt };
}
