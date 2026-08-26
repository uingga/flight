export type NaverCrawlPageState = 'results' | 'no_result' | 'route_error' | 'blocked' | 'transient_error';

export interface NaverPageSnapshot {
    url?: string;
    bodyText?: string;
    priceCount?: number;
    httpStatus?: number | null;
}

/**
 * 가격이 없다는 사실만으로 네이버 차단이라고 단정하지 않는다.
 * 잘못된/미지원 노선, 정상적인 검색 결과 없음, 접근 제한을 서로 구분한다.
 */
export function classifyNaverPageState(snapshot: NaverPageSnapshot): NaverCrawlPageState {
    if ((snapshot.priceCount || 0) > 0) return 'results';

    const status = Number(snapshot.httpStatus || 0);
    const url = String(snapshot.url || '');
    const text = String(snapshot.bodyText || '').replace(/\s+/g, ' ');

    if (
        status === 403
        || status === 429
        || /비정상적인 접근|접근.{0,8}제한|자동입력 방지|captcha|too many requests/i.test(text)
    ) return 'blocked';

    if (/검색 결과가 없습니다|조건에 맞는 항공권이 없습니다|항공편이 없습니다|운항편이 없습니다/.test(text)) {
        return 'no_result';
    }

    if (/\/error(?:[?#/]|$)/.test(url) || /일시적으로 서비스를 이용할 수 없습니다/.test(text)) {
        return 'route_error';
    }

    return 'transient_error';
}

export function naverPageStateLabel(state: NaverCrawlPageState): string {
    const labels: Record<NaverCrawlPageState, string> = {
        results: '가격 확인',
        no_result: '검색 결과 없음',
        route_error: '지원하지 않거나 잘못된 노선',
        blocked: '접근 제한',
        transient_error: '일시적 로딩/응답 실패',
    };
    return labels[state];
}
