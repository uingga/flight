import {
    getComparisonFreshness,
    getRecommendationComparisonFreshness,
} from './price-quality';
import type { Flight } from '../types/flight';

export interface NaverComparisonEntry {
    naverLowest?: unknown;
    crawledAt?: string;
    lastAttemptStatus?: string;
}

/**
 * 알림처럼 최신 가격이 필요한 단계의 24시간 비교가.
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
 * 일반 여행사는 72시간, 마이리얼트립·트립닷컴은 24시간까지 가격을 전달한다.
 * 정상 근거 기간 뒤의 감점은 추천 점수 계산기가 담당한다.
 */
export function getRecommendationNaverComparison(
    entry: NaverComparisonEntry | null | undefined,
    now = Date.now(),
    source?: Flight['source'],
): { price: number; checkedAt: string } | null {
    if (!entry) return null;

    const price = Number(entry.naverLowest);
    if (!Number.isFinite(price) || price <= 0 || !entry.crawledAt) return null;
    if (!getRecommendationComparisonFreshness(entry.crawledAt, now, source).usable) return null;

    const status = entry.lastAttemptStatus;
    if (status === 'no_result' || status === 'route_error' || status === 'miss') return null;

    return { price, checkedAt: entry.crawledAt };
}

/** 제외 판단도 표시와 같은 소스별 유효시간 및 실패 상태 검증을 적용한다. */
export const getPriceExclusionNaverComparison = getRecommendationNaverComparison;
