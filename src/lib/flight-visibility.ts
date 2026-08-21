import type { Flight } from '../types/flight';
import { normalizeCity } from './utils/flight-helpers';
import { getEffectivePrice } from './price-quality';

const normalizeDate = (value?: string): string => {
    if (!value) return '';
    const match = value.match(/^(\d{4})[-\.](\d{2})[-\.](\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : value.trim();
};

const normalizeTime = (value?: string): string => {
    if (!value) return '';
    const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
    return match ? `${match[1].padStart(2, '0')}:${match[2]}` : value.trim();
};

/**
 * 사용자에게 같은 항공권으로 보여도 되는 정확한 일정 단위.
 * 출발일만 같아도 합치던 이전 기준은 귀국일이나 시간이 다른 정상 일정을 숨길 수 있었다.
 */
export function buildFlightDisplayKey(flight: Flight): string {
    return [
        normalizeCity(flight.departure?.city || ''),
        normalizeCity(flight.arrival?.city || ''),
        normalizeDate(flight.departure?.date),
        normalizeTime(flight.departure?.time),
        normalizeDate(flight.arrival?.date),
        normalizeTime(flight.arrival?.time),
        flight.airline,
    ].join('|');
}

/** 같은 정확한 일정은 여행사별로 반복 노출하지 않고 실질 가격이 가장 싼 한 건만 남긴다. */
export function deduplicateDisplayFlights<T extends Flight>(flights: T[]): T[] {
    const dedupMap = new Map<string, T>();

    for (const flight of flights) {
        const key = buildFlightDisplayKey(flight);
        const existing = dedupMap.get(key);
        if (!existing) {
            dedupMap.set(key, flight);
            continue;
        }

        const existingEffectivePrice = getEffectivePrice(existing);
        const newEffectivePrice = getEffectivePrice(flight);
        if (newEffectivePrice < existingEffectivePrice
            || (newEffectivePrice === existingEffectivePrice
                && existing.source === 'ttang'
                && flight.source !== 'ttang')) {
            dedupMap.set(key, flight);
        }
    }

    return Array.from(dedupMap.values());
}
