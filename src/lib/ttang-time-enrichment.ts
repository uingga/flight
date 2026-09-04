import type { Flight } from '@/types/flight';
import { normalizeAirline } from '@/lib/utils/flight-helpers';
import {
    enrichKeyOf,
    enrichWithRealtimeData,
    type EnrichAttempt,
    type EnrichAttemptStatus,
    type EnrichData,
    type RouteKey,
} from '@/lib/utils/realtime-enrich';
import {
    assertNoSourceAccessBlockText,
    isExplicitAccessRestrictionStatus,
    SourceResponseError,
} from '@/lib/scrapers/source-response';
import { openTtangBrowserSession } from '@/lib/ttang-browser-session';
import {
    fetchTtangProductScheduleInBrowser,
    type TtangProductReference,
} from '@/lib/ttang-product-schedule';

const TTANG_PROMOTION_PAGE = 'https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do';
const DAY_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_RETRY_MS = 2 * 60 * 60 * 1000;
const FIRST_EMPTY_RETRY_MS = 3 * DAY_MS;
const REPEATED_EMPTY_RETRY_MS = 7 * DAY_MS;
const SUCCESS_REFRESH_MS = 3 * DAY_MS;

/** 실시간 페이지 이동 수의 회차당 절대 상한. 환경변수는 이 값을 낮출 수만 있다. */
export const TTANG_TIME_REQUEST_LIMIT = 20;
/** 파서·항공사 매핑을 고치면 올려서 형식/항공사 불일치 항목을 한 번 다시 검증한다. */
export const TTANG_TIME_ADAPTER_VERSION = '2026-09-04.1';

export interface TtangTimeEnrichmentEntry {
    status: EnrichAttemptStatus;
    lastAttemptAt: string;
    nextAttemptAt?: string;
    attemptCount: number;
    adapterVersion: string;
    departureDate: string;
    /** 상세값을 마지막으로 정상 확인한 시각. 실패한 재확인과 분리한다. */
    lastSuccessAt?: string;
    data?: EnrichData;
}

export interface TtangTimeEnrichmentState {
    version: 2;
    updatedAt?: string;
    entries: Record<string, TtangTimeEnrichmentEntry>;
}

export interface TtangTimeEnrichmentStats {
    visible: number;
    alreadyTimed: number;
    restoredFromState: number;
    eligible: number;
    selected: number;
    selectedRoutes: number;
    deferred: number;
    succeeded: number;
    empty: number;
    airlineMismatch: number;
    transientError: number;
    responseFormat: number;
}

export interface TtangTimeCandidate {
    key: string;
    routeId: string;
    route: RouteKey;
    product?: TtangProductReference;
    flights: Flight[];
    priority: number;
    lastAttemptAt: number;
}

const randomDelay = (min: number, max: number) =>
    new Promise(resolve => setTimeout(resolve, (Math.random() * (max - min) + min) * 1000));

export interface TtangTimeQueue {
    state: TtangTimeEnrichmentState;
    selected: TtangTimeCandidate[];
    stats: TtangTimeEnrichmentStats;
}

function timestamp(value?: string): number | null {
    const parsed = new Date(value || '').getTime();
    return Number.isFinite(parsed) ? parsed : null;
}

function ymd(value?: string): string {
    return String(value || '').replace(/\D/g, '').slice(0, 8);
}

function todayYmd(now: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now).replace(/-/g, '');
}

export function ttangRouteKeyOf(flight: Flight): RouteKey {
    return {
        depCode: flight.departure.airport,
        arrCode: flight.arrival.airport,
        depDate: ymd(flight.departure.date),
        arrDate: ymd(flight.arrival.date),
        airline: normalizeAirline(flight.airline || ''),
    };
}

function routeIdOf(route: RouteKey): string {
    return `${route.depCode}|${route.arrCode}|${route.depDate}|${route.arrDate}`;
}

