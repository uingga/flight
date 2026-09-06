import type { Flight } from '../types/flight';
import { validatePilotResponse } from './onlinetour-browser-collector';

export interface ListScope { departure: string; city: string; month: string; sort?: string; filter?: string; }
export interface ListPage {
    pageNo: number; totalCount: number; lastPage: number;
    rawProducts: Record<string, unknown>[];
    /** Explicit normalized SCREEN observation, never inferred from API metadata. */
    nextPageAvailable: boolean;
}
export class ListReadError extends Error {
    constructor(readonly kind: 'transient' | 'access' | 'validation', reason: string) {
        super(reason); this.name = 'ListReadError';
    }
}
export interface TraversalOptions {
    maxRequests?: number; maxPagesPerScope?: number; requestDelayMs?: number; retryDelayMs?: number;
    wait?: (ms: number) => Promise<void>;
}
export interface TraversalScopeResult {
    scope: ListScope; key: string; status: 'review_ready' | 'review_ready_with_changes' | 'failed' | 'not_started';
    pagesRead: number; rawCount: number; uniqueCount: number; duplicateCount: number;
    terminalVerified: boolean;
    plannedLastPage: number | null; firstTotalCount: number | null;
    latestTotalCount: number | null; latestLastPage: number | null;
    metadataChanged: boolean; confirmationPage: number | null; deferredGrowth: boolean;
}
export interface TraversalResult {
    status: 'review_ready' | 'review_ready_with_changes' | 'failed';
    productionReady: false; snapshotComplete: false;
    coverage: 'approved_scopes_only';
    requestCount: number; retryCount: number; rawCount: number; uniqueCount: number; duplicateCount: number;
    failedRowCount: number; failedRequestCount: number; failedPageCount: number;
    rawProducts: Record<string, unknown>[]; flights: Flight[];
    scopes: TraversalScopeResult[];
    issues: { reason: string; scopeKey: string | null; pageNo: number | null; row: number | null; severity: 'error' | 'warning' }[];
}

// Source evidence must actually be JSON, not values JSON.stringify would drop/coerce
// or objects whose toJSON/accessors could replace the record before validation.
function assertJson(value: unknown, ancestors = new Set<object>()): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw new Error('invalid_row');
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
        && Object.getPrototypeOf(value) !== null) throw new Error('invalid_row');
    ancestors.add(value);
    if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new Error('invalid_row');
    for (const key of Reflect.ownKeys(value)) {
        if (Array.isArray(value) && key === 'length') continue;
        const property = Object.getOwnPropertyDescriptor(value, key)!;
        if (typeof key !== 'string' || !property.enumerable || !('value' in property)) throw new Error('invalid_row');
        assertJson(property.value, ancestors);
    }
    ancestors.delete(value);
}

/**
 * List-only, finite approved scopes; never a full-site or single-snapshot claim.
 * attempt is 1-based. Budgets include confirmation reads and retry requests.
 * readPage/wait must settle: transport deadlines and cancellation belong to the adapter.
 * There is no timeout race, background task, or late callback that can mutate a returned result.
 * Global rawCount = uniqueCount + duplicateCount + failedRowCount. failedRowCount
 * includes quarantined rows in invalid envelopes. failedRequestCount counts rejected
 * reads (including recovered transients), failedPageCount counts terminal page failures
 * including budget/wait failures, not recovered attempts. Scope duplicates are local.
 */
