import type { Flight } from '../types/flight';

const HOUR = 3_600_000;

/** 땡처리닷컴은 결제 단계 발권수수료 2만 원을 포함한 실질 가격으로 평가한다. */
export function getEffectivePrice(flight: Pick<Flight, 'price' | 'source'>): number {
    return flight.price + (flight.source === 'ttang' ? 20_000 : 0);
}

/** 외부 비교가는 48시간 이내에 확인한 값만 필터·추천 보정에 사용한다. */
export function getComparisonFreshness(checkedAt?: string, now = Date.now()) {
    if (!checkedAt) return { usable: false, ageHours: null };
    const checkedTime = new Date(checkedAt).getTime();
    if (!Number.isFinite(checkedTime)) return { usable: false, ageHours: null };

    const ageHours = Math.max(0, (now - checkedTime) / HOUR);
    return { usable: ageHours <= 48, ageHours };
}

/** 추천순의 비교가 구간: 검증된 최저가 이하 → 비교 불가 → 검증된 최저가 초과. */
export function getComparisonPriceTier(
    flight: Pick<Flight, 'price' | 'source' | 'naverLowest' | 'naverCheckedAt'>,
    now = Date.now(),
): 0 | 1 | 2 {
    if (!flight.naverLowest || flight.naverLowest <= 0) return 1;
    if (!getComparisonFreshness(flight.naverCheckedAt, now).usable) return 1;
    return getEffectivePrice(flight) <= flight.naverLowest ? 0 : 2;
}
