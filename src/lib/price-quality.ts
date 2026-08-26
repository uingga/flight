import type { Flight } from '../types/flight';
import { getExactRouteAirports } from './naver-route';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KST_OFFSET = 9 * HOUR;
const MORNING_ROTATION_START = 6 * HOUR;
const EVENING_ROTATION_START = 20 * HOUR;

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

/** KST 오전 6시와 오후 8시에 바뀌는 추천순 슬롯. 같은 슬롯에서는 모두 같은 순서를 유지한다. */
export function getRecommendationRotationSlot(now = Date.now()): number {
    const kstTimestamp = now + KST_OFFSET;
    const kstDay = Math.floor(kstTimestamp / DAY);
    const timeOfDay = ((kstTimestamp % DAY) + DAY) % DAY;

    if (timeOfDay >= EVENING_ROTATION_START) return kstDay * 2 + 1;
    if (timeOfDay >= MORNING_ROTATION_START) return kstDay * 2;
    return kstDay * 2 - 1;
}

/** 네이버 최저가 이하 항공권을 하루 두 차례 안정적으로 섞기 위한 순위값. */
export function getRecommendationRotationRank(flightId: string, slot: number): number {
    const value = `${slot}:${flightId}`;
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0;
}
