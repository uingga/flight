import { dim, num, eventNameFilter, type ReportRequest, type ReportResponse } from './ga4';

export interface RetentionWindow {
    days: 7 | 30;
    cohortStart: string;
    cohortEnd: string;
    users: number;
    returnedUsers: number;
    rate: number | null;
}
export interface RetentionResult {
    asOf: string;
    timeZone: string;
    windows: RetentionWindow[];
}
export const shiftDay = (day: string, offset: number) => {
    const date = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error('Invalid cohort date');
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
};
const compact = (day: string) => day.replace(/-/g, '');

export function retentionPlan(today: string) {
    // Separate latest 30 fully observed acquisition dates for each horizon.
    const windows = ([7, 30] as const).map(days => {
        const cohortEnd = shiftDay(today, -days - 1);
        const cohortStart = shiftDay(cohortEnd, -29);
        return { days, cohortStart, cohortEnd, dates: Array.from({ length: 30 }, (_, i) => shiftDay(cohortStart, i)) };
    });
    const dates = Array.from(new Set(windows.flatMap(window => window.dates))).sort();
    const requests: ReportRequest[] = [{
        dateRanges: [{ startDate: dates[0], endDate: dates[dates.length - 1] }],
        dimensions: [{ name: 'firstSessionDate' }],
        metrics: [{ name: 'totalUsers' }],
        dimensionFilter: { andGroup: { expressions: [
            eventNameFilter('session_start'),
            { filter: { fieldName: 'firstSessionDate', inListFilter: { values: dates.map(compact) } } },
        ] } },
        limit: 100,
    }];
    for (const window of windows) for (const day of window.dates) requests.push({
        dateRanges: [{ startDate: shiftDay(day, 1), endDate: shiftDay(day, window.days) }],
        // No event-date dimension: GA4 deduplicates users over the ENTIRE window.
        // Summing daily active users would count repeat returners more than once.
        metrics: [{ name: 'totalUsers' }],
        dimensionFilter: { andGroup: { expressions: [
            eventNameFilter('session_start'),
            { filter: { fieldName: 'firstSessionDate', stringFilter: { value: compact(day), matchType: 'EXACT' } } },
        ] } },
    });
    return { windows, requests, asOf: shiftDay(today, -1) };
}

export function parseRetention(plan: ReturnType<typeof retentionPlan>, reports: ReportResponse[], timeZone: string): RetentionResult {
    if (reports.length !== plan.requests.length) throw new Error('Incomplete retention reports');
    for (const report of reports) {
        if (report.metadata?.subjectToThresholding || report.metadata?.dataLossFromOtherRow || report.metadata?.samplingMetadatas?.length) {
            throw new Error('Retention data is thresholded or sampled');
        }
        if (report.metadata?.timeZone && report.metadata.timeZone !== timeZone) throw new Error('Retention time zone mismatch');
    }
    const bases = new Map((reports[0].rows || []).map(row => [dim(row), num(row)]));
    let index = 1;
    const windows = plan.windows.map(window => {
        let users = 0, returnedUsers = 0;
        for (const day of window.dates) {
            const base = bases.get(compact(day)) || 0;
            const returned = num(reports[index++].rows?.[0]);
            if (returned > base || base < 0 || returned < 0) throw new Error('Inconsistent retention counts');
            users += base;
            returnedUsers += returned;
        }
        return { days: window.days, cohortStart: window.cohortStart, cohortEnd: window.cohortEnd,
            users, returnedUsers, rate: users ? Number((returnedUsers / users * 100).toFixed(1)) : null };
    });
    return { asOf: plan.asOf, timeZone, windows };
}

// Instance-local cache + single flight, separate from the 10-minute dashboard cache.
// No identifiers or credentials are stored in results. Failures are not cached.
const cache = new Map<string, { expires: number; promise: Promise<RetentionResult> }>();
export async function loadRetention(key: string, today: string, timeZone: string,
    batch: (requests: ReportRequest[]) => Promise<ReportResponse[]>): Promise<RetentionResult> {
    const cacheKey = `${key}|${today}|${timeZone}`;
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.promise;
    const promise = (async () => {
        const plan = retentionPlan(today);
        const reports: ReportResponse[] = new Array(plan.requests.length);
        let cursor = 0;
        let failure: unknown;
        await Promise.all([0, 1].map(async () => {
            while (!failure && cursor < plan.requests.length) {
                const start = cursor;
                cursor += 5;
                const requests = plan.requests.slice(start, start + 5);
                try {
                    const result = await batch(requests);
                    if (result.length !== requests.length) throw new Error('Incomplete retention batch');
                    result.forEach((report, i) => { reports[start + i] = report; });
                } catch (error) { failure = error || new Error('Retention batch failed'); }
            }
        }));
        if (failure) throw failure;
        return parseRetention(plan, reports, timeZone);
    })();
    cache.forEach((entry, id) => { if (entry.expires <= Date.now()) cache.delete(id); });
    cache.set(cacheKey, { expires: Date.now() + 6 * 60 * 60 * 1000, promise });
    try { return await promise; } catch (error) { cache.delete(cacheKey); throw error; }
}
