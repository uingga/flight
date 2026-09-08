import { runReport, eventNameFilter, type Ga4Config, type ReportRequest, type ReportResponse } from '../ga4';
import { parseFilterDemand } from '../filter-demand';

export async function loadFilterDemand(config: Ga4Config, days: number, query: typeof runReport = runReport) {
    async function read(event: string, dimensions: string[]): Promise<ReportResponse | undefined> {
        try {
            const request: ReportRequest = {
                dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
                dimensions: dimensions.map(name => ({ name })),
                metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
                dimensionFilter: eventNameFilter(event),
                orderBys: dimensions.map(dimensionName => ({ dimension: { dimensionName } })), limit: 1000,
            };
            const all: ReportResponse = { rows: [] };
            for (let page = 0; page < 10; page++) {
                const report = await query(config, { ...request, offset: all.rows!.length });
                if (report.metadata?.dataLossFromOtherRow || report.metadata?.subjectToThresholding || report.metadata?.samplingMetadatas?.length) return undefined;
                all.rows!.push(...report.rows || []); all.rowCount = report.rowCount;
                if (all.rows!.length >= (report.rowCount ?? all.rows!.length)) return all;
                if (!report.rows?.length) break;
            }
        } catch { /* Missing custom definitions must not hide other admin charts. */ }
        return undefined;
    }
    const [filters, cities] = await Promise.all([
        read('filter_change', ['customEvent:filter_type', 'customEvent:filter_value']),
        read('destination_search', ['customEvent:destination']),
    ]);
    return parseFilterDemand(filters, cities);
}
