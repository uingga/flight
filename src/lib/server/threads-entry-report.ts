import { completeAcquisitionReport, type ThreadsEntryBreakdown } from '../acquisition';
import { runReport, type Ga4Config, type ReportRequest } from '../ga4';

const content = (value: string, matchType = 'EXACT') => ({ filter: {
    fieldName: 'sessionManualAdContent', stringFilter: { value, matchType, caseSensitive: false },
} });
const profile = content('link_in_bio');
const post = content('share_', 'BEGINS_WITH');
export const threadsEntryFilters = [
    { key: 'profile', label: '프로필', filter: profile },
    { key: 'post', label: '게시글 링크', filter: post },
    { key: 'unknown', label: '세부 경로 미확인', filter: { notExpression: { orGroup: { expressions: [profile, post] } } } },
];

/** Exact GA totals for each bucket; never sum people across links or infer missing attribution. */
export async function loadThreadsEntries(config: Ga4Config, dateRanges: ReportRequest['dateRanges'], sourceFilter: unknown, query = runReport): Promise<ThreadsEntryBreakdown> {
    try {
        const rows: ThreadsEntryBreakdown['rows'] = [];
        for (const entry of threadsEntryFilters) {
            const report = await query(config, { dateRanges, metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
                dimensionFilter: { andGroup: { expressions: [sourceFilter, entry.filter] } }, limit: 1 });
            if (!completeAcquisitionReport(report) || (report.rows?.length || 0) > 1) throw Error('Incomplete Threads entry report');
            const values = report.rows?.[0]?.metricValues;
            if (report.rows?.length && !values) throw Error('Missing Threads metrics');
            const sessions = values ? Number(values[0]?.value) : 0;
            const users = values ? Number(values[1]?.value) : 0;
            if (![sessions, users].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('Invalid Threads totals');
            rows.push({ key: entry.key, label: entry.label, sessions, users });
        }
        return { available: true, rows };
    } catch { return { available: false, rows: [] }; }
}