export async function traverseOnlineTourLists(scopes: ListScope[],
    readPage: (scope: ListScope, pageNo: number, attempt: number) => Promise<ListPage>,
    options: TraversalOptions = {}): Promise<TraversalResult> {
    const result: TraversalResult = { status: 'review_ready', productionReady: false, snapshotComplete: false, coverage: 'approved_scopes_only',
        requestCount: 0, retryCount: 0, rawCount: 0, uniqueCount: 0, duplicateCount: 0,
        failedRowCount: 0, failedRequestCount: 0, failedPageCount: 0, rawProducts: [], flights: [], scopes: [], issues: [] };
    if (!Array.isArray(scopes) || Array.from(scopes).some(s => !s || typeof s.departure !== 'string'
        || !/^[A-Z]{3}$/.test(s.departure) || typeof s.city !== 'string' || !/^[A-Z]{3}$/.test(s.city)
        || typeof s.month !== 'string' || !/^[1-9]\d{3}(?:0[1-9]|1[0-2])$/.test(s.month)
        || (s.sort !== undefined && typeof s.sort !== 'string') || (s.filter !== undefined && typeof s.filter !== 'string'))) {
        result.status = 'failed';
        result.issues.push({ reason: 'invalid_scope', scopeKey: null, pageNo: null, row: null, severity: 'error' });
        return result;
    }
    const maxRequests = options?.maxRequests ?? 100;
    const maxPages = options?.maxPagesPerScope ?? 20;
    const requestDelay = options?.requestDelayMs ?? 5000;
    const retryDelay = options?.retryDelayMs ?? 10000;
    if (!options || !Number.isSafeInteger(maxRequests) || maxRequests < 1
        || !Number.isSafeInteger(maxPages) || maxPages < 1
        || !Number.isSafeInteger(requestDelay) || requestDelay < 0 || requestDelay > 2147483647
        || !Number.isSafeInteger(retryDelay) || retryDelay < 0 || retryDelay > 2147483647
        || (options.wait !== undefined && typeof options.wait !== 'function') || typeof readPage !== 'function') {
        result.status = 'failed';
        result.issues.push({ reason: 'invalid_options', scopeKey: null, pageNo: null, row: null, severity: 'error' });
        return result;
    }
    const prepared = new Map<string, ListScope>();
    for (const s of scopes) prepared.set(`${s.departure}|${s.city}|${s.month}`,
        { departure: s.departure, city: s.city, month: s.month });
    const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const ids = new Set<string>();
    for (const scope of Array.from(prepared.values())) {
        const record: TraversalScopeResult = { scope, key: `${scope.departure}|${scope.city}|${scope.month}`,
            status: 'review_ready', pagesRead: 0, rawCount: 0, uniqueCount: 0, duplicateCount: 0, terminalVerified: false,
            plannedLastPage: null, firstTotalCount: null, latestTotalCount: null, latestLastPage: null,
            metadataChanged: false, confirmationPage: null, deferredGrowth: false };
        result.scopes.push(record);
        const scopeIds = new Set<string>();
        let beyondBoundaryRows = false;
        const warn = (reason: string, pageNo: number) => {
            if (result.status !== 'failed') result.status = 'review_ready_with_changes';
            if (record.status !== 'failed') record.status = 'review_ready_with_changes';
            result.issues.push({ reason, scopeKey: record.key, pageNo, row: null, severity: 'warning' });
        };
        const fail = (reason: string, pageNo: number) => {
            result.status = 'failed'; record.status = 'failed'; result.failedPageCount++;
            result.issues.push({ reason, scopeKey: record.key, pageNo, row: null, severity: 'error' });
            return result;
        };
        for (let p = 1; ; p++) {
            if (record.pagesRead >= maxPages) return fail('page_budget_exhausted', p);
            let data!: ListPage;
            for (let attempt = 1; attempt <= 2; attempt++) {
                if (result.requestCount >= maxRequests) return fail('request_budget_exhausted', p);
                try { if (result.requestCount) await wait(attempt === 2 ? retryDelay : requestDelay); }
                catch { return fail('wait_failed', p); }
                result.requestCount++;
                if (attempt === 2) result.retryCount++;
                try { data = await readPage({ ...scope }, p, attempt); break; }
                catch (error) {
                    result.failedRequestCount++;
                    // Never expose adapter messages, URLs, tokens, or unclassified error properties.
                    const kind = error instanceof ListReadError ? error.kind : 'unknown';
                    if (kind === 'transient' && attempt === 1) continue;
                    result.status = 'failed'; record.status = 'failed'; result.failedPageCount++;
                    const reason = kind === 'access' ? 'read_access' : kind === 'validation' ? 'read_validation'
                        : kind === 'transient' ? 'read_transient_exhausted' : 'read_unknown';
                    result.issues.push({ reason, scopeKey: record.key, pageNo: p, row: null, severity: 'error' });
                    return result;
                }
            }
            record.pagesRead++;
            // Empty terminal confirmation and an observed shrink are not empty-scope claims.
            // Neither permits an empty intermediate page or an arbitrary pageNo mismatch.
            const emptyTerminal = data && p > 1 && data.nextPageAvailable === false
                && ((record.confirmationPage === p && data.lastPage < p)
                    || (record.firstTotalCount !== null && data.totalCount < record.firstTotalCount && data.lastPage < p));
            if (!data || typeof data !== 'object' || data.pageNo !== p
                || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0
                || !Number.isSafeInteger(data.lastPage) || data.lastPage < 0
                || typeof data.nextPageAvailable !== 'boolean' || !Array.isArray(data.rawProducts)
                || data.rawProducts.length > 20
                || (data.totalCount === 0 ? ((!emptyTerminal && p !== 1) || data.lastPage > 1 || data.rawProducts.length !== 0 || data.nextPageAvailable)
                    : (data.lastPage < 1 || (data.rawProducts.length === 0 && !emptyTerminal)))) {
                const rejected = Array.isArray(data?.rawProducts) ? data.rawProducts.length : 0;
                result.rawCount += rejected; record.rawCount += rejected; result.failedRowCount += rejected;
                return fail('invalid_page', p);
            }
            for (let index = 0; index < data.rawProducts.length; index++) {
                const raw = data.rawProducts[index];
                result.rawCount++; record.rawCount++;
                try {
                    assertJson(raw);
                    if (!raw || Array.isArray(raw) || typeof raw.event_code !== 'string'
                        || !raw.event_code || raw.event_code !== raw.event_code.trim()
                        || /[\u0000-\u001f\u007f]/.test(raw.event_code)) throw new Error('invalid_row');
                    // Each occurrence is validated, including changed duplicate values. The
                    // pilot's strict validator stays unchanged; singleton batches avoid its duplicate gate.
                    const validated = validatePilotResponse(`offlineList(${JSON.stringify({ status: 200, data: { list: [raw] } })});`, 'offlineList');
                    if (validated.status !== 'pilot_ready_for_review') throw new Error('invalid_row');
                    const flight = validated.flights[0];
                    if (flight.id !== `online-${raw.event_code}`) throw new Error('invalid_row');
                    if (!scopeIds.has(flight.id)) { record.uniqueCount++; scopeIds.add(flight.id); }
                    else record.duplicateCount++;
                    if (ids.has(flight.id)) {
                        result.duplicateCount++;
                        if (result.status !== 'failed') result.status = 'review_ready_with_changes';
                        if (record.status !== 'failed') record.status = 'review_ready_with_changes';
                        result.issues.push({ reason: 'duplicate_id', scopeKey: record.key, pageNo: p, row: index, severity: 'warning' });
                    } else {
                        ids.add(flight.id);
                        result.rawProducts.push(validated.rawProducts[0] as Record<string, unknown>);
                        result.flights.push(flight); result.uniqueCount++;
                    }
                } catch {
                    result.failedRowCount++; result.status = 'failed'; record.status = 'failed';
                    result.issues.push({ reason: 'invalid_row', scopeKey: record.key, pageNo: p, row: index, severity: 'error' });
                }
            }
            if (result.status === 'failed') { result.failedPageCount++; return result; }
            if (record.plannedLastPage === null) {
                record.plannedLastPage = data.lastPage; record.firstTotalCount = data.totalCount;
            } else if (data.totalCount !== record.latestTotalCount || data.lastPage !== record.latestLastPage) {
                record.metadataChanged = true; warn('list_metadata_changed', p);
            }
            record.latestTotalCount = data.totalCount; record.latestLastPage = data.lastPage;
            if (record.confirmationPage === p && data.rawProducts.length > 0) {
                beyondBoundaryRows = true; warn('products_beyond_planned_boundary', p);
            }
            if (!data.nextPageAvailable || record.confirmationPage === p) {
                record.terminalVerified = !data.nextPageAvailable;
                if (data.nextPageAvailable) { record.deferredGrowth = true; warn('growth_deferred', p); }
                if (!record.metadataChanged) {
                    if (p < record.plannedLastPage) return fail('expected_pages_missing', p);
                    // Duplicate IDs explain unique-count deficits, never missing raw observations.
                    if (record.rawCount < record.firstTotalCount!) return fail('expected_rows_missing', p);
                    if (record.rawCount > record.firstTotalCount! && !beyondBoundaryRows
                        && record.uniqueCount > record.firstTotalCount!) return fail('expected_count_mismatch', p);
                } else if (record.rawCount !== data.totalCount || p < record.plannedLastPage) {
                    warn('changed_list_completeness_uncertain', p);
                }
                break;
            }
            // Only the supplied enabled screen control authorizes the one extra read.
            // Freeze the first boundary forever; growth cannot extend the traversal loop.
            if (p >= record.plannedLastPage) record.confirmationPage = p + 1;
        }
    }
    return result;
}
