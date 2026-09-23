import type { Flight } from '../types/flight';
import { getExactRouteAirports } from './naver-route';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KST_OFFSET = 9 * HOUR;
/** 알림 등 최신 가격이 필요한 판단의 상한. */
export const COMPARISON_MAX_AGE_HOURS = 24;
/** 추천순에서 동일 일정 비교가를 원래 신뢰도로 쓰는 상한. */
export const RECOMMENDATION_COMPARISON_FULL_AGE_HOURS = 48;
/** 다음 부분 재수집까지 추천 근거를 완화해 보존하는 최종 상한. */
export const RECOMMENDATION_COMPARISON_MAX_AGE_HOURS = 72;
/** 마이리얼트립·트립닷컴은 더 짧은 비교가 유효기간을 쓴다. */
export const SHORT_COMPARISON_FULL_AGE_HOURS = 12;
export const SHORT_COMPARISON_MAX_AGE_HOURS = 24;

const hasShortComparisonWindow = (source?: Flight['source']) =>
    source === 'myrealtrip' || source === 'tripcom';

const kstDayNumber = (timestamp: number): number =>
    Math.floor((timestamp + KST_OFFSET) / DAY);

/** 땡처리닷컴은 결제 단계 발권수수료 2만 원을 포함한 실질 가격으로 평가한다. */
export function getEffectivePrice(flight: Pick<Flight, 'price' | 'source'>): number {
    return flight.price + (flight.source === 'ttang' ? 20_000 : 0);
}

/**
 * 오래된 네이버 가격으로 알림 등을 만들지 않도록 하는 엄격한 24시간 기준.
 * 추천순의 완충 유효기간은 getRecommendationComparisonFreshness에서 별도로 판단한다.
 */
export function getComparisonFreshness(checkedAt?: string, now = Date.now()) {
    if (!checkedAt) return { usable: false, ageHours: null, ageDays: null };
    const checkedTime = new Date(checkedAt).getTime();
    if (!Number.isFinite(checkedTime)) return { usable: false, ageHours: null, ageDays: null };

    const ageHours = Math.max(0, (now - checkedTime) / HOUR);
    const ageDays = Math.max(0, kstDayNumber(now) - kstDayNumber(checkedTime));
    return { usable: ageHours <= COMPARISON_MAX_AGE_HOURS, ageHours, ageDays };
}

/**
 * 일반 여행사는 48시간까지 정상 근거, 48~72시간은 낮춘 근거를 사용한다.
 * 마이리얼트립·트립닷컴은 12시간까지 정상, 12~24시간은 낮춘 근거다.
 * 알림 발송의 24시간 기준은 별도로 유지한다.
 */
export function getRecommendationComparisonFreshness(
    checkedAt?: string,
    now = Date.now(),
    source?: Flight['source'],
) {
    const checkedTime = checkedAt ? new Date(checkedAt).getTime() : Number.NaN;
    if (!Number.isFinite(checkedTime)) {
        return {
            usable: false,
            fullStrength: false,
            reducedStrength: false,
            ageHours: null,
            ageDays: null,
        };
    }

    const ageHours = Math.max(0, (now - checkedTime) / HOUR);
    const ageDays = Math.max(0, kstDayNumber(now) - kstDayNumber(checkedTime));
    const maxAgeHours = hasShortComparisonWindow(source)
        ? SHORT_COMPARISON_MAX_AGE_HOURS
        : RECOMMENDATION_COMPARISON_MAX_AGE_HOURS;
    const fullAgeHours = hasShortComparisonWindow(source)
        ? SHORT_COMPARISON_FULL_AGE_HOURS
        : RECOMMENDATION_COMPARISON_FULL_AGE_HOURS;
    const usable = ageHours <= maxAgeHours;
    const fullStrength = usable && ageHours <= fullAgeHours;
    return {
        usable,
        fullStrength,
        reducedStrength: usable && !fullStrength,
        ageHours,
        ageDays,
    };
}

/** 비싼 표 제외에도 소스별 표시 유효시간을 적용한다. */
export function getPriceExclusionFreshness(checkedAt?: string, now = Date.now(), source?: Flight['source']) {
    return getRecommendationComparisonFreshness(checkedAt, now, source);
}

/** 추천순의 비교가 구간: 검증된 최저가 이하 → 비교 불가 → 검증된 최저가 초과. */
export function getComparisonPriceTier(
    flight: Pick<Flight, 'price' | 'source' | 'departure' | 'arrival' | 'routeAirports' | 'naverLowest' | 'naverCheckedAt'>,
    now = Date.now(),
): 0 | 1 | 2 {
    if (!getExactRouteAirports(flight)) return 1;
    if (!flight.naverLowest || flight.naverLowest <= 0) return 1;
    const freshness = getRecommendationComparisonFreshness(flight.naverCheckedAt, now, flight.source);
    if (!freshness.usable || freshness.reducedStrength) return 1;
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
    const freshness = getRecommendationComparisonFreshness(flight.naverCheckedAt, now, flight.source);
    if (!freshness.usable || freshness.reducedStrength) return 1;

    const difference = getEffectivePrice(flight) - flight.naverLowest;
    const ratio = difference / flight.naverLowest;
    return difference <= 20_000 || ratio <= 0.1 ? 0 : 2;
}
