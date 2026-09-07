import { runReport, eventNameFilter, type Ga4Config, type ReportRequest, type ReportResponse } from '../ga4';
import { parseFlightInterest, unavailableFlightInterest, attachFlightUsers, type FlightInterestData, type FlightInterestPeriod } from '../flight-interest';

export const FLIGHT_INTEREST_RANGES = {
    today: [{ startDate: 'today', endDate: 'today' }],
    recent7: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
    current: [{ startDate: '30daysAgo', endDate: 'yesterday' }],
} as const;

async function withUsers(result: FlightInterestPeriod, config: Ga4Config, range: ReportRequest['dateRanges'], query: typeof runReport) {
    if (!result.available || !result.rows.length) return result;
    const combined: ReportResponse = { rows: [] };
    try {
        for (let page = 0; page < 20; page++) {
            // No price, route, date or agency dimensions: GA deduplicates over the entire period.
            const report = await query(config, {
                dateRanges: range,
                dimensions: [{ name: 'eventName' }, { name: 'customEvent:flight_id' }],
                metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
                dimensionFilter: { orGroup: { expressions: ['detail_open', 'booking_click'].map(eventNameFilter) } },
                orderBys: ['eventName', 'customEvent:flight_id'].map(dimensionName => ({ dimension: { dimensionName } })),
                limit: 10000, offset: combined.rows!.length,
            });
            if (report.metadata?.dataLossFromOtherRow || report.metadata?.subjectToThresholding || report.metadata?.samplingMetadatas?.length) break;
            combined.rows!.push(...report.rows || []);
            combined.rowCount = report.rowCount;
            if (combined.rows!.length >= (report.rowCount ?? combined.rows!.length)) return attachFlightUsers(result, combined);
            if (!report.rows?.length) break;
        }
    } catch { /* Keep verified event counts when the optional user report fails. */ }
    return attachFlightUsers(result);
}

export async function loadFlightInterest(config: Ga4Config, query: typeof runReport = runReport): Promise<FlightInterestData> {
    const entries = await Promise.all(Object.entries(FLIGHT_INTEREST_RANGES).map(async ([period, range]) => {
        try {
            const request: ReportRequest = {
                dateRanges: [...range],
                dimensions: ['eventName', 'customEvent:flight_id', 'customEvent:route', 'customEvent:travel_agency', 'customEvent:departure_date', 'customEvent:return_date', 'customEvent:airline', 'customEvent:price'].map(name => ({ name })),
                metrics: [{ name: 'eventCount' }],
                dimensionFilter: { orGroup: { expressions: ['detail_open', 'booking_click'].map(eventNameFilter) } },
                // Deterministic pagination; rank after combining every action for each flight.
                orderBys: ['eventName', 'customEvent:flight_id', 'customEvent:route', 'customEvent:travel_agency', 'customEvent:departure_date', 'customEvent:return_date', 'customEvent:airline', 'customEvent:price'].map(dimensionName => ({ dimension: { dimensionName } })),
                limit: 10000,
            };
            const combined: ReportResponse = { rows: [] };
            for (let page = 0; page < 20; page++) {
                const report = await query(config, { ...request, offset: combined.rows!.length });
                if (report.metadata?.dataLossFromOtherRow || report.metadata?.subjectToThresholding || report.metadata?.samplingMetadatas?.length) return [period, parseFlightInterest(report)];
                combined.rows!.push(...report.rows || []);
                combined.rowCount = report.rowCount;
                if (combined.rows!.length >= (report.rowCount ?? combined.rows!.length)) return [period, await withUsers(parseFlightInterest(combined), config, [...range], query)];
                if (!report.rows?.length) break;
            }
            return [period, unavailableFlightInterest('전체 기록을 불러오지 못했습니다. 일부 데이터로 순위를 추정하지 않습니다.')];
        } catch {
            return [period, unavailableFlightInterest('항공권별 기록을 불러오지 못했습니다. GA4 항공권 ID 측정기준 설정과 조회 상태를 확인해 주세요.')];
        }
    }));
    return Object.fromEntries(entries) as FlightInterestData;
}
