import { runReport, type Ga4Config, type ReportResponse } from '../ga4';
import { completeAcquisitionReport } from '../acquisition';
import { FUNNEL_EVENTS, shareFunnelContext } from '../share-funnel';
import { SHARE_GROUPS } from '../share-groups';
export type ShareDiscoveryReport = { available: boolean; hasData: boolean; rows: Array<{
    key: string; code: string; source: string; content: string; title: string;
    stages: Array<{ event: string; users: number; count: number }>;
}> };
export function parseShareDiscovery(report: ReportResponse): ShareDiscoveryReport {
    const unavailable: ShareDiscoveryReport = { available: false, hasData: false, rows: [] };
    if (!completeAcquisitionReport(report)) return unavailable;
    const groups = new Map<string, ShareDiscoveryReport['rows'][number]>();
    const seen = new Set<string>();
    for (const row of report.rows || []) {
        const [event, location] = row.dimensionValues?.map(item => item.value || '') || [];
        const context = shareFunnelContext(location);
        const raw = row.metricValues?.map(value => value.value) || [];
        const [users, count] = raw.map(Number);
        if (!context || !FUNNEL_EVENTS.includes(event as typeof FUNNEL_EVENTS[number]) || raw.length !== 2
            || raw.some(value => !value) || !Number.isSafeInteger(users) || !Number.isSafeInteger(count) || users < 0 || count < users) return unavailable;
        const key = `${context.source}|${context.campaign}|${context.content}`;
        if (seen.has(`${key}|${event}`)) return unavailable; // Never sum duplicate users from URL variants.
        seen.add(`${key}|${event}`);
        const group = groups.get(key) || { key, code: context.code, source: context.source, content: context.content,
            title: SHARE_GROUPS[context.code].title || `${SHARE_GROUPS[context.code].departure} → ${SHARE_GROUPS[context.code].arrival}`,
            stages: FUNNEL_EVENTS.map(event => ({ event, users: 0, count: 0 })) };
        group.stages[FUNNEL_EVENTS.indexOf(event as typeof FUNNEL_EVENTS[number])] = { event, users, count };
        groups.set(key, group);
    }
    return { available: true, hasData: groups.size > 0, rows: Array.from(groups.values()) };
}
export async function loadShareDiscovery(config: Ga4Config, days: number, query = runReport): Promise<ShareDiscoveryReport> {
    try {
        return parseShareDiscovery(await query(config, {
            dateRanges: [{ startDate: `${Math.max(days - 1, 0)}daysAgo`, endDate: 'today' }],
            dimensions: [{ name: 'eventName' }, { name: 'pageLocation' }],
            metrics: [{ name: 'totalUsers' }, { name: 'eventCount' }],
            dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: [...FUNNEL_EVENTS] } } },
            limit: 1000,
        }));
    } catch { return { available: false, hasData: false, rows: [] }; }
}
