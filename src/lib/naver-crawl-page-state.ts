export type NaverCrawlPageState = 'results' | 'no_result' | 'route_error' | 'blocked' | 'transient_error';

export interface NaverPageSnapshot {
    url?: string;
    bodyText?: string;
    priceCount?: number;
    httpStatus?: number | null;
    graphqlResponseCount?: number;
    graphqlSuccessCount?: number;
    graphqlErrorCount?: number;
    graphqlProblemStatus?: number | null;
    isLoading?: boolean;
    searchPageReached?: boolean;
}

/**
 * 가격이 없다는 사실만으로 네이버 차단이라고 단정하지 않는다.
 * 잘못된/미지원 노선, 정상적인 검색 결과 없음, 접근 제한을 서로 구분한다.
 */
export function classifyNaverPageState(snapshot: NaverPageSnapshot): NaverCrawlPageState {
    if ((snapshot.priceCount || 0) > 0) return 'results';

    const status = Number(snapshot.httpStatus || 0);
    const graphqlProblemStatus = Number(snapshot.graphqlProblemStatus || 0);
    const url = String(snapshot.url || '');
    const text = String(snapshot.bodyText || '').replace(/\s+/g, ' ');

    if (
        status === 403
        || status === 429
        || graphqlProblemStatus === 403
        || graphqlProblemStatus === 429
        || /비정상적인 접근|접근.{0,8}제한|자동입력 방지|captcha|too many requests/i.test(text)
    ) return 'blocked';

    if (status >= 500 || graphqlProblemStatus >= 500) return 'transient_error';

    if (/검색 결과가 없습니다|조건에 맞는 항공권이 없습니다|항공편이 없습니다|운항편이 없습니다/.test(text)) {
        return 'no_result';
    }

    if (/일시적으로 서비스를 이용할 수 없습니다/.test(text)) return 'transient_error';
    if (/\/error(?:[?#/]|$)/.test(url)) return 'route_error';

    if (snapshot.isLoading || (snapshot.graphqlErrorCount || 0) > 0) {
        return 'transient_error';
    }

    // 네이버 검색 페이지와 GraphQL 서버가 모두 정상 응답했는데 운임만 없다면
    // 서비스 전체 장애가 아니라 해당 노선의 정상적인 빈 결과다. 과거에는 이를
    // 일시 오류로 묶어 3건 뒤 전체 크롤을 잘못 중단했다.
    if (
        snapshot.searchPageReached
        && status >= 200
        && status < 400
        && (snapshot.graphqlSuccessCount || 0) > 0
    ) return 'no_result';

    return 'transient_error';
}

export type NaverAvailability = 'available' | 'blocked' | 'unavailable' | 'unknown';

/** 가격 유무가 아니라 검색 화면/API에 실제로 닿았는지로 서비스 상태를 판정한다. */
export function classifyNaverAvailability(snapshot: NaverPageSnapshot): NaverAvailability {
    const pageState = classifyNaverPageState(snapshot);
    if (pageState === 'blocked') return 'blocked';
    if (pageState === 'results' || pageState === 'no_result') return 'available';

    const status = Number(snapshot.httpStatus || 0);
    const graphqlProblemStatus = Number(snapshot.graphqlProblemStatus || 0);
    if (
        snapshot.searchPageReached
        && status >= 200
        && status < 400
        && (snapshot.graphqlSuccessCount || 0) > 0
    ) return 'available';
    if (status >= 500 || (graphqlProblemStatus >= 500 && (snapshot.graphqlSuccessCount || 0) === 0)) {
        return 'unavailable';
    }

    return 'unknown';
}

/** 대조 노선에서 API가 끝내 호출되지 않거나 오류 응답만 오면 실제 전송 장애다. */
export function classifyNaverProbeAvailability(
    snapshot: NaverPageSnapshot,
    navigationFailed = false,
): NaverAvailability {
    const availability = classifyNaverAvailability(snapshot);
    if (availability !== 'unknown') return availability;

    const status = Number(snapshot.httpStatus || 0);
    const noGraphqlReached = snapshot.searchPageReached
        && status >= 200
        && status < 400
        && (snapshot.graphqlResponseCount || 0) === 0;
    const onlyGraphqlErrors = (snapshot.graphqlErrorCount || 0) > 0
        && (snapshot.graphqlSuccessCount || 0) === 0;
    return navigationFailed || noGraphqlReached || onlyGraphqlErrors ? 'unavailable' : 'unknown';
}

export function combineNaverProbeResults(results: NaverAvailability[]): NaverAvailability {
    if (results.includes('available')) return 'available';
    if (results.includes('blocked')) return 'blocked';
    if (results.length >= 2 && results.every(result => result === 'unavailable')) return 'unavailable';
    return 'unknown';
}

/** 화면 추출기가 전면 변경된 회차를 정상 빈 결과로 확정하지 않기 위한 최종 안전망. */
export function shouldAbortNaverCrawlForZeroSuccess(
    attempted: number,
    success: number,
    minimumAttempts = 10,
): boolean {
    return attempted >= Math.max(1, minimumAttempts) && success === 0;
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
