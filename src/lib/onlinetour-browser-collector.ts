import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Flight } from '../types/flight';
import { mapOnlineTourFlight } from './scrapers/onlinetour';
import { parseOnlineTourJsonp } from './scrapers/source-response';

export function parseDevToolsActivePort(text: string): string {
    const match = /^([1-9]\d{0,4})\r?\n(\/devtools\/browser\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\r?\n)?$/.exec(text);
    if (!match || Number(match[1]) > 65535) throw new Error('invalid_devtools_discovery');
    return `ws://127.0.0.1:${match[1]}${match[2]}`;
}

export function discoverNormalChromeEndpoint(localAppData = process.env.LOCALAPPDATA): string {
    if (!localAppData || !path.isAbsolute(localAppData)) throw new Error('missing_localappdata');
    const file = path.join(localAppData, 'Google', 'Chrome', 'User Data', 'DevToolsActivePort');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256) throw new Error('invalid_devtools_discovery');
    return parseDevToolsActivePort(fs.readFileSync(file, 'utf8'));
}

// Reject links/junctions along the entire path, not just the last component.
function assertCanonicalDirectory(directory: string): void {
    const absolute = path.resolve(directory);
    const parent = path.dirname(absolute);
    if (parent !== absolute) assertCanonicalDirectory(parent);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory() || path.resolve(fs.realpathSync.native(absolute)) !== absolute) {
        throw new Error('unsafe_staging_path');
    }
}

export function createStagingRun(repositoryRoot: string) {
    const root = path.resolve(repositoryRoot);
    assertCanonicalDirectory(root);
    let directory = root;
    for (const component of ['.local-crawler', 'staging']) {
        directory = path.join(directory, component);
        try { fs.mkdirSync(directory); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        assertCanonicalDirectory(directory);
    }
    const runId = randomUUID();
    directory = path.join(directory, runId);
    fs.mkdirSync(directory); // Exclusive: never reuse an existing run, even on UUID collision.
    assertCanonicalDirectory(directory);
    return {
        runId, directory,
        write(name: 'raw-products.json' | 'flights.json' | 'summary.json', value: unknown): void {
            if (!['raw-products.json', 'flights.json', 'summary.json'].includes(name)) throw new Error('unsafe_staging_filename');
            assertCanonicalDirectory(directory);
            fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        },
    };
}

export interface PilotValidation {
    status: 'pilot_ready_for_review' | 'failed_validation';
    partialScope: true;
    productionReady: false;
    rawProducts: unknown[];
    flights: Flight[];
    issues: { row: number | null; reason: string }[];
}

function validDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function integerField(value: unknown): number | null {
    if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
}

export function validatePilotResponse(text: string, callback: string): PilotValidation {
    // Never evaluate JSONP. Reject extra JavaScript rather than ignoring a suffix.
    if (!/^[A-Za-z_$][\w$]*$/.test(callback) || !/\)\s*;?\s*$/.test(text)) throw new Error('invalid_jsonp');
    const rawProducts = parseOnlineTourJsonp(text, callback).data.list;
    const flights: Flight[] = [];
    const issues: PilotValidation['issues'] = [];
    if (rawProducts.length < 1 || rawProducts.length > 20) issues.push({ row: null, reason: 'pilot_count_outside_1_20' });
    const ids = new Set<string>();
    rawProducts.slice(0, 20).forEach((raw, row) => {
        try {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_row');
            for (const key of ['dep_start_time', 'dep_end_time', 'arr_start_time', 'arr_end_time']) {
                if (typeof raw[key] !== 'string' || !/^(?:[01]\d|2[0-3]):?[0-5]\d$/.test(raw[key])) throw new Error(`invalid_${key}`);
            }
            if (typeof raw.dep_start_date !== 'string' || !/^\d{8}$/.test(raw.dep_start_date)
                || typeof raw.arr_start_date !== 'string'
                || !/^(?:\d{8}|\d{2}-\d{2}(?:\([월화수목금토일](?:요일)?\))?)$/.test(raw.arr_start_date)) throw new Error('invalid_date_format');
            const price = integerField(raw.adult_price);
            const fee = integerField(raw.adult_fee_price);
            const seats = integerField(raw.res_cnt);
            if (price === null || fee === null || price <= 0) throw new Error('invalid_price');
            if (seats === null) throw new Error('invalid_seats');
            if (raw.event_status_code !== '00') throw new Error('unsupported_event_status');
            // The browser card displays adult_price total. Neutralize legacy fee subtraction
            // only in this mapper input; the untouched raw response retains its actual fee.
            const flight = mapOnlineTourFlight({ ...raw, adult_fee_price: 0 });
            if (!flight) throw new Error('unmapped_row');
            if (!validDate(flight.departure.date) || !validDate(flight.arrival.date)
                || flight.arrival.date <= flight.departure.date) throw new Error('invalid_date');
            if (!Number.isSafeInteger(flight.price) || flight.price <= 0) throw new Error('invalid_mapped_price');
            if (ids.has(flight.id)) throw new Error('duplicate_id');
            ids.add(flight.id);
            flights.push({ ...flight, price, availableSeats: seats, seats: `${seats}석` });
        } catch (error) {
            issues.push({ row, reason: error instanceof Error ? error.message : 'invalid_row' });
        }
    });
    return { status: issues.length ? 'failed_validation' : 'pilot_ready_for_review',
        partialScope: true, productionReady: false, rawProducts, flights, issues };
}