function productOf(flight: Flight): TtangProductReference | undefined {
    const masterId = String(flight.ttangProduct?.masterId || '').trim();
    const fareId = String(flight.ttangProduct?.fareId || '').trim();
    if (!masterId || !fareId) return undefined;
    return {
        masterId,
        fareId,
        ...(flight.ttangProduct?.tripDayLabel
            ? { tripDayLabel: flight.ttangProduct.tripDayLabel }
            : {}),
    };
}

/** 새 데이터는 실제 요금 상품, 과거 데이터는 기존 노선·항공사 키로 호환한다. */
export function ttangTimeKeyOf(flight: Flight): string {
    const product = productOf(flight);
    if (product) {
        return `product|${product.masterId}|${product.fareId}|${ymd(flight.departure.date)}`;
    }
    return enrichKeyOf(ttangRouteKeyOf(flight));
}

function completeTime(flight: Flight): boolean {
    return Boolean(
        flight.departure.time
        && flight.departure.arrivalTime
        && flight.arrival.time
        && flight.arrival.arrivalTime,
    );
}

function flightData(flight: Flight): EnrichData | null {
    if (!completeTime(flight)) return null;
    return {
        depTime: flight.departure.time,
        arrTime: flight.departure.arrivalTime || '',
        retDepTime: flight.arrival.time,
        retArrTime: flight.arrival.arrivalTime || '',
        seats: flight.availableSeats || Number.parseInt(flight.seats || '', 10) || 0,
    };
}

function applyData(flight: Flight, data: EnrichData, checkedAt?: string): void {
    flight.departure.time = data.depTime;
    flight.departure.arrivalTime = data.arrTime;
    flight.arrival.time = data.retDepTime;
    flight.arrival.arrivalTime = data.retArrTime;
    if (data.seats > 0) {
        flight.availableSeats = data.seats;
        flight.seats = `${data.seats}석`;
    }
    if (checkedAt) flight.detailCheckedAt = checkedAt;
}

function cleanState(
    input: TtangTimeEnrichmentState | null | undefined,
    now: Date,
): TtangTimeEnrichmentState {
    const entries: Record<string, TtangTimeEnrichmentEntry> = {};
    const cutoff = todayYmd(now);
    const statuses = new Set<EnrichAttemptStatus>([
        'success', 'empty', 'airline_mismatch', 'transient_error', 'response_format',
    ]);
    for (const [key, value] of Object.entries(input?.entries || {})) {
        if (!value || typeof value !== 'object') continue;
        if (!/^\d{8}$/.test(value.departureDate || '') || value.departureDate < cutoff) continue;
        if (!statuses.has(value.status) || !value.lastAttemptAt || !Number.isFinite(Number(value.attemptCount))) continue;
        entries[key] = { ...value };
    }
    return { version: 2, updatedAt: input?.updatedAt, entries };
}

function retryPriority(entry: TtangTimeEnrichmentEntry | undefined, nowMs: number): number | null {
    if (!entry) return 0; // 한 번도 조회하지 않은 신규 항공권이 최우선
    if (entry.adapterVersion !== TTANG_TIME_ADAPTER_VERSION) return 1;
    if (entry.status === 'success') {
        const lastSuccess = timestamp(entry.lastSuccessAt || entry.lastAttemptAt);
        return lastSuccess !== null && nowMs - lastSuccess >= SUCCESS_REFRESH_MS ? 2 : null;
    }
    if (entry.status === 'airline_mismatch' || entry.status === 'response_format') return null;
    const next = timestamp(entry.nextAttemptAt);
    if (next !== null && nowMs < next) return null;
    return entry.status === 'transient_error' ? 3 : 4;
}

function statusCounts(attempts: EnrichAttempt[]): Pick<
    TtangTimeEnrichmentStats,
    'succeeded' | 'empty' | 'airlineMismatch' | 'transientError' | 'responseFormat'
