import type { Flight } from '../types/flight';
import { getExactRouteAirports } from './naver-route';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KST_OFFSET = 9 * HOUR;

const kstDayNumber = (timestamp: number): number =>
    Math.floor((timestamp + KST_OFFSET) / DAY);

/** 땡처리닷컴은 결제 단계 발권수수료 2만 원을 포함한 실질 가격으로 평가한다. */
export function getEffectivePrice(flight: Pick<Flight, 'price' | 'source'>): number {
    return flight.price + (flight.source === 'ttang' ? 20_000 : 0);
}

/**
 * 외부 비교가는 KST 날짜 기준 3일 전까지 동일하게 유효하다.
 * 전체 노선 갱신이 2~3일에 걸리므로 정확한 48시간 경계나 중간 감점은 사용하지 않는다.
 */
export function getComparisonFreshness(checkedAt?: string, now = Date.now()) {
    if (!checkedAt) return { usable: false, ageHours: null, ageDays: null };
    const checkedTime = new Date(checkedAt).getTime();
    if (!Number.isFinite(checkedTime)) return { usable: false, ageHours: null, ageDays: null };

    const ageHours = Math.max(0, (now - checkedTime) / HOUR);
    const ageDays = Math.max(0, kstDayNumber(now) - kstDayNumber(checkedTime));
    return { usable: ageDays <= 3, ageHours, ageDays };
}

/** 추천순의 비교가 구간: 검증된 최저가 이하 → 비교 불가 → 검증된 최저가 초과. */
export function getComparisonPriceTier(
    flight: Pick<Flight, 'price' | 'source' | 'departure' | 'arrival' | 'routeAirports' | 'naverLowest' | 'naverCheckedAt'>,
    now = Date.now(),
): 0 | 1 | 2 {
    if (!getExactRouteAirports(flight)) return 1;
    if (!flight.naverLowest || flight.naverLowest <= 0) return 1;
    if (!getComparisonFreshness(flight.naverCheckedAt, now).usable) return 1;
    return getEffectivePrice(flight) <= flight.naverLowest ? 0 : 2;
}