export const ONLINE_LIST_URL = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
const API_URL = 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list';
export const CAPTURE_TIMEOUT_MS = 90_000;
type StagingRun = ReturnType<typeof createStagingRun>;
type PilotStage = 'attach_started' | 'attach_completed' | 'reload_started' | 'reload_completed'
    | 'document_response' | 'document_body_started' | 'document_body_completed'
    | 'api_request' | 'api_response' | 'api_response_unmatched' | 'api_response_claimed'
    | 'api_body_started' | 'api_body_completed' | 'validation_completed' | 'request_failed';
interface PilotDiagnostics {
    // Fixed stage names and numeric aggregates only; never URLs, headers, console errors or HTML.
    stages: Partial<Record<PilotStage, { firstMs: number; lastMs: number; count: number }>>;
    http: { document: number | null; api: number | null };
    waitingAtFailure: string[];
}
export interface PilotSummary {
    runId: string;
    status: PilotValidation['status'] | 'failed_preflight' | 'failed_access_restriction' | 'failed_network' | 'failed_timeout';
    partialScope: true;
    productionReady: false;
    scope: 'existing_current_list_first_response_max20_site_defaults';
    rawCount: number;
    mappedCount: number;
    issues: PilotValidation['issues'];
    preflight: { googleHomeTabPresent: boolean; evidence: 'tab_url_metadata_only_not_session_guarantee' };
    startedAt: string;
    finishedAt: string;
    diagnostics: PilotDiagnostics;
}


class PilotFailure extends Error {
    constructor(readonly status: PilotSummary['status'], reason: string) { super(reason); }
}
function matchesPage(raw: string, expected: string): boolean {
    try {
        const url = new URL(raw);
        return !url.username && !url.password && `${url.origin}${url.pathname}` === expected;
    } catch { return false; }
}
function deadline<T>(operation: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new PilotFailure('failed_timeout', 'capture_deadline')), ms);
        operation.then(resolve, reject).finally(() => clearTimeout(timer));
    });
}
const restricted = (status: number) => [401, 403, 429].includes(status);
const captcha = (text: string) => /captcha|access denied|request blocked|unusual traffic|비정상(?:적인)?\s*접근|자동화(?:된)?\s*요청|접근이?\s*제한|서비스\s*이용이?\s*제한/i.test(text);

