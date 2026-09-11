import {runReport, type Ga4Config} from '../ga4';
import {completeAcquisitionReport} from '../acquisition';
export async function loadReturningTrend(config: Ga4Config, dates: string[], query: typeof runReport = runReport) {
    const unavailable = {available: false, trend: [] as Array<{date: string; users: number}>};
    if (!dates.length) return unavailable;
    try {
        const report = await query(config, {
            dateRanges: [{startDate: dates[0], endDate: dates[dates.length - 1]}],
            dimensions: [{name: 'date'}], metrics: [{name: 'activeUsers'}],
            dimensionFilter: {filter: {fieldName: 'newVsReturning', stringFilter: {matchType: 'EXACT', value: 'returning'}}},
            limit: dates.length, keepEmptyRows: true,
        });
        if (!completeAcquisitionReport(report)) return unavailable;
        const values = new Map<string, number>();
        for (const row of report.rows || []) {
            const raw = row.dimensionValues?.[0]?.value || '';
            const date = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
            const metric = row.metricValues?.[0]?.value;
            const users = Number(metric);
            if (!dates.includes(date) || values.has(date) || !metric || !Number.isInteger(users) || users < 0) return unavailable;
            values.set(date, users);
        }
        return {available: true, trend: dates.map(date => ({date, users: values.get(date) ?? 0}))};
    } catch { return unavailable; }
}
