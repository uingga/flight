/** 동일 일정·유효기간 검증을 통과한 비교가에만 적용한다. */
export function isNaverPriceOverLimit(
    effectivePrice: number,
    naverPrice: number,
    source?: string,
): boolean {
    if (!Number.isFinite(effectivePrice) || !Number.isFinite(naverPrice) || naverPrice <= 0) return false;
    const difference = effectivePrice - naverPrice;

    if (source === 'myrealtrip' || source === 'tripcom') {
        // 마이리얼트립 / 트립닷컴: 네이버보다 1만원 이상 비싸거나 3% 이상 비싸면 탈락
        return difference >= 10_000 || difference * 100 >= naverPrice * 3;
    }

    // 기본(기타 여행사): 10만원 이상 비싸거나 20% 이상 비싸면 탈락
    return difference >= 100_000 || difference * 5 >= naverPrice;
}