export async function collectBrowserPilot(browser: import('playwright').Browser, run: StagingRun,
    timeoutMs = CAPTURE_TIMEOUT_MS): Promise<PilotSummary> {
    const summary: PilotSummary = { runId: run.runId, status: 'failed_validation', partialScope: true,
        productionReady: false, scope: 'existing_current_list_first_response_max20_site_defaults',
        rawCount: 0, mappedCount: 0, issues: [], startedAt: new Date().toISOString(), finishedAt: '',
        diagnostics: { stages: {}, http: { document: null, api: null }, waitingAtFailure: [] },
        preflight: { googleHomeTabPresent: false, evidence: 'tab_url_metadata_only_not_session_guarantee' } };
    let page: import('playwright').Page | undefined;
    let session: import('playwright').CDPSession | undefined;
    let active = true;
    const clockStarted = performance.now();
    const mark = (stage: PilotStage) => {
        if (!active) return; // Late bodies/navigation must not mutate a finalized result.
        const elapsed = Math.max(0, Math.round(performance.now() - clockStarted));
        const previous = summary.diagnostics.stages[stage];
        summary.diagnostics.stages[stage] = { firstMs: previous?.firstMs ?? elapsed,
            lastMs: elapsed, count: (previous?.count ?? 0) + 1 };
    };
    let documentBodiesPending = 0;
    let reloaded = false;
    let stopPromise: Promise<unknown> | undefined;
    const stop = () => {
        if (!stopPromise && session && reloaded) stopPromise = deadline(session.send('Page.stopLoading'), 1000).catch(() => {
            summary.issues.push({ row: null, reason: 'stop_loading_unconfirmed' });
        });
        return stopPromise;
    };
    let onResponse: (response: import('playwright').Response) => void = () => {};
    let onRequest: (request: import('playwright').Request) => void = () => {};
    let onFailed: (request: import('playwright').Request) => void = () => {};
    let onClosed = () => {};
    let rawProducts: unknown[] = [];
    let flights: Flight[] = [];
    try {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > CAPTURE_TIMEOUT_MS) {
            throw new PilotFailure('failed_preflight', 'invalid_capture_deadline');
        }
        const targets = browser.contexts().flatMap(context => context.pages()).filter(candidate => matchesPage(candidate.url(), ONLINE_LIST_URL));
        if (targets.length !== 1) throw new PilotFailure('failed_preflight', 'require_exactly_one_existing_list_tab');
        page = targets[0];
        summary.preflight.googleHomeTabPresent = page.context().pages().some(candidate => matchesPage(candidate.url(), 'https://myaccount.google.com/'));
        if (!summary.preflight.googleHomeTabPresent) throw new PilotFailure('failed_preflight', 'require_existing_google_home_tab');
        const target = page;
        const operation = async (): Promise<PilotValidation> => {
            mark('attach_started');
            const attached = await target.context().newCDPSession(target);
            if (!active) { void attached.detach().catch(() => {}); throw new PilotFailure('failed_timeout', 'late_attachment'); }
            session = attached;
            mark('attach_completed');
            const requests = new Set<import('playwright').Request>();
            let claimed = false;
            let documentCheck: Promise<void> = Promise.resolve();
            const isDocument = (request: import('playwright').Request) => request.isNavigationRequest() && request.frame() === target.mainFrame();
            const captured = new Promise<PilotValidation>((resolve, reject) => {
                const fail = (error: unknown) => {
                    if (!active) return;
                    if (error instanceof PilotFailure && error.status === 'failed_access_restriction') void stop();
                    reject(error);
                };
                onRequest = request => {
                    if (active && matchesPage(request.url(), API_URL)) { requests.add(request); mark('api_request'); }
                };
                onFailed = request => {
                    if (active && (requests.has(request) || isDocument(request))) {
                        mark('request_failed'); fail(new PilotFailure('failed_network', 'target_request_failed'));
                    }
                };
                onClosed = () => fail(new PilotFailure('failed_network', 'target_closed_or_crashed'));
                onResponse = response => {
                    if (!active) return;
                    const request = response.request();
                    const api = matchesPage(response.url(), API_URL);
                    const doc = isDocument(request);
                    if (!api && !doc) return;
                    mark(doc ? 'document_response' : 'api_response');
                    summary.diagnostics.http[doc ? 'document' : 'api'] = response.status();
                    if (restricted(response.status())) { fail(new PilotFailure('failed_access_restriction', `http_${response.status()}`)); return; }
                    if (response.status() >= 400) { fail(new PilotFailure('failed_network', 'target_http_error')); return; }
                    const readText = async () => {
                        let text: string;
                        mark(doc ? 'document_body_started' : 'api_body_started');
                        try { text = await response.text(); } catch { throw new PilotFailure('failed_network', 'response_body_failed'); }
                        mark(doc ? 'document_body_completed' : 'api_body_completed');
                        if (captcha(text)) throw new PilotFailure('failed_access_restriction', 'captcha_or_access_notice');
                        if (Buffer.byteLength(text, 'utf8') > 2_000_000) throw new PilotFailure('failed_validation', 'response_too_large');
                        return text;
                    };
                    if (doc) {
                        // Read only this target's document response; never store HTML/account/advertising data.
                        if (response.status() >= 300 && response.status() < 400) return;
                        documentBodiesPending++;
                        documentCheck = readText().then(() => {}).finally(() => { documentBodiesPending--; });
                        void documentCheck.catch(fail);
                        return;
                    }
                    if (!requests.has(request)) { mark('api_response_unmatched'); return; }
                    if (claimed) return;
                    mark('api_response_claimed');
                    claimed = true; // first response only, including malformed/empty results
                    void (async () => {
                        const url = new URL(response.url());
                        if (request.method() !== 'GET' || url.searchParams.get('pageNo') !== '1'
                            || url.searchParams.get('pageSize') !== '20' || url.searchParams.get('pageYn') !== 'Y') {
                            throw new PilotFailure('failed_validation', 'site_request_not_default_first_page_20');
                        }
                        const text = await readText();
                        let result: PilotValidation;
                        try { result = validatePilotResponse(text, url.searchParams.get('callback') || ''); }
                        catch (error) {
                            const status = (error as { status?: number }).status;
                            if (status && restricted(status)) throw new PilotFailure('failed_access_restriction', `api_${status}`);
                            throw new PilotFailure('failed_validation', 'invalid_jsonp_or_api_payload');
                        }
                        if (!active) return;
                        // Capture evidence before the independent document/navigation gates.
                        // A timeout/restriction stays failed even when valid rows were received.
                        rawProducts = result.rawProducts;
                        flights = result.flights;
                        summary.rawCount = rawProducts.length;
                        summary.mappedCount = flights.length;
                        summary.issues.push(...result.issues);
                        mark('validation_completed');
                        await documentCheck;
                        if (active) resolve(result);
                    })().catch(fail);
                };
                target.on('request', onRequest);
                target.on('requestfailed', onFailed);
                target.on('response', onResponse);
                target.on('close', onClosed);
                target.on('crash', onClosed);
            });
            reloaded = true;
            mark('reload_started');
            const reload = target.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).then(() => {
                mark('reload_completed');
            }).catch(() => {
                throw new PilotFailure('failed_network', 'list_reload_failed');
            });
            const [, result] = await Promise.all([reload, captured]);
            return result;
        };
        const result = await deadline(operation(), timeoutMs);
        summary.status = result.status;
        summary.rawCount = result.rawProducts.length;
        summary.mappedCount = result.flights.length;
        summary.issues = result.issues;
        rawProducts = result.rawProducts;
        flights = result.flights;
    } catch (error) {
        summary.status = error instanceof PilotFailure ? error.status : 'failed_network';
        const stages = summary.diagnostics.stages;
        const waiting = summary.diagnostics.waitingAtFailure;
        if (summary.status === 'failed_timeout') {
            // Terminal HTTP/schema/network errors are not outstanding response waits.
            if (stages.attach_started && !stages.attach_completed) waiting.push('cdp_attachment');
            if (reloaded) {
                if (!stages.reload_completed) waiting.push('navigation');
                if (!stages.api_request) waiting.push('api_request');
                else if (!stages.api_response_claimed) waiting.push('api_response');
                else if (!stages.api_body_completed) waiting.push('api_body');
                else if (!stages.validation_completed) waiting.push('validation');
                if (documentBodiesPending > 0) waiting.push('document_body');
            }
        }
        // Never leak Playwright messages (URLs, profile paths, tokens) into logs/staging.
        summary.issues.push({ row: null, reason: error instanceof PilotFailure ? error.message : 'browser_operation_failed' });
    } finally {
        active = false;
        if (page) {
            page.off('request', onRequest); page.off('requestfailed', onFailed); page.off('response', onResponse);
            page.off('close', onClosed); page.off('crash', onClosed);
        }
        await stop();
        if (session) await deadline(session.detach(), 1000).catch(() => {});
        // Playwright connectOverCDP: this closes the client connection, NOT normal Chrome.
        // Never send CDP Browser.close, close a user tab, or close the default context.
        await deadline(browser.close(), 1000).catch(() => {
            summary.issues.push({ row: null, reason: 'disconnect_unconfirmed' });
        });
    }
    summary.finishedAt = new Date().toISOString();
    run.write('raw-products.json', rawProducts);
    run.write('flights.json', flights);
    run.write('summary.json', summary);
    return summary;
}
