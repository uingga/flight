/** 동일 일정·유효기간 검증을 통과한 비교가에만 적용한다. */
export function isNaverPriceOverLimit(effectivePrice: number, naverPrice: number): boolean {
    if (!Number.isFinite(effectivePrice) || !Number.isFinite(naverPrice) || naverPrice <= 0) return false;
    // 원 단위 정수 가격의 20% 경계를 부동소수점 배율 반올림 없이 포함한다.
    const difference = effectivePrice - naverPrice;
    return difference >= 100_000 || difference * 5 >= naverPrice;
}
