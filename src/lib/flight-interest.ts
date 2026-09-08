import type { ReportResponse } from './ga4';

export type InterestPeriod = 'today' | 'recent7' | 'current';
export interface FlightInterestRow {
    flightId: string;
    route: string | null;
    detailOpens: number;
    bookingClicks: number;
    detailUsers?: number | null;
    bookingUsers?: number | null;
    recorded?: { agency: string | null; departureDate: string | null; returnDate: string | null; airline: string | null; minPrice: number | null; maxPrice: number | null };
}
export interface FlightInterestPeriod {
    shares?: import('./flight-shares').FlightSharePeriod;
    available: boolean;
    message?: string;
    usersMessage?: string;
    rows: FlightInterestRow[];
    unidentified: { detailOpens: number; bookingClicks: number };
}
export type FlightInterestData = Record<InterestPeriod, FlightInterestPeriod>;
export const isCompleteInterestReport = (report?: ReportResponse | null): boolean => Boolean(report
    && !report.metadata?.dataLossFromOtherRow && !report.metadata?.subjectToThresholding
    && !report.metadata?.samplingMetadatas?.length && (report.rowCount ?? 0) <= (report.rows?.length ?? 0));
const known = (value: string) => value.trim() && !['(not set)', '(other)', '(empty)'].includes(value.trim());
export const unavailableFlightInterest = (message: string): FlightInterestPeriod => ({
    available: false, message, rows: [], unidentified: { detailOpens: 0, bookingClicks: 0 },
});

/** Only explicit actions with an exact recorded ID belong to the flight ranking. */
export function parseFlightInterest(report: ReportResponse): FlightInterestPeriod {
    if (report.metadata?.dataLossFromOtherRow || report.metadata?.subjectToThresholding || report.metadata?.samplingMetadatas?.length) {
        return unavailableFlightInterest('GA4가 일부 기록을 제한하거나 표본 처리해 정확한 항공권별 순위를 표시할 수 없습니다.');
    }
    if ((report.rowCount ?? 0) > (report.rows?.length ?? 0)) {
        return unavailableFlightInterest('전체 기록을 불러오지 못했습니다. 일부 데이터로 순위를 추정하지 않습니다.');
    }
    const result: FlightInterestPeriod = { available: true, rows: [], unidentified: { detailOpens: 0, bookingClicks: 0 } };
    const grouped = new Map<string, FlightInterestRow>();
    const routes = new Map<string, Set<string>>();
    const descriptions = new Map<string, [Set<string>, Set<string>, Set<string>, Set<string>, Set<number>]>();
    for (const row of report.rows || []) {
        const [event, flightId = '', route = '', agency = '', departureDate = '', returnDate = '', airline = '', price = ''] = (row.dimensionValues || []).map(value => value.value);
        const count = Number(row.metricValues?.[0]?.value);
        if (!['detail_open', 'booking_click'].includes(event) || !Number.isSafeInteger(count) || count <= 0) continue;
        const metric = event === 'booking_click' ? 'bookingClicks' : 'detailOpens';
        if (!known(flightId)) { result.unidentified[metric] += count; continue; }
        const entry = grouped.get(flightId) || { flightId, route: null, detailOpens: 0, bookingClicks: 0 };
        entry[metric] += count;
        grouped.set(flightId, entry);
        const values: [Set<string>, Set<string>, Set<string>, Set<string>, Set<number>] = descriptions.get(flightId) || [new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(), new Set<number>()];
        [agency, departureDate, returnDate, airline].forEach((value, index) => { if (known(value)) (values[index] as Set<string>).add(value); });
        if (known(price) && Number.isFinite(Number(price)) && Number(price) > 0) values[4].add(Number(price));
        descriptions.set(flightId, values);
        if (known(route)) {
            const values = routes.get(flightId) || new Set<string>();
            values.add(route); routes.set(flightId, values);
        }
    }
    const single = (values: Set<string>) => values.size === 1 ? Array.from(values)[0] : null;
    result.rows = Array.from(grouped.values()).map(row => {
        const values = descriptions.get(row.flightId)!;
        const prices = Array.from(values[4]);
        return { ...row, route: routes.get(row.flightId)?.size === 1 ? Array.from(routes.get(row.flightId)!)[0] : null,
            ...(values.some(value => value.size) ? { recorded: { agency: single(values[0]), departureDate: single(values[1]), returnDate: single(values[2]), airline: single(values[3]), minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null } } : {}),
        };
    })
        .sort((a, b) => b.bookingClicks - a.bookingClicks || b.detailOpens - a.detailOpens || a.flightId.localeCompare(b.flightId));
    return result;
}

/** User counts are non-additive. Accept only one GA row per event and flight ID. */
export function attachFlightUsers(result: FlightInterestPeriod, report?: ReportResponse): FlightInterestPeriod {
    if (!result.available) return result;
    const users = new Map<string, { count: number; users: number } | null>();
    if (isCompleteInterestReport(report)) {
        for (const row of report?.rows || []) {
            const [event, id = ''] = (row.dimensionValues || []).map(value => value.value);
            if (!['detail_open', 'booking_click'].includes(event) || !known(id)) continue;
            const key = `${event}|${id}`;
            const count = Number(row.metricValues?.[0]?.value);
            const unique = Number(row.metricValues?.[1]?.value);
            const valid = Number.isSafeInteger(count) && Number.isSafeInteger(unique) && count > 0 && unique > 0 && unique <= count;
            users.set(key, !users.has(key) && valid ? { count, users: unique } : null);
        }
    }
    const getUsers = (event: string, id: string, count: number): number | null => {
        if (!isCompleteInterestReport(report)) return null;
        const value = users.get(`${event}|${id}`);
        if (count === 0 && !users.has(`${event}|${id}`)) return 0;
        // Today may change between queries. Do not combine inconsistent snapshots.
        return value && value.count === count ? value.users : null;
    };
    const rows = result.rows.map(row => ({ ...row,
        detailUsers: getUsers('detail_open', row.flightId, row.detailOpens),
        bookingUsers: getUsers('booking_click', row.flightId, row.bookingClicks),
    }));
    return { ...result, rows, usersMessage: rows.some(row => row.detailUsers === null || row.bookingUsers === null)
        ? '일부 인원수는 조회 실패·데이터 제한 또는 집계 시점 차이로 확인하지 못했습니다. 횟수로 인원수를 추정하지 않습니다.' : undefined };
}
