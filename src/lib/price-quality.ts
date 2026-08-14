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
