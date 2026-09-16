import type { FlightInterestPeriod } from './flight-interest';

export function todayFlightRows(report?: FlightInterestPeriod) {
    if (!report?.available) return [];
    return [...report.rows].filter(row => row.bookingClicks > 0 || row.detailOpens > 0)
        .sort((a,b) => b.bookingClicks - a.bookingClicks || b.detailOpens - a.detailOpens || a.flightId.localeCompare(b.flightId)).slice(0,5);
}
export function todayReportNotes(sessions: number, hourly?: Array<{sessions:number}>) {
    if (!hourly) return ['시간대별 보고서를 확인하지 못했습니다.'];
    const total = hourly.reduce((sum,row) => sum + row.sessions,0);
    return total === sessions ? [] : [`전체 방문 보고서 ${sessions}회 · 시간대별 보고서 ${total}회로 현재 합계가 다릅니다. 별도 보고서의 값이며 원인은 아직 확정하지 않았습니다. 합계를 임의로 맞추지 않습니다.`];
}
export function todayActionCount(events: number, users?: number | null) {
    return `${events.toLocaleString('ko-KR')}회 · ${users == null || (events > 0 && users === 0) ? '인원 미확인' : `${users.toLocaleString('ko-KR')}명`}`;
}
