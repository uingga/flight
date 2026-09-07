import type { Flight } from '../types/flight';
import { getRegionByCity } from './utils/region-mapper';
import { MODETOUR_CHINA_DESTINATIONS, parseModetourRegionPayload } from './scrapers/modetour';
import { assertNoSourceAccessBlockText } from './scrapers/source-response';

export const MODE_BROWSER_URL = 'https://www.modetour.com/flights/discount-flight';
export const MODE_LIST_URL = 'https://b2c-api.modetour.com/DiscountFlight/GetList';
export interface ModeScope { continent: string; city: string; }
export interface ModePlan { from: string; through: string; scopes: ModeScope[]; maxListRequests: number; }
export interface ModeEvidence { url: string; status: number; contentType: string; body: string; }
export const modeScopeKey = (s: ModeScope) => `${s.continent}/${s.city}`;
/** CORS preflight addresses the API resource, not a flight-search scope. */
export function isModeListPreflight(method: string, url: string): boolean {
    const u = new URL(url);
    return method === 'OPTIONS' && u.origin + u.pathname === MODE_LIST_URL
        && !u.username && !u.password && !u.hash;
}
const day = 86_400_000;
function validDate(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function modeBrowserPlan(now = new Date()): ModePlan {
    const from = new Date(now.getTime() + 9 * 3_600_000 + day).toISOString().slice(0, 10);
    return { from, through: modeNextMonth(from),
        scopes: ['ASIA', 'JPN', 'SOPA', 'EUR', 'AMCA'].map(continent => ({ continent, city: '' }))
            .concat(MODETOUR_CHINA_DESTINATIONS.map(c => ({ continent: 'CHI', city: c.code }))),
        maxListRequests: 15 };
}
function modeNextMonth(from: string): string {
    const d = new Date(from), y = d.getUTCFullYear(), m = d.getUTCMonth();
    const lastDay = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
    return new Date(Date.UTC(y, m + 1, Math.min(d.getUTCDate(), lastDay))).toISOString().slice(0, 10);
}
export function validateModePlan(plan: ModePlan): void {
    if (!validDate(plan.from) || !validDate(plan.through) || plan.through !== modeNextMonth(plan.from))
        throw new Error('invalid_departure_window');
    const expected = modeBrowserPlan().scopes.map(modeScopeKey).sort();
    if (plan.maxListRequests !== 15 || JSON.stringify(plan.scopes.map(modeScopeKey).sort()) !== JSON.stringify(expected))
        throw new Error('incomplete_scope_plan');
}
export function modePageUrl(plan: ModePlan, scope: ModeScope): string {
    return `${MODE_BROWSER_URL}?query=${encodeURIComponent(JSON.stringify({ departureCity: '',
        continentCode: scope.continent, arrivalCity: scope.city, departureDate: plan.from,
        arrivalDate: plan.through, page: 1, itemCount: 500, sort: 'Lowest' }))}`;
}
/** Only the request made by the public page itself is accepted; no API replay. */
export function validateModeListUrl(url: string, plan: ModePlan, scope: ModeScope): number {
    const u = new URL(url);
    if (u.origin + u.pathname !== MODE_LIST_URL || u.username || u.password || u.hash) throw new Error('unexpected_list_endpoint');
    const fields: Record<string, string> = { ContinentCode: scope.continent, ArrivalCity: scope.city,
        DepartureCity: '', DepartureDate: plan.from, ArrivalDate: plan.through, Page: '1' };
    const values = (key: string) => Array.from(u.searchParams.entries())
        .filter(([k]) => k.toLowerCase() === key.toLowerCase()).map(([,v]) => v);
    for (const [key, value] of Object.entries(fields)) {
        const found = values(key);
        if (found.length !== 1 || found[0] !== value) throw new Error('list_scope_mismatch');
    }
    const sizes = values('ItemCount'), size = sizes[0];
    if (sizes.length !== 1 || !size || !/^\d+$/.test(size)
        || Number(size) < 1 || Number(size) > 500) throw new Error('invalid_page_size');
    return Number(size);
}
function text(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`invalid_${label}`);
    return value.trim();
}
function money(value: unknown): number {
    if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) throw new Error('invalid_fare');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > 20_000_000) throw new Error('invalid_fare');
    return n;
}
function airport(value: unknown): string {
    const s = text(value, 'airport');
    if (!/^[A-Z]{3}$/.test(s)) throw new Error('invalid_airport');
    return s;
}
function time(value: unknown): string {
    const s = text(value, 'time');
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new Error('invalid_time');
    return s;
}
/** Missing return directness stays unknown, never inferred from the outbound flight. */
export function modeRowToFlight(row: any, scope: ModeScope, plan: ModePlan): Flight | null {
    if (!row || typeof row !== 'object' || !validDate(row.sDate?.value) || !validDate(row.eDate?.value))
        throw new Error('invalid_flight_dates');
    if (row.sDate.value < plan.from || row.sDate.value > plan.through || row.eDate.value === row.sDate.value) return null;
    if (row.eDate.value < row.sDate.value) throw new Error('invalid_return_date');
    const dep = airport(row.departure?.code), arr = airport(row.arrival?.code);
    if (scope.city && scope.city !== arr) throw new Error('row_city_mismatch');
    const stock = String(row.stockPackageNo ?? '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(stock)) throw new Error('missing_product_id');
    const base = money(row.adult?.value), tax = money(row.adult?.tax), tax2 = money(row.adult?.tax2);
    const price = base + tax + tax2;
    if (price <= 0 || price > 20_000_000) throw new Error('invalid_fare');
    const departureTime = time(row.sDate.sTime), returnTime = time(row.eDate.sTime);
    const seats = row.rSeat?.value === undefined ? undefined : money(row.rSeat.value);
    if (seats !== undefined && seats > 999) throw new Error('invalid_seats');
    if (seats === 0) return null;
    const departureCity = text(row.departure.value, 'city'), arrivalCity = text(row.arrival.value, 'city');
    const optionalTime = (v: unknown) => v === undefined || v === null || v === '' ? undefined : time(v);
    const optionalMoney = (v: unknown) => v === undefined || v === null || v === '' ? undefined : money(v);
    const direct = (v: unknown) => v === 'N' ? true : v === 'Y' ? false : undefined;
    const query = { departureCity: dep, continentCode: scope.continent, arrivalCity: arr,
        departureDate: row.sDate.value, arrivalDate: row.sDate.value, page: 1, itemCount: 200, sort: 'Lowest' };
    query.arrivalDate = new Date(Date.parse(row.sDate.value) + day).toISOString().slice(0, 10);
    return { id: `modetour-${scope.continent}-${stock}`, source: 'modetour', airline: text(row.air?.value, 'airline'),
        departure: { city: departureCity, airport: dep, date: row.sDate.value, time: departureTime },
        arrival: { city: arrivalCity, airport: arr, date: row.eDate.value, time: returnTime }, price, currency: 'KRW',
        availableSeats: seats, region: getRegionByCity(arrivalCity),
        link: `${MODE_BROWSER_URL}?query=${encodeURIComponent(JSON.stringify(query))}`,
        modetourDetail: { baseFare: base, tax, tax2, departureArrivalTime: optionalTime(row.sDate.eTime),
            normalPrice: optionalMoney(row.adult.normal), sourceDiscountRate: optionalMoney(row.adult.discountRate),
            returnDepartureTime: returnTime, returnArrivalTime: optionalTime(row.eDate.eTime),
            isDirect: direct(row.start?.via), isReturnDirect: direct(row.eDate.via),
            returnDepartureAirport: row.localDeparture?.code ? airport(row.localDeparture.code) : undefined,
            returnArrivalAirport: row.koreanArrival?.code ? airport(row.koreanArrival.code) : undefined,
            departureFlightNo: row.air?.dfln || undefined, returnFlightNo: row.air?.afln || undefined } };
}
export interface ModeBackend {
    read(scope: ModeScope, plan: ModePlan): Promise<ModeEvidence>;
    wait(): Promise<void>;
}
export interface ModeContinuation {
    cached: Record<string, unknown[]>;
    failed: Array<{ scope: string; status: number }>;
    previousRequests: number;
}
/** No writes, retries, concurrent queries or partial-result success. */
export async function collectModeBrowser(plan: ModePlan, backend: ModeBackend,
    checkpoint: (scope: ModeScope, rows: unknown[]) => Promise<void> = async () => {}, previousFlights: Flight[] = [],
    continuation?: ModeContinuation) {
    validateModePlan(plan);
    const failed = [...(continuation?.failed || [])];
    const cached = continuation?.cached || {};
    const known = plan.scopes.map(modeScopeKey);
    const priorKeys = [...Object.keys(cached), ...failed.map(f => f.scope)];
    if (continuation && (new Set(priorKeys).size !== priorKeys.length
        || priorKeys.some(k => !known.includes(k)) || continuation.previousRequests !== priorKeys.length
        || failed.some(f => f.status !== 500) || Object.values(cached).some(r => !Array.isArray(r) || r.length >= 500)))
        throw new Error('invalid_continuation');
    const flights = new Map<string, Flight>();
    const coverage: Array<{ scope: string; rawCount: number }> = [];
    let rawCount = 0, excludedCount = 0, duplicates = 0, newRequests = 0;
    for (const scope of plan.scopes) {
        const key = modeScopeKey(scope);
        if (failed.some(f => f.scope === key)) continue;
        const replay = Object.prototype.hasOwnProperty.call(cached, key);
        let e: ModeEvidence;
        if (replay) {
            const u = new URL(MODE_LIST_URL);
            Object.entries({ departureCity: '', continentCode: scope.continent, arrivalCity: scope.city,
                departureDate: plan.from, arrivalDate: plan.through, page: '1', itemCount: '500' })
                .forEach(([k,v]) => u.searchParams.set(k,v));
            e = { url: u.href, status: 200, contentType: 'application/json', body: JSON.stringify({ result: cached[key] }) };
        } else {
            if (newRequests) await backend.wait();
            if ((continuation?.previousRequests || 0) + ++newRequests > plan.maxListRequests)
                throw new Error('list_budget_exceeded');
            e = await backend.read(scope, plan);
        }
        if ([401, 403, 429].includes(e.status)) throw new Error('access_restriction');
        try { assertNoSourceAccessBlockText('modetour', e.body); } catch { throw new Error('access_restriction'); }
        if (continuation && e.status === 500 && key === 'CHI/TPE') {
            failed.push({ scope: key, status: e.status });
            continue;
        }
        if (e.status !== 200) throw new Error('list_http_failure');
        const size = validateModeListUrl(e.url, plan, scope);
        try { assertNoSourceAccessBlockText('modetour', e.body); } catch { throw new Error('access_restriction'); }
        if (!/json/i.test(e.contentType) || e.body.length > 20_000_000) throw new Error('list_content_invalid');
        const rows = parseModetourRegionPayload(e.body);
        const payload = JSON.parse(e.body);
        for (const count of [payload.totalCount, payload.total, payload.resultCount]) {
            if (count !== undefined && (!/^\d+$/.test(String(count)) || Number(count) !== rows.length))
                throw new Error('pagination_requires_review');
        }
        // A full page is not proof of the end. Do not silently publish the first 500 products.
        if (rows.length >= size) throw new Error('pagination_requires_review');
        await checkpoint(scope, rows);
        const previous = previousFlights.filter(f => {
            if (f.source !== 'modetour' || f.departure.date < plan.from || f.departure.date > plan.through) return false;
            if (scope.city) return f.arrival.airport === scope.city;
            try {
                const u = new URL(f.link);
                return u.origin + u.pathname === MODE_BROWSER_URL
                    && JSON.parse(u.searchParams.get('query') || '{}').continentCode === scope.continent;
            } catch { return false; }
        }).length;
        if (previous && rows.length < previous * 0.6) throw new Error('source_count_collapse');
        for (const row of rows) {
            const f = modeRowToFlight(row, scope, plan);
            if (!f) { excludedCount++; continue; }
            const old = flights.get(f.id);
            if (old && JSON.stringify(old) !== JSON.stringify(f)) throw new Error('conflicting_product');
            if (old) duplicates++;
            flights.set(f.id, f);
        }
        rawCount += rows.length;
        coverage.push({ scope: modeScopeKey(scope), rawCount: rows.length });
    }
    if (!rawCount) throw new Error('empty_catalogue');
    return { flights: Array.from(flights.values()), coverage, rawCount, excludedCount, duplicates,
        listRequests: (continuation?.previousRequests || 0) + newRequests,
        newListRequests: newRequests, reusedScopes: Object.keys(cached).length, failed,
        status: failed.length ? 'incomplete' as const : 'staged' as const, productionReady: false as const };
}
