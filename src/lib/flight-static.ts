/**
 * 빌드 시점에 항공권 캐시를 읽어 도시 단위로 정리하는 서버 전용 헬퍼.
 *
 * AI 답변엔진 크롤러는 대부분 JS를 실행하지 않아 클라이언트 렌더링 대시보드를
 * 읽지 못한다. 도시별 정적 페이지(/flights/[city])와 메인 하단 요약이 이 모듈로
 * 서버 렌더링되어, 크롤 커밋(하루 7회)마다 재빌드되며 최신 가격을 노출한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Flight } from '@/types/flight';
import { normalizeAirline, normalizeCity } from '@/lib/utils/flight-helpers';
import { filterStaleMyrealtripFlights } from '@/lib/source-freshness';
import { deduplicateDisplayFlights } from '@/lib/flight-visibility';
import { getComparisonFreshness } from '@/lib/price-quality';

export interface CityDeals {
    /** 정규화된 도시명 (URL 슬러그로도 사용) */
    city: string;
    /** 가격 오름차순 정렬 (실결제가 기준) */
    flights: Flight[];
    minPrice: number;
    departures: string[];
    airlines: string[];
    /** YYYY-MM-DD */
    earliestDate: string;
    latestDate: string;
}

export interface FlightCacheMeta {
    /** 전체 크롤이 시작된 시각(ISO 8601) */
    timestamp: string;
    /** 캐시가 마지막으로 저장된 시각(ISO 8601) */
    lastUpdated: string;
    sourceUpdatedAt: Record<string, string>;
}

export function loadFlightCacheMeta(): FlightCacheMeta {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'all-flights-cache.json'), 'utf8'));
        if (Array.isArray(raw)) return { timestamp: '', lastUpdated: '', sourceUpdatedAt: {} };
        return {
            timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : '',
            lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : '',
            sourceUpdatedAt: raw.sourceUpdatedAt && typeof raw.sourceUpdatedAt === 'object'
                ? raw.sourceUpdatedAt
                : {},
        };
    } catch {
        return { timestamp: '', lastUpdated: '', sourceUpdatedAt: {} };
    }
}

/** 표시가가 아닌 실결제가 (땡처리닷컴은 발권수수료 2만원 별도) */
export function effectivePrice(flight: Flight): number {
    return flight.price + (flight.source === 'ttang' ? 20_000 : 0);
}

/**
 * 도시 페이지용 이름 — 먼저 사이트 공통 규칙으로 정규화한 뒤(오사카(KIX)→오사카(간사이),
 * 치토세→삿포로 등) 괄호를 벗긴다. 사람들이 묻는 단위는 공항이 아니라 도시이므로
 * 도쿄(나리타)·도쿄(하네다)는 "도쿄" 한 페이지로 묶인다.
 */
export function displayCity(raw: string): string {
    return normalizeCity((raw || '').trim()).replace(/\([^)]*\)/g, '').trim();
}

export function departureLabel(flight: Flight): string {
    if (flight.departure.airport === 'ICN') return '인천';
    if (flight.departure.airport === 'GMP') return '김포';
    return displayCity(flight.departure.city);
}

function parseDate(value?: string): string {
    return (value || '').replace(/\./g, '-').replace(/\([^)]*\)/g, '').trim().slice(0, 10);
}

export function loadActiveFlights(): Flight[] {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'all-flights-cache.json'), 'utf8'));
        const flights: Flight[] = Array.isArray(raw) ? raw : raw.flights || [];
        const sourceUpdatedAt = Array.isArray(raw) ? {} : raw.sourceUpdatedAt || {};
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());
        const visible = filterStaleMyrealtripFlights(flights, sourceUpdatedAt)
            .filter(flight => {
                if (flight.price <= 0 || parseDate(flight.departure?.date) < today) return false;
                if (parseDate(flight.departure?.date) === parseDate(flight.arrival?.date)) return false;
                if (!flight.naverLowest || flight.naverLowest <= 0
                    || !getComparisonFreshness(flight.naverCheckedAt).usable) return true;
                const difference = effectivePrice(flight) - flight.naverLowest;
                return difference < 100_000 || difference / flight.naverLowest < 0.2;
            });
        // 메인 API와 같은 중복 제거 규칙을 써 정적 도시 페이지의 장수·최저가가
        // 실제 목록보다 부풀어 보이지 않게 한다.
        return deduplicateDisplayFlights(visible);
    } catch {
        return [];
    }
}

export function groupByCity(flights: Flight[]): CityDeals[] {
    const groups = new Map<string, Flight[]>();
    for (const f of flights) {
        const city = displayCity(f.arrival?.city || '');
        if (!city) continue;
        if (!groups.has(city)) groups.set(city, []);
        groups.get(city)!.push(f);
    }
    const result: CityDeals[] = [];
    for (const [city, list] of Array.from(groups.entries())) {
        const sorted = [...list].sort((a, b) => effectivePrice(a) - effectivePrice(b));
        const dates = sorted.map(f => parseDate(f.departure?.date)).filter(Boolean).sort();
        result.push({
            city,
            flights: sorted,
            minPrice: effectivePrice(sorted[0]),
            departures: Array.from(new Set(sorted.map(departureLabel))),
            airlines: Array.from(new Set(sorted.map(f => normalizeAirline(f.airline || '')).filter(Boolean))),
            earliestDate: dates[0] || '',
            latestDate: dates[dates.length - 1] || '',
        });
    }
    return result.sort((a, b) => b.flights.length - a.flights.length);
}

export function formatKoreanDate(iso: string): string {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${Number(m[2])}월 ${Number(m[3])}일`;
}