> {
    const counts = {
        succeeded: 0,
        empty: 0,
        airlineMismatch: 0,
        transientError: 0,
        responseFormat: 0,
    };
    for (const attempt of attempts) {
        if (attempt.status === 'success') counts.succeeded++;
        else if (attempt.status === 'empty') counts.empty++;
        else if (attempt.status === 'airline_mismatch') counts.airlineMismatch++;
        else if (attempt.status === 'transient_error') counts.transientError++;
        else counts.responseFormat++;
    }
    return counts;
}

export function prepareTtangTimeQueue(
    flights: Flight[],
    inputState: TtangTimeEnrichmentState | null | undefined,
    options: { now?: Date; requestLimit?: number } = {},
): TtangTimeQueue {
    const now = options.now || new Date();
    const nowMs = now.getTime();
    const state = cleanState(inputState, now);
    const visible = flights.filter(flight => flight.source === 'ttang');
    let restoredFromState = 0;

    // 상태에 저장된 마지막 성공값을 먼저 복구한다. 직전 재확인이 실패했더라도 data와
    // lastSuccessAt은 남겨 기존 시간·좌석을 잃지 않는다.
    for (const flight of visible) {
        if (completeTime(flight)) continue;
        const entry = state.entries[ttangTimeKeyOf(flight)];
        if (entry?.data) {
            applyData(flight, entry.data, entry.lastSuccessAt || entry.lastAttemptAt);
            restoredFromState++;
        }
    }

    // 캐시에서 물려받은 정확한 시간도 성공 상태로 시드한다.
    for (const flight of visible) {
        const data = flightData(flight);
        if (!data) continue;
        const route = ttangRouteKeyOf(flight);
        const key = ttangTimeKeyOf(flight);
        if (state.entries[key]?.data) continue;
        const checkedAt = flight.detailCheckedAt || state.entries[key]?.lastSuccessAt || now.toISOString();
        state.entries[key] = {
            status: 'success',
            lastAttemptAt: state.entries[key]?.lastAttemptAt || checkedAt,
            lastSuccessAt: checkedAt,
            attemptCount: Math.max(1, state.entries[key]?.attemptCount || 0),
            adapterVersion: TTANG_TIME_ADAPTER_VERSION,
            departureDate: route.depDate,
            data,
        };
    }

    const byKey = new Map<string, TtangTimeCandidate>();
    for (const flight of visible) {
        const route = ttangRouteKeyOf(flight);
        if (!route.depCode || !route.arrCode || route.depDate.length !== 8 || route.arrDate.length !== 8) continue;
        const key = ttangTimeKeyOf(flight);
        const entry = state.entries[key];
        const priority = retryPriority(entry, nowMs);
        if (priority === null) continue;
        const existing = byKey.get(key);
        if (existing) {
            existing.flights.push(flight);
            continue;
        }
        byKey.set(key, {
            key,
            routeId: routeIdOf(route),
            route,
            product: productOf(flight),
            flights: [flight],
            priority,
            lastAttemptAt: timestamp(entry?.lastAttemptAt) ?? 0,
        });
    }

    const eligible = Array.from(byKey.values()).sort((a, b) => (
        a.priority - b.priority
        || a.lastAttemptAt - b.lastAttemptAt
        || a.route.depDate.localeCompare(b.route.depDate)
        || a.key.localeCompare(b.key)
    ));
    const parsedLimit = Math.floor(options.requestLimit ?? TTANG_TIME_REQUEST_LIMIT);
    const requestedLimit = Number.isFinite(parsedLimit) ? parsedLimit : TTANG_TIME_REQUEST_LIMIT;
    const requestLimit = Math.max(1, Math.min(TTANG_TIME_REQUEST_LIMIT, requestedLimit));
    // hanaFareId 상품은 각각 한 번의 요청이므로 단순히 요청 수 자체를 제한한다.
    // 과거 상품 식별자가 없는 항목도 같은 상한 안에서만 보강한다.
    const selected = eligible.slice(0, requestLimit);
    const selectedRoutes = new Set(selected.map(candidate => candidate.routeId));

    return {
        state,
        selected,
        stats: {
            visible: visible.length,
            alreadyTimed: visible.filter(completeTime).length,
            restoredFromState,
            eligible: eligible.length,
            selected: selected.length,
            selectedRoutes: selectedRoutes.size,
            deferred: Math.max(0, eligible.length - selected.length),
            succeeded: 0,
            empty: 0,
            airlineMismatch: 0,
            transientError: 0,
            responseFormat: 0,
        },
    };
}

