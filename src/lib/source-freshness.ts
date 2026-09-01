import type { Flight } from '@/types/flight';

const DEFAULT_MYREALTRIP_MAX_AGE_HOURS = 24;
const DEFAULT_GENERAL_SOURCE_MAX_AGE_HOURS = 48;

export interface SourceFreshness {
    source: Flight['source'];
    fresh: boolean;
    maxAgeHours: number;
    ageHours: number | null;
    updatedAt: string | null;
}

interface ManualCaptureStatus {
    modetour?: {
        capturedAt?: string;
    };
}

/**
 * 자동 수집 성공 시각은 운영 상태 판단용으로 그대로 두되, 사용자가 직접 확인한
 * 모두투어 캡처가 더 최근이면 가격 노출 시한에는 그 확인 시각을 사용한다.
 */
export function getEffectiveSourceUpdatedAt(
    sourceUpdatedAt: Record<string, string> | undefined,
    manualCaptureStatus: ManualCaptureStatus | undefined,
): Record<string, string> {
    const effective = { ...(sourceUpdatedAt || {}) };
    const capturedAt = manualCaptureStatus?.modetour?.capturedAt;
    const capturedMs = Date.parse(capturedAt || '');
    const automaticMs = Date.parse(effective.modetour || '');

    if (Number.isFinite(capturedMs) && (!Number.isFinite(automaticMs) || capturedMs > automaticMs)) {
        effective.modetour = capturedAt!;
    }
    return effective;
}

function configuredMaxAgeHours(source: Flight['source']): number {
    const fallback = source === 'myrealtrip'
        ? DEFAULT_MYREALTRIP_MAX_AGE_HOURS
        : DEFAULT_GENERAL_SOURCE_MAX_AGE_HOURS;
    const envName = source === 'myrealtrip'
        ? 'MYREALTRIP_MAX_AGE_HOURS'
        : 'GENERAL_SOURCE_MAX_AGE_HOURS';
    const configured = Number(process.env[envName] || fallback);
    return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

export function getSourceFreshness(
    source: Flight['source'],
    sourceUpdatedAt: Record<string, string> | undefined,
    nowMs = Date.now(),
): SourceFreshness {
    const maxAgeHours = configuredMaxAgeHours(source);
    const updatedAt = sourceUpdatedAt?.[source] || null;
    const updatedMs = Date.parse(updatedAt || '');
    const ageMs = nowMs - updatedMs;
    const fresh = Number.isFinite(updatedMs)
        && ageMs >= 0
        && ageMs <= maxAgeHours * 60 * 60 * 1000;

    return {
        source,
        fresh,
        maxAgeHours,
        ageHours: Number.isFinite(ageMs) ? ageMs / (60 * 60 * 1000) : null,
        updatedAt,
    };
}

export function getMyrealtripFreshness(
    sourceUpdatedAt: Record<string, string> | undefined,
    nowMs = Date.now(),
) {
    return getSourceFreshness('myrealtrip', sourceUpdatedAt, nowMs);
}

export function getStaleSources(
    sourceUpdatedAt: Record<string, string> | undefined,
    nowMs = Date.now(),
): SourceFreshness[] {
    const sources: Flight['source'][] = [
        'ybtour',
        'hanatour',
        'modetour',
        'onlinetour',
        'ttang',
        'myrealtrip',
    ];
    return sources
        .map(source => getSourceFreshness(source, sourceUpdatedAt, nowMs))
        .filter(result => !result.fresh);
}

/**
 * 크롤 실패 때 이전 데이터를 보존하더라도, 확인 시각이 한도를 넘긴 여행사 표는
 * 운영 화면에서 자동으로 감춘다. 차단을 우회하지 않고도 오래된 가격의 오인을 막는다.
 */
export function filterStaleSourceFlights<T extends Pick<Flight, 'source'>>(
    flights: T[],
    sourceUpdatedAt: Record<string, string> | undefined,
    nowMs = Date.now(),
): T[] {
    const staleSources = new Set(getStaleSources(sourceUpdatedAt, nowMs).map(result => result.source));
    if (staleSources.size === 0) return flights;
    return flights.filter(flight => !staleSources.has(flight.source));
}

/** 기존 호출부 호환용. 새 화면은 filterStaleSourceFlights를 사용한다. */
export function filterStaleMyrealtripFlights<T extends Pick<Flight, 'source'>>(
    flights: T[],
    sourceUpdatedAt: Record<string, string> | undefined,
    nowMs = Date.now(),
): T[] {
    if (getMyrealtripFreshness(sourceUpdatedAt, nowMs).fresh) return flights;
    return flights.filter(flight => flight.source !== 'myrealtrip');
}
