import type { Flight } from '@/types/flight';
import { getTtangBookingUrl } from '@/lib/utils/ttang-url';

export type BookingLinkProbeOutcome = 'passed' | 'failed' | 'unavailable';

export interface TtangBookingEvidenceResult {
    outcome: BookingLinkProbeOutcome;
    reason: string | null;
    bookingUrl: string;
    evidenceAt: string | null;
    masterId: string | null;
}

export const DEFAULT_TTANG_EVIDENCE_MAX_AGE_HOURS = 8;

const IATA_AIRPORT_PATTERN = /^[A-Z]{3}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TTANG_BOOKING_PATH = '/ttangair/search/promotion/ttangIndex.do';
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

function isValidIsoDate(value: string): boolean {
    if (!ISO_DATE_PATTERN.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseTtangIdentity(flight: Flight): { masterId: string; departureDate: string } | null {
    if (!flight.id.startsWith('ttang-')) return null;
    const match = flight.id.slice('ttang-'.length).match(/^(.+)-(\d{4}-\d{2}-\d{2})$/);
    if (!match?.[1] || !isValidIsoDate(match[2])) return null;
    return { masterId: match[1], departureDate: match[2] };
}

/**
 * 땡처리닷컴에는 요청을 보내지 않고, 사용자가 열게 될 URL의 구조만 로컬에서 확인한다.
 * 텍스트 프래그먼트는 서버에 전송되지 않으므로 검증 대상에서 제외한다.
 */
export function validateTtangBookingUrl(flight: Flight, bookingUrl: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(bookingUrl);
    } catch {
        return '땡처리 예약 주소 형식이 올바르지 않음';
    }

    if (parsed.protocol !== 'https:' || parsed.hostname !== 'mm.ttang.com') {
        return '땡처리 예약 주소의 프로토콜 또는 호스트가 다름';
    }
    if (parsed.pathname !== TTANG_BOOKING_PATH) {
        return '땡처리 특가 목록 경로가 다름';
    }

    const expectedParams: Record<string, string> = {
        trip: 'RT',
        depdate0: flight.departure.date.replace(/\D/g, '').slice(0, 8),
        adt: '1',
        chd: '0',
        inf: '0',
        page: '1',
        scale: '200',
    };
    for (const [key, expected] of Object.entries(expectedParams)) {
        if (parsed.searchParams.get(key) !== expected) {
            return `땡처리 예약 주소의 ${key} 값이 항공권 정보와 다름`;
        }
    }
    return null;
}

/**
 * 프로모션 API 수집에 성공한 캐시 행을 예약 가능성의 증거로 사용한다.
 * 이 함수는 네트워크 API와 브라우저를 전혀 사용하지 않는다.
 */
export function verifyTtangBookingEvidence(
    flight: Flight,
    sourceUpdatedAt: string | null | undefined,
    options: { now?: Date; maxAgeHours?: number } = {},
): TtangBookingEvidenceResult {
    const bookingUrl = getTtangBookingUrl(flight);
    const identity = parseTtangIdentity(flight);
    const evidenceAt = typeof sourceUpdatedAt === 'string' ? sourceUpdatedAt : null;
    const failed = (reason: string): TtangBookingEvidenceResult => ({
        outcome: 'failed', reason, bookingUrl, evidenceAt, masterId: identity?.masterId || null,
    });

    const urlProblem = validateTtangBookingUrl(flight, bookingUrl);
    if (urlProblem) return failed(urlProblem);
    if (flight.source !== 'ttang' || !identity) {
        return failed('땡처리 크롤 증거의 masterId 또는 항공권 ID가 올바르지 않음');
    }
    if (identity.departureDate !== flight.departure.date) {
        return failed('땡처리 크롤 증거의 ID 날짜와 출발일이 다름');
    }
    if (!isValidIsoDate(flight.departure.date) || !isValidIsoDate(flight.arrival.date)) {
        return failed('땡처리 크롤 증거의 왕복 날짜가 올바르지 않음');
    }
    if (flight.arrival.date < flight.departure.date) {
        return failed('땡처리 크롤 증거의 귀국일이 출발일보다 빠름');
    }
    if (
        !flight.departure.city?.trim()
        || !flight.arrival.city?.trim()
        || !IATA_AIRPORT_PATTERN.test(flight.departure.airport)
        || !IATA_AIRPORT_PATTERN.test(flight.arrival.airport)
    ) {
        return failed('땡처리 크롤 증거의 노선 정보가 올바르지 않음');
    }
    if (!flight.airline?.trim() || !Number.isFinite(flight.price) || flight.price <= 0 || flight.currency !== 'KRW') {
        return failed('땡처리 크롤 증거의 항공사 또는 가격 정보가 올바르지 않음');
    }

    const evidenceTime = evidenceAt ? new Date(evidenceAt).getTime() : Number.NaN;
    if (!Number.isFinite(evidenceTime)) {
        return {
            outcome: 'unavailable',
            reason: '땡처리의 마지막 정상 크롤 시각이 없어 검증을 보류함',
            bookingUrl,
            evidenceAt,
            masterId: identity.masterId,
        };
    }

    const now = options.now || new Date();
    const configuredMaxAge = options.maxAgeHours ?? DEFAULT_TTANG_EVIDENCE_MAX_AGE_HOURS;
    const maxAgeHours = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
        ? configuredMaxAge
        : DEFAULT_TTANG_EVIDENCE_MAX_AGE_HOURS;
    const ageMs = now.getTime() - evidenceTime;
    if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) {
        return {
            outcome: 'unavailable',
            reason: '땡처리의 마지막 정상 크롤 시각이 현재보다 미래라 검증을 보류함',
            bookingUrl,
            evidenceAt,
            masterId: identity.masterId,
        };
    }
    if (ageMs > maxAgeHours * 60 * 60 * 1000) {
        const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
        return {
            outcome: 'unavailable',
            reason: `땡처리의 마지막 정상 크롤이 ${ageHours}시간 전이라 검증을 보류함`,
            bookingUrl,
            evidenceAt,
            masterId: identity.masterId,
        };
    }

    return {
        outcome: 'passed',
        reason: null,
        bookingUrl,
        evidenceAt,
        masterId: identity.masterId,
    };
}
