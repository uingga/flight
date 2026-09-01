import {
    resolveCityCode,
    resolveInterparkOriginCityCode,
} from './scrapers/interpark';

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
    pricesByOrigin?: Record<string, Record<string, Record<string, InterparkMonthBenchmark>>>;
}

export interface InterparkBenchmarkEvaluation {
    applicable: boolean;
    keep: boolean;
    discountRate: number;
    average?: number;
    lowest?: number;
    originCity?: string;
    cityCode?: string;
    yearMonth?: string;
}

/**
 * 인터파크 월별 API가 지원하고 실제 수집 대상으로 삼는 국내 출발 권역인지 확인한다.
 * 비교 데이터가 아직 없는 신규 권역은 적용 가능하되 중립 처리한다.
 */
export function isInterparkBenchmarkApplicable(
    flight: Pick<InterparkComparableFlight, 'departure'>,
): boolean {
    return Boolean(resolveInterparkOriginCityCode(
        String(flight.departure?.city || ''),
        String(flight.departure?.airport || ''),
    ));
}

export function getInterparkRouteMonths(
    flight: Pick<InterparkComparableFlight, 'departure' | 'arrival'>,
    benchmark: InterparkBenchmarkLike,
): Record<string, InterparkMonthBenchmark> | undefined {
    const originCity = resolveInterparkOriginCityCode(
        String(flight.departure?.city || ''),
        String(flight.departure?.airport || ''),
    );
    const cityCode = resolveCityCode(
        String(flight.arrival?.city || ''),
        String(flight.arrival?.airport || ''),
    );
    if (!originCity || !cityCode) return undefined;
    return benchmark.pricesByOrigin?.[originCity]?.[cityCode]
        || (originCity === 'SEL' ? benchmark.prices?.[cityCode] : undefined);
}

export function interparkClientPriceKey(
    flight: Pick<InterparkComparableFlight, 'departure' | 'arrival'>,
    normalizedArrivalCity?: string,
): string | null {
    const originCity = resolveInterparkOriginCityCode(
        String(flight.departure?.city || ''),
        String(flight.departure?.airport || ''),
    );
    const arrivalCity = (normalizedArrivalCity
        || String(flight.arrival?.city || '').replace(/\([^)]+\)/g, '').trim());
    if (!originCity || !arrivalCity) return null;
    return originCity === 'SEL' ? arrivalCity : `${originCity}|${arrivalCity}`;
}

export function getInterparkClientMonths<T>(
    flight: Pick<InterparkComparableFlight, 'departure' | 'arrival'>,
    prices: Record<string, T>,
    normalizedArrivalCity?: string,
): T | undefined {
    const key = interparkClientPriceKey(flight, normalizedArrivalCity);
    if (!key) return undefined;
    return prices[key];
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
    const originCity = resolveInterparkOriginCityCode(
        String(flight.departure?.city || ''),
        String(flight.departure?.airport || ''),
    );
    const month = yearMonth ? getInterparkRouteMonths(flight, benchmark)?.[yearMonth] : undefined;
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
            ...(originCity ? { originCity } : {}),
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
        ...(originCity ? { originCity } : {}),
    };
}

/** 지원하지 않거나 해당 출발지 기준가가 없는 과거 할인율을 다음 저장 때 제거한다. */
export function clearUnsupportedInterparkDiscount(
    flight: InterparkComparableFlight,
    benchmark?: InterparkBenchmarkLike | null,
): void {
    if (!isInterparkBenchmarkApplicable(flight)
        || (benchmark && !getInterparkRouteMonths(flight, benchmark))) {
        flight.discountRate = 0;
    }
}
