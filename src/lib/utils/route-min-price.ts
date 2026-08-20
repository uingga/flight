/**
 * crawl-all이 캐시에 남길 항공권만 골라낸다 — "같은 여행사·같은 노선(출발도시-도착도시)에서
 * 최저가인 것"만 살아남는 규칙으로, `scripts/crawl-all.ts`의 최저가 필터와 동일하다.
 *
 * 스크래퍼의 시각 보강(Phase 2)이 이 규칙을 미리 적용하기 위한 것이다. 보강은 노선당
 * 실시간 페이지를 한 번씩 여는 가장 비싼 단계인데, 땡처리는 원본 2,100건을 수집해
 * 캐시에는 221건만 남는다. 즉 그대로 두면 **버려질 표를 위해 열 배의 페이지를 여느라**
 * 크롤이 몇 시간씩 늘어진다(2026-08-20 로컬 크롤 2시간 초과).
 *
 * 규칙을 crawl-all과 어긋나게 바꾸면 살아남을 표에 시각이 비므로, 양쪽을 함께 고쳐야 한다.
 */
export function survivingRouteMinPrice<T extends {
    price?: number;
    departure?: { city?: string };
    arrival?: { city?: string };
}>(flights: T[]): Set<T> {
    const routeKey = (f: T) => `${f.departure?.city || ''}|${f.arrival?.city || ''}`;

    const minPrices = new Map<string, number>();
    for (const f of flights) {
        const price = f.price ?? 0;
        if (price <= 0) continue;
        const key = routeKey(f);
        const current = minPrices.get(key);
        if (current === undefined || price < current) minPrices.set(key, price);
    }

    // 최저가가 동률이면 crawl-all도 전부 남기므로 여기서도 전부 남긴다
    const survivors = new Set<T>();
    for (const f of flights) {
        const price = f.price ?? 0;
        if (price > 0 && price === minPrices.get(routeKey(f))) survivors.add(f);
    }
    return survivors;
}
