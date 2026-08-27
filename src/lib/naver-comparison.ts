import { getComparisonFreshness } from './price-quality';

export interface NaverComparisonEntry {
    naverLowest?: unknown;
    crawledAt?: string;
    lastAttemptStatus?: string;
}

/**
 * 네이버 원본 기록에는 마지막으로 성공한 가격을 보존하되, 현재 화면과 필터에는
 * 최근 시도 결과까지 정상인 비교가만 사용한다. 정상 빈 결과/잘못된 노선 뒤에
 * 과거 가격이 계속 붙는 일을 막고, 일시 오류 때는 3일 이내 성공값만 유지한다.
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