export function recordTtangTimeAttempts(
    state: TtangTimeEnrichmentState,
    selected: TtangTimeCandidate[],
    attempts: Map<string, EnrichAttempt>,
    now = new Date(),
): TtangTimeEnrichmentState {
    const next: TtangTimeEnrichmentState = {
        version: 2,
        updatedAt: now.toISOString(),
        entries: { ...state.entries },
    };
    const routeByKey = new Map(selected.map(candidate => [candidate.key, candidate.route]));

    for (const [key, attempt] of Array.from(attempts.entries())) {
        const route = routeByKey.get(key);
        if (!route) continue;
        const previous = next.entries[key];
        const attemptCount = (previous?.attemptCount || 0) + 1;
        const base: TtangTimeEnrichmentEntry = {
            status: attempt.status,
            lastAttemptAt: now.toISOString(),
            attemptCount,
            adapterVersion: TTANG_TIME_ADAPTER_VERSION,
            departureDate: route.depDate,
        };

        if (attempt.status === 'success' && attempt.data) {
            next.entries[key] = {
                ...base,
                lastSuccessAt: now.toISOString(),
                data: attempt.data,
            };
        } else if (attempt.status === 'empty') {
            const delay = previous?.status === 'empty' ? REPEATED_EMPTY_RETRY_MS : FIRST_EMPTY_RETRY_MS;
            next.entries[key] = {
                ...base,
                lastSuccessAt: previous?.lastSuccessAt,
                data: previous?.data,
                nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
            };
        } else if (attempt.status === 'transient_error') {
            next.entries[key] = {
                ...base,
                lastSuccessAt: previous?.lastSuccessAt,
                data: previous?.data,
                nextAttemptAt: new Date(now.getTime() + TRANSIENT_RETRY_MS).toISOString(),
            };
        } else {
            // 항공사/응답 형식 불일치는 같은 구현으로 반복해도 결과가 같으므로
            // adapterVersion이 바뀔 때만 다시 후보가 된다.
            next.entries[key] = {
                ...base,
                lastSuccessAt: previous?.lastSuccessAt,
                data: previous?.data,
            };
        }
    }
    return next;
}

