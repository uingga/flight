import type { ReportResponse } from './ga4';
import { parseFlightInterest, attachFlightUsers, type FlightInterestRow } from './flight-interest';

export interface FlightSharePeriod {
    available: boolean; message?: string; usersMessage?: string;
    rows: Array<{ flightId: string; route: string | null; attempts: number; users: number | null; recorded?: FlightInterestRow['recorded'] }>;
    unidentified: number;
}
// Reuse the exact-ID, metadata and non-additive user validation for this single action.
// Only share events enter this adapter, so click metadata cannot fill missing share metadata.
const shareReport = (report: ReportResponse): ReportResponse => ({
    ...report,
    rows: (report.rows || []).filter(row => row.dimensionValues?.[0]?.value === 'share_flight').map(row => ({
        ...row, dimensionValues: [{ value: 'booking_click' }, ...(row.dimensionValues || []).slice(1)],
    })),
    rowCount: undefined,
});
export function parseFlightShares(report: ReportResponse, usersReport?: ReportResponse): FlightSharePeriod {
    const complete = (report.rowCount ?? 0) <= (report.rows?.length ?? 0);
    const mapped = shareReport(report);
    if (!complete) mapped.rowCount = mapped.rows!.length + 1;
    const usersComplete = usersReport && (usersReport.rowCount ?? 0) <= (usersReport.rows?.length ?? 0);
    const parsed = attachFlightUsers(parseFlightInterest(mapped), usersComplete ? shareReport(usersReport!) : undefined);
    return { available: parsed.available, message: parsed.message, usersMessage: parsed.usersMessage,
        rows: parsed.rows.map(row => ({ flightId: row.flightId, route: row.route, attempts: row.bookingClicks,
            users: row.bookingUsers ?? null, recorded: row.recorded })), unidentified: parsed.unidentified.bookingClicks };
}
