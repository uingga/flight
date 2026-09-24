type PreviousLotteFlight = { departure?: { date?: string } };

export type LotteEmptyDecision = 'accept' | 'preserve' | 'standard';

/** Retire only the old count-based false alarm; explicit access restrictions remain active. */
export function isSmallLotteZeroCircuit(
    circuit: { reason?: string; status?: number; detail?: string } | undefined,
    minBaseline: number,
): boolean {
    if (circuit?.reason !== 'blocked' || circuit.status !== undefined) return false;
    const count = /^soft block 의심: 응답 수량 (\d+)건에서 0건으로 감소$/.exec(circuit.detail || '');
    return !!count && Number(count[1]) > 0 && Number(count[1]) < minBaseline;
}

/** A tiny, fully read Lotte listing can naturally reach zero as its last flight departs. */
export function decideLotteEmptyResponse(
    previousFlights: readonly PreviousLotteFlight[],
    previousRawCount: number | undefined,
    minBaseline: number,
    nowMs = Date.now(),
): LotteEmptyDecision {
    const baseline = Math.max(previousFlights.length, previousRawCount ?? 0);
    if (baseline >= minBaseline) return 'standard';
    if (!previousFlights.length || !Number.isFinite(nowMs)) return 'preserve';

    const todayKst = new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const allDeparted = previousFlights.every(flight => {
        const departureDate = flight.departure?.date;
        return typeof departureDate === 'string'
            && /^\d{4}-\d{2}-\d{2}$/.test(departureDate)
            && departureDate < todayKst;
    });
    return allDeparted ? 'accept' : 'preserve';
}
