import { resolveCityCode } from './scrapers/interpark';

export interface InterparkComparableFlight {
    price?: number;
    discountRate?: number;
    departure?: {
        airport?: string;
        city?: string;
        date?: string;
    };
    arrival?: {
        airport?: string;
        city?: string;
    };
}

export interface InterparkMonthBenchmark {
    avg?: number;
    lowest?: number;
}

export interface InterparkBenchmarkLike {
    prices?: Record<string, Record<string, InterparkMonthBenchmark>>;
}

export interface InterparkBenchmarkEvaluation {
    applicable: boolean;
    keep: boolean;
    discountRate: number;
    average?: number;
    lowest?: number;
    cityCode?: string;
    yearMonth?: string;
}

/**
 * 인터파크 월별/인기 최저가 API는 출발지를 받지 않으며 공식 화면에서 서울(SEL) 기준으로 노출된다.
 * 따라서 인천·김포 출발만 이 가격과 비교할 수 있다. 공항 코드가 없거나 깨진 예전 데이터만 도시명으로 보완한다.
 */
export function isInterparkBenchmarkApplicable(
    flight: Pick<InterparkComparableFlight, 'departure'>,
): boolean {
    const airport = String(flight.departure?.airport || '').trim().toUpperCase();
    if (airport === 'ICN' || airport === 'GMP') return true;
    if (/^[A-Z]{3}$/.test(airport)) return false;

    const city = String(flight.departure?.city || '').replace(/\s+/g, '');
    return /서울|인천|김포/.test(city);
}

function departureYearMonth(flight: InterparkComparableFlight): string | null {
    const normalized = String(flight.departure?.date || '')
        .replace(/[^0-9\-.]/g, '')
        .replace(/\./g, '-')
        .replace(/-+$/, '');
    const match = normalized.match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}` : null;
}

export function evaluateInterparkBenchmark(
    flight: InterparkComparableFlight,
    benchmark: InterparkBenchmarkLike,
): InterparkBenchmarkEvaluation {
    if (!isInterparkBenchmarkApplicable(flight)) {
        return { applicable: false, keep: true, discountRate: 0 };
    }

    const cityCode = resolveCityCode(
        String(flight.arrival?.city || ''),
        String(flight.arrival?.airport || ''),
    );
    const yearMonth = departureYearMonth(flight);
    const month = cityCode && yearMonth ? benchmark.prices?.[cityCode]?.[yearMonth] : undefined;
    const average = Number(month?.avg);
    const lowest = Number(month?.lowest);
    const price = Number(flight.price);

    if (!cityCode || !yearMonth || !Number.isFinite(average) || average <= 0 || !Number.isFinite(price) || price <= 0) {
        return {
            applicable: true,
            keep: true,
            discountRate: 0,
            ...(cityCode ? { cityCode } : {}),
            ...(yearMonth ? { yearMonth } : {}),
        };
    }

    return {
        applicable: true,
        keep: price <= average,
        discountRate: Number.isFinite(lowest) && lowest > 0
            ? Math.round((1 - price / lowest) * 100)
            : 0,
        average,
        ...(Number.isFinite(lowest) && lowest > 0 ? { lowest } : {}),
        cityCode,
        yearMonth,
    };
}

/** 이전 캐시에 잘못 저장된 지방 출발 인터파크 할인율도 다음 저장 때 제거한다. */
export function clearUnsupportedInterparkDiscount(flight: InterparkComparableFlight): void {
    if (!isInterparkBenchmarkApplicable(flight)) flight.discountRate = 0;
}
