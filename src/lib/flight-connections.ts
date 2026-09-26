import type { Flight, FlightLegConnection } from '@/types/flight';

export function isConfirmedConnection(leg?: FlightLegConnection): boolean {
    return leg?.status === 'connecting'
        || (Number.isInteger(leg?.stopCount) && Number(leg?.stopCount) > 0);
}

/** Only explicit leg evidence qualifies; missing direct-flight evidence is not a connection. */
export function hasConfirmedConnection(flight: Flight): boolean {
    if (flight.source !== 'tripcom') return false;
    const legs = flight.tripcomDetail?.legs;
    return isConfirmedConnection(legs?.outbound) || isConfirmedConnection(legs?.inbound);
}

export function connectionLabel(leg?: FlightLegConnection): string | null {
    if (isConfirmedConnection(leg)) {
        return Number.isInteger(leg?.stopCount) && Number(leg?.stopCount) > 0
            ? `경유 ${leg!.stopCount}회` : '경유';
    }
    // Keep unknown/direct evidence internally; only confirmed connections get a label.
    return null;
}

export function flightConnectionSummary(flight: Flight): string | null {
    if (flight.source !== 'tripcom') return null;
    const legs = flight.tripcomDetail?.legs;
    const outbound = connectionLabel(legs?.outbound);
    const inbound = connectionLabel(legs?.inbound);
    if (!outbound && !inbound) return null;
    if (outbound === inbound) return `가는편·오는편 ${outbound}`;
    return [outbound && `가는편 ${outbound}`, inbound && `오는편 ${inbound}`].filter(Boolean).join(' · ');
}

export function connectionDuration(leg?: FlightLegConnection): string | null {
    const minutes = leg?.durationMinutes;
    if (!Number.isInteger(minutes) || !minutes || minutes < 0 || minutes > 7 * 24 * 60) return null;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return [hours ? `${hours}시간` : '', remainder ? `${remainder}분` : ''].filter(Boolean).join(' ');
}

export function tripcomLegSummary(flight: Flight, direction: 'outbound' | 'inbound'): string | null {
    const leg = flight.tripcomDetail?.legs?.[direction];
    const duration = connectionDuration(leg);
    return [connectionLabel(leg), duration && `총 ${duration}`].filter(Boolean).join(' · ') || null;
}