export async function enrichVisibleTtangFlights(
    flights: Flight[],
    inputState: TtangTimeEnrichmentState | null | undefined,
    options: { now?: Date; requestLimit?: number } = {},
): Promise<{ state: TtangTimeEnrichmentState; stats: TtangTimeEnrichmentStats }> {
    const now = options.now || new Date();
    const queue = prepareTtangTimeQueue(flights, inputState, { ...options, now });
    if (queue.selected.length === 0) {
        queue.state.updatedAt = now.toISOString();
        console.log(`[땡처리] 최종 노출 ${queue.stats.visible}건 · 기존 시간 ${queue.stats.alreadyTimed}건 · 시간 조회 대상 없음`);
        return { state: queue.state, stats: queue.stats };
    }

    console.log(
        `[땡처리] 최종 노출 ${queue.stats.visible}건 · 시간 조회 후보 ${queue.stats.eligible}건 `
        + `· 이번 회차 ${queue.stats.selected}/${TTANG_TIME_REQUEST_LIMIT}개 상품 · 이월 ${queue.stats.deferred}건`,
    );

    const session = await openTtangBrowserSession();
    try {
        const page = session.page;
        console.log(`[땡처리] 상세 브라우저 모드: ${session.mode}`);
        const first = queue.selected[0].route;
        const landingResponse = await page.goto(
            `${TTANG_PROMOTION_PAGE}?trip=RT&depdate0=${first.depDate}&adt=1&chd=0&inf=0&page=1&scale=5`,
            { waitUntil: 'domcontentloaded', timeout: 30_000 },
        );
        if (landingResponse && !landingResponse.ok()) {
            throw new SourceResponseError(
                'http-status',
                `땡처리닷컴 시간 보강 세션 페이지 HTTP ${landingResponse.status()}`,
                landingResponse.status(),
                landingResponse.headers()['content-type'] || '',
                undefined,
                landingResponse.url(),
            );
        }
        await page.waitForTimeout(1_500);
        const landingText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
        assertNoSourceAccessBlockText('땡처리닷컴 시간 보강 세션 페이지', landingText, page.url());

        const attempts = new Map<string, EnrichAttempt>();
        const productCandidates = queue.selected.filter(candidate => candidate.product);
        const legacyCandidates = queue.selected.filter(candidate => !candidate.product);
        let consecutiveFailures = 0;

        for (let index = 0; index < productCandidates.length; index++) {
            const candidate = productCandidates[index];
            try {
                const data = await fetchTtangProductScheduleInBrowser(page, candidate.product!);
                attempts.set(candidate.key, { status: 'success', data });
                candidate.flights.forEach(flight => applyData(flight, data, now.toISOString()));
                consecutiveFailures = 0;
            } catch (error) {
                if (
                    error instanceof SourceResponseError
                    && (
                        isExplicitAccessRestrictionStatus(error.status)
                        || error.kind === 'html-response'
                        || error.kind === 'soft-block'
                    )
                ) {
                    throw error;
                }
                const status: EnrichAttemptStatus = error instanceof SourceResponseError
                    && (error.kind === 'schema-mismatch' || error.kind === 'malformed-json')
                    ? 'response_format'
                    : 'transient_error';
                attempts.set(candidate.key, { status });
                consecutiveFailures++;
                console.warn(
                    `[땡처리] hanaFareId ${candidate.product!.fareId} 상세 실패 `
                    + `(${status}, 연속 ${consecutiveFailures}건)`,
                );
            }

            if (consecutiveFailures >= 8) {
                throw new SourceResponseError(
                    'soft-block',
                    '땡처리닷컴 상품 일정 응답이 8건 연속 실패했습니다.',
                    200,
                );
            }
            if (index < productCandidates.length - 1 || legacyCandidates.length > 0) {
                await randomDelay(4, 8);
                if ((index + 1) % 10 === 0) await randomDelay(30, 60);
            }
        }

        if (legacyCandidates.length > 0) {
            // hanaFareId가 저장되기 전의 과거 항공권만 기존 노선·항공사 보강으로 처리한다.
            const legacyResult = await enrichWithRealtimeData(
                page,
                legacyCandidates.map(candidate => candidate.route),
                '땡처리(과거 데이터)',
            );
            legacyResult.attempts.forEach((attempt, key) => attempts.set(key, attempt));
            for (const candidate of legacyCandidates) {
                const data = legacyResult.enrichMap.get(candidate.key);
                if (!data) continue;
                candidate.flights.forEach(flight => applyData(flight, data, now.toISOString()));
            }
        }

        const state = recordTtangTimeAttempts(queue.state, queue.selected, attempts, now);
        const counts = statusCounts(Array.from(attempts.values()));
        const stats = { ...queue.stats, ...counts };
        console.log(
            `[땡처리] 시간 보강 결과: 성공 ${stats.succeeded}, 빈 결과 ${stats.empty}, `
            + `항공사 불일치 ${stats.airlineMismatch}, 일시 오류 ${stats.transientError}, 형식 불일치 ${stats.responseFormat}`,
        );
        return { state, stats };
    } finally {
        await session.close();
    }
}
