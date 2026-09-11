import { sign } from 'node:crypto';
import { ga4Config, type ReportRequest, type ReportResponse } from '../ga4';
import { TE31_POSTS } from '../te31-posts';
import { dayBefore, observedMetrics, type PromotionPost, type SourceResult } from '../promotion-daily';
import { boundedText, CollectionDeadline, CollectionError, safeReason } from './promotion-http';

export type DailyReport = (request: ReportRequest) => Promise<ReportResponse>;
export function validateDailyReport(report: ReportResponse): void {
    if (report.metadata?.timeZone !== 'Asia/Seoul') throw new CollectionError('ga4_timezone_mismatch');
    if (!Number.isInteger(report.rowCount) || report.rowCount !== (report.rows || []).length
        || report.metadata.dataLossFromOtherRow || report.metadata.subjectToThresholding || report.metadata.samplingMetadatas?.length) {
        throw new CollectionError('ga4_incomplete_report');
    }
}
const filter = (fieldName: string, value: string, matchType = 'EXACT', caseSensitive = false) => ({ filter: { fieldName, stringFilter: { value, matchType, caseSensitive } } });

// A bounded job-only client: no retries, fixed HTTPS destinations and no raw provider errors.
export async function createDailyReportClient(deadline = new CollectionDeadline()): Promise<DailyReport> {
    deadline.check();
    const config = ga4Config(); if (!config || !/^\d+$/.test(config.propertyId)) throw new CollectionError('ga4_config_missing');
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: config.clientEmail, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const assertion = `${input}.${sign('RSA-SHA256', Buffer.from(input), config.privateKey).toString('base64url')}`;
    const token = JSON.parse(await boundedText(new URL('https://oauth2.googleapis.com/token'), {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    }, fetch, 2_000_000, { deadline }));
    if (typeof token.access_token !== 'string') throw new CollectionError('ga4_token_failed');
    return async request => JSON.parse(await boundedText(new URL(`https://analyticsdata.googleapis.com/v1beta/properties/${config.propertyId}:runReport`), {
        method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    }, fetch, 8_000_000, { deadline }));
}
export async function collectGa4(day: string, threads: PromotionPost[], reportClient?: DailyReport, deadline = new CollectionDeadline()): Promise<SourceResult> {
    const result: SourceResult = { source: 'ga4', outcome: 'failed', reason: 'ga4_config_missing', observedAt: new Date().toISOString(), posts: [] };
    let successfulReports = 0; const issues: string[] = [];
    try {
        const run = reportClient || await createDailyReportClient(deadline);
        // Date dimension preserves actual daily unique users; no rolling-window subtraction or sum across days.
        const scopes = [
            { name: 'threads', dimensions: ['date', 'sessionManualAdContent'], filter: filter('sessionManualAdContent', 'share_', 'BEGINS_WITH', true) },
            { name: 'verified', dimensions: ['date', 'sessionManualAdContent'], filter: filter('sessionSource', 'threads', 'CONTAINS') },
            { name: 'te31', dimensions: ['date', 'sessionCampaignName'], filter: filter('sessionSource', 'te31') },
        ];
        const posts = new Map<string, PromotionPost>();
        for (const scope of scopes) for (const events of [false, true]) {
            try {
                deadline.check();
                const report = await run({ dateRanges: [{ startDate: dayBefore(day, 3), endDate: dayBefore(day) }],
                    dimensions: [...scope.dimensions, ...events ? ['eventName'] : []].map(name => ({ name })),
                    metrics: (events ? ['eventCount', 'totalUsers'] : ['sessions', 'activeUsers']).map(name => ({ name })),
                    dimensionFilter: events ? { andGroup: { expressions: [scope.filter, { orGroup: { expressions: ['detail_open', 'booking_click'].map(event => filter('eventName', event)) } }] } } : scope.filter,
                    limit: 10000 });
                validateDailyReport(report);
                // Validate the entire work unit before adopting any of its values.
                const seen = new Set<string>();
                for (const row of report.rows || []) {
                    const dims = row.dimensionValues?.map(value => value.value) || [];
                    const nums = row.metricValues?.map(value => value.value) || [];
                    const date = dims[0]?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
                    if (dims.length !== (events ? 3 : 2) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < dayBefore(day, 3) || date > dayBefore(day)
                        || nums.length !== 2 || nums.some(value => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
                        || (events && !['detail_open', 'booking_click'].includes(dims[2])) || seen.has(JSON.stringify(dims))) throw new CollectionError('ga4_invalid_rows');
                    seen.add(JSON.stringify(dims));
                }
                const at = new Date().toISOString();
                for (const row of report.rows || []) {
                    const dims = row.dimensionValues!.map(value => value.value); const nums = row.metricValues!.map(value => Number(value.value));
                    const date = dims[0].replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
                    const matches: PromotionPost[] = scope.name === 'te31'
                        ? TE31_POSTS.filter(post => post.campaign === dims[1]).map(post => ({ id: String(post.id), platform: 'te31', title: post.title, url: `https://te31.com/rgr/view.php?id=freead&no=${post.id}`, trackingContent: post.campaign, metrics: {} }))
                        : threads.filter(post => post.trackingContent && post.trackingContent === dims[1]);
                    for (const match of matches) {
                        const id = `${match.platform}:${match.id}`; const key = `${date}:${id}`;
                        const post = posts.get(key) || { ...match, id, metrics: {} };
                        const values = scope.name === 'verified' ? (!events ? { verifiedUsers: nums[1] } : {})
                            : events ? dims[2] === 'detail_open' ? { detailUsers: nums[1] } : { bookingUsers: nums[1], bookingClicks: nums[0] }
                                : { sessions: nums[0], users: nums[1] };
                        if (!Object.keys(values).length) continue;
                        post.metrics = { ...post.metrics, ...observedMetrics(values, date, at) }; posts.set(key, post);
                    }
                }
                successfulReports++;
            } catch (error) {
                issues.push(safeReason(error));
                if (error instanceof CollectionError && (error.blocked || error.code === 'source_deadline')) throw error;
            }
            result.posts = Array.from(posts.values());
        }
        result.outcome = successfulReports === 6 ? 'success' : successfulReports ? 'partial' : 'failed';
        result.reason = issues.length ? Array.from(new Set(issues)).join(',') : 'daily_kst_recent3_provisional';
    } catch (error) { result.outcome = result.posts.length ? 'partial' : 'failed'; result.reason = safeReason(error); }
    result.observedAt = new Date().toISOString(); return result;
}
