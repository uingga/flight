import type { Flight } from '../types/flight';
import { getExactRouteAirports } from './naver-route';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KST_OFFSET = 9 * HOUR;
export const COMPARISON_MAX_AGE_HOURS = 24;

const kstDayNumber = (timestamp: number): number =>
    Math.floor((timestamp + KST_OFFSET) / DAY);

/** 땡처리닷컴은 결제 단계 발권수수료 2만 원을 포함한 실질 가격으로 평가한다. */
export function getEffectivePrice(flight: Pick<Flight, 'price' | 'source'>): number {
    return flight.price + (flight.source === 'ttang' ? 20_000 : 0);
}

/**
 * 네이버 비교가는 마지막 성공 후 정확히 24시간까지만 추천·표시·제거 판단에 사용한다.
 * 그보다 오래된 값은 원본 기록에 보존하되 화면 순위에 영향을 주지 않는다.
 */
export function getComparisonFreshness(checkedAt?: string, now = Date.now()) {
    if (!checkedAt) return { usable: false, ageHours: null, ageDays: null };
    const checkedTime = new Date(checkedAt).getTime();
    if (!Number.isFinite(checkedTime)) return { usable: false, ageHours: null, ageDays: null };

    const ageHours = Math.max(0, (now - checkedTime) / HOUR);
    const ageDays = Math.max(0, kstDayNumber(now) - kstDayNumber(checkedTime));
    return { usable: ageHours <= COMPARISON_MAX_AGE_HOURS, ageHours, ageDays };
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

/**
 * 같은 노선의 서로 다른 일정을 비교할 때 쓰는 가격 경쟁력 구간.
 *
 * 네이버보다 비싸더라도 차이가 2만 원 이내이거나 10% 이내면 사실상 비슷한 가격으로 본다.
 * 비교가 없으면 중간 구간, 두 기준을 모두 넘겨 확실히 비싸면 마지막 구간이다.
 */
export function getRoutePriceCompetitivenessTier(
    flight: Pick<Flight, 'price' | 'source' | 'departure' | 'arrival' | 'routeAirports' | 'naverLowest' | 'naverCheckedAt'>,
    now = Date.now(),
): 0 | 1 | 2 {
    if (!getExactRouteAirports(flight)) return 1;
    if (!flight.naverLowest || flight.naverLowest <= 0) return 1;
    if (!getComparisonFreshness(flight.naverCheckedAt, now).usable) return 1;

    const difference = getEffectivePrice(flight) - flight.naverLowest;
    const ratio = difference / flight.naverLowest;
    return difference <= 20_000 || ratio <= 0.1 ? 0 : 2;
}
