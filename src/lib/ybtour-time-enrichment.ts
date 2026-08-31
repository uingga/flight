import { chromium } from 'playwright';
import type { Flight } from '@/types/flight';
import { normalizeAirline } from '@/lib/utils/flight-helpers';
import { getYbtourScheduleKey } from '@/lib/scrapers/ybtour';
import {
    fetchYbtourSchedules,
    scheduleKeyOf,
    YBTOUR_SCHEDULE_REQUEST_LIMIT,
    type ScheduleAttempt,
    type ScheduleAttemptStatus,
    type ScheduleData,
    type ScheduleFetchStats,
    type ScheduleKey,
    type ScheduleParseFailureReason,
} from '@/lib/scrapers/ybtour-schedule';
import {
    assertNoSourceAccessBlockText,
    SourceResponseError,
} from '@/lib/scrapers/source-response';

const YBTOUR_PAGE = 'https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV';
const DAY_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_RETRY_MS = 2 * 60 * 60 * 1000;
const FIRST_FORMAT_RETRY_MS = 3 * DAY_MS;
const REPEATED_FORMAT_RETRY_MS = 7 * DAY_MS;

/** 상세 응답 파서나 후보 식별 방식을 바꿀 때 올려 형식 실패 항목을 한 번 재검증한다. */
export const YBTOUR_TIME_ADAPTER_VERSION = '2026-08-31.1';

export interface YbtourTimeEnrichmentEntry {
    status: ScheduleAttemptStatus;
    lastAttemptAt: string;
    nextAttemptAt?: string;
    attemptCount: number;
    adapterVersion: string;
    departureDate: string;
    reason?: ScheduleParseFailureReason;
    data?: ScheduleData;
}

export interface YbtourTimeEnrichmentState {
    version: 1;
    updatedAt?: string;
    entries: Record<string, YbtourTimeEnrichmentEntry>;
}

export interface YbtourTimeEnrichmentStats {
    visible: number;
    alreadyTimed: number;
    restoredFromState: number;
    eligible: number;
    selected: number;
    selectedRequests: number;
    deferred: number;
    succeeded: number;
    transientError: number;
    responseFormat: number;
    fetch?: ScheduleFetchStats;
}

export interface YbtourTimeCandidate {
    stateKey: string;
    scheduleId: string;
    scheduleKey: ScheduleKey;
    flights: Flight[];
    priority: number;
    lastAttemptAt: number;
}

export interface YbtourTimeQueue {
    state: YbtourTimeEnrichmentState;
    selected: YbtourTimeCandidate[];
    stats: YbtourTimeEnrichmentStats;
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

export function ybtourTimeKeyOf(flight: Flight): string {
    return [
        normalizeAirline(flight.airline || ''),
        flight.departure.airport || '',
        flight.arrival.airport || '',
        ymd(flight.departure.date),
        ymd(flight.arrival.date),
    ].join('|');
}

function completeTime(flight: Flight): boolean {
    return Boolean(
        flight.departure.time
        && flight.departure.arrivalTime
        && flight.arrival.time
        && flight.arrival.arrivalTime,
    );
}

function flightData(flight: Flight): ScheduleData | null {
    // 과거에 다른 여행사에서 빌려온 시각을 성공 상태로 굳히지 않도록, 노랑풍선
    // 상세 응답에서 함께 얻은 편명이 있는 항목만 검증된 성공값으로 시드한다.
    if (!completeTime(flight) || !flight.flightNumber) return null;
    return {
        flightNumber: flight.flightNumber,
        depTime: flight.departure.time,
        arrTime: flight.departure.arrivalTime || '',
        retDepTime: flight.arrival.time,
        retArrTime: flight.arrival.arrivalTime || '',
        minPax: flight.minPax || 1,
        baggage: '',
    };
}

function applyData(flight: Flight, data: ScheduleData): void {
    flight.departure.time = data.depTime;
    flight.departure.arrivalTime = data.arrTime;
    flight.arrival.time = data.retDepTime;
    flight.arrival.arrivalTime = data.retArrTime;
    if (data.flightNumber) flight.flightNumber = data.flightNumber;
    if (data.minPax > 1) flight.minPax = data.minPax;
}

function cleanState(
    input: YbtourTimeEnrichmentState | null | undefined,
    now: Date,
): YbtourTimeEnrichmentState {
    const entries: Record<string, YbtourTimeEnrichmentEntry> = {};
    const cutoff = todayYmd(now);
    const statuses = new Set<ScheduleAttemptStatus>(['success', 'transient_error', 'response_format']);
    for (const [key, value] of Object.entries(input?.entries || {})) {
        if (!value || typeof value !== 'object') continue;
        if (!/^\d{8}$/.test(value.departureDate || '') || value.departureDate < cutoff) continue;
        if (!statuses.has(value.status) || !value.lastAttemptAt || !Number.isFinite(Number(value.attemptCount))) continue;
        entries[key] = { ...value };
    }
    return { version: 1, updatedAt: input?.updatedAt, entries };
}

function retryPriority(entry: YbtourTimeEnrichmentEntry | undefined, nowMs: number): number | null {
    if (!entry) return 0;
    if (entry.adapterVersion !== YBTOUR_TIME_ADAPTER_VERSION) return 1;
    if (entry.status === 'success') return null;
    const next = timestamp(entry.nextAttemptAt);
    if (next !== null && nowMs < next) return null;
    return entry.status === 'transient_error' ? 2 : 3;
}

export function prepareYbtourTimeQueue(
    flights: Flight[],
    inputState: YbtourTimeEnrichmentState | null | undefined,
    options: { now?: Date; requestLimit?: number } = {},
): YbtourTimeQueue {
    const now = options.now || new Date();
    const nowMs = now.getTime();
    const state = cleanState(inputState, now);
    const visible = flights.filter(flight => flight.source === 'ybtour');
    let restoredFromState = 0;

    for (const flight of visible) {
        if (completeTime(flight)) continue;
        const entry = state.entries[ybtourTimeKeyOf(flight)];
        if (entry?.status === 'success' && entry.data) {
            applyData(flight, entry.data);
            restoredFromState++;
        }
    }

    for (const flight of visible) {
        const data = flightData(flight);
        if (!data) continue;
        const stateKey = ybtourTimeKeyOf(flight);
        if (state.entries[stateKey]?.status === 'success' && state.entries[stateKey]?.data) continue;
        state.entries[stateKey] = {
            status: 'success',
            lastAttemptAt: state.entries[stateKey]?.lastAttemptAt || now.toISOString(),
            attemptCount: Math.max(1, state.entries[stateKey]?.attemptCount || 0),
            adapterVersion: YBTOUR_TIME_ADAPTER_VERSION,
            departureDate: ymd(flight.departure.date),
            data,
        };
    }

    const byStateKey = new Map<string, YbtourTimeCandidate>();
    for (const flight of visible) {
        if (completeTime(flight)) continue;
        const scheduleKey = getYbtourScheduleKey(flight);
        if (!scheduleKey) continue;
        const stateKey = ybtourTimeKeyOf(flight);
        const entry = state.entries[stateKey];
        const priority = retryPriority(entry, nowMs);
        if (priority === null) continue;
        const existing = byStateKey.get(stateKey);
        if (existing) {
            existing.flights.push(flight);
            continue;
        }
        byStateKey.set(stateKey, {
            stateKey,
            scheduleId: scheduleKeyOf(scheduleKey),
            scheduleKey,
            flights: [flight],
            priority,
            lastAttemptAt: timestamp(entry?.lastAttemptAt) ?? 0,
        });
    }

    const eligible = Array.from(byStateKey.values()).sort((a, b) => (
        a.priority - b.priority
        || a.lastAttemptAt - b.lastAttemptAt
        || a.scheduleKey.depDate.localeCompare(b.scheduleKey.depDate)
        || a.stateKey.localeCompare(b.stateKey)
    ));
    const parsedLimit = Math.floor(options.requestLimit ?? YBTOUR_SCHEDULE_REQUEST_LIMIT);
    const requestedLimit = Number.isFinite(parsedLimit) ? parsedLimit : YBTOUR_SCHEDULE_REQUEST_LIMIT;
    const requestLimit = Math.max(1, Math.min(YBTOUR_SCHEDULE_REQUEST_LIMIT, requestedLimit));
    const selected: YbtourTimeCandidate[] = [];
    const selectedRequests = new Set<string>();
    for (const candidate of eligible) {
        if (!selectedRequests.has(candidate.scheduleId) && selectedRequests.size >= requestLimit) continue;
        selected.push(candidate);
        selectedRequests.add(candidate.scheduleId);
    }

    return {
        state,
        selected,
        stats: {
            visible: visible.length,
            alreadyTimed: visible.filter(completeTime).length,
            restoredFromState,
            eligible: eligible.length,
            selected: selected.length,
            selectedRequests: selectedRequests.size,
            deferred: eligible.length - selected.length,
            succeeded: 0,
            transientError: 0,
            responseFormat: 0,
        },
    };
}

export function recordYbtourTimeAttempts(
    state: YbtourTimeEnrichmentState,
    selected: YbtourTimeCandidate[],
    attempts: Map<string, ScheduleAttempt>,
    now = new Date(),
): YbtourTimeEnrichmentState {
    const next: YbtourTimeEnrichmentState = {
        version: 1,
        updatedAt: now.toISOString(),
        entries: { ...state.entries },
    };

    for (const candidate of selected) {
        const attempt = attempts.get(candidate.scheduleId);
        if (!attempt) continue;
        const previous = next.entries[candidate.stateKey];
        const base: YbtourTimeEnrichmentEntry = {
            status: attempt.status,
            lastAttemptAt: now.toISOString(),
            attemptCount: (previous?.attemptCount || 0) + 1,
            adapterVersion: YBTOUR_TIME_ADAPTER_VERSION,
            departureDate: ymd(candidate.flights[0]?.departure.date),
            reason: attempt.reason,
        };
        if (attempt.status === 'success' && attempt.data) {
            next.entries[candidate.stateKey] = { ...base, data: attempt.data };
        } else if (attempt.status === 'transient_error') {
            next.entries[candidate.stateKey] = {
                ...base,
                nextAttemptAt: new Date(now.getTime() + TRANSIENT_RETRY_MS).toISOString(),
            };
        } else {
            const delay = previous?.status === 'response_format'
                ? REPEATED_FORMAT_RETRY_MS
                : FIRST_FORMAT_RETRY_MS;
            next.entries[candidate.stateKey] = {
                ...base,
                nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
            };
        }
    }
    return next;
}

export async function enrichVisibleYbtourFlights(
    flights: Flight[],
    inputState: YbtourTimeEnrichmentState | null | undefined,
    options: { now?: Date; requestLimit?: number } = {},
): Promise<{ state: YbtourTimeEnrichmentState; stats: YbtourTimeEnrichmentStats }> {
    const now = options.now || new Date();
    const queue = prepareYbtourTimeQueue(flights, inputState, { ...options, now });
    if (queue.selected.length === 0) {
        queue.state.updatedAt = now.toISOString();
        console.log(`[노랑풍선] 최종 노출 ${queue.stats.visible}건 · 기존 시간 ${queue.stats.alreadyTimed}건 · 상세 시간 조회 대상 없음`);
        return { state: queue.state, stats: queue.stats };
    }

    console.log(
        `[노랑풍선] 최종 노출 ${queue.stats.visible}건 · 상세 시간 후보 ${queue.stats.eligible}건 `
        + `· 이번 회차 ${queue.stats.selectedRequests}/${YBTOUR_SCHEDULE_REQUEST_LIMIT}건 · 이월 ${queue.stats.deferred}건`,
    );

    const browser = await chromium.launch({ headless: !!process.env.CI });
    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 8000 },
            extraHTTPHeaders: {
                Referer: 'https://www.google.com/',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            },
        });
        const page = await context.newPage();
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        const landingResponse = await page.goto(YBTOUR_PAGE, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
        if (landingResponse && !landingResponse.ok()) {
            throw new SourceResponseError(
                'http-status',
                `노랑풍선 시간 보강 세션 페이지 HTTP ${landingResponse.status()}`,
                landingResponse.status(),
                landingResponse.headers()['content-type'] || '',
                undefined,
                landingResponse.url(),
            );
        }
        const landingText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
        assertNoSourceAccessBlockText('노랑풍선 시간 보강 세션 페이지', landingText, page.url());

        const result = await fetchYbtourSchedules(
            page,
            queue.selected.map(candidate => candidate.scheduleKey),
            { requestLimit: queue.stats.selectedRequests },
        );
        if (result.stats.stopReason === 'network') {
            throw new SourceResponseError(
                'soft-block',
                `노랑풍선 상세 시간 응답이 ${result.stats.failed}건 연속 실패했습니다.`,
                200,
            );
        }

        for (const candidate of queue.selected) {
            const data = result.schedules.get(candidate.scheduleId);
            if (!data) continue;
            candidate.flights.forEach(flight => applyData(flight, data));
        }

        const state = recordYbtourTimeAttempts(queue.state, queue.selected, result.attempts, now);
        const attemptValues = Array.from(result.attempts.values());
        const stats: YbtourTimeEnrichmentStats = {
            ...queue.stats,
            succeeded: attemptValues.filter(attempt => attempt.status === 'success').length,
            transientError: attemptValues.filter(attempt => attempt.status === 'transient_error').length,
            responseFormat: attemptValues.filter(attempt => attempt.status === 'response_format').length,
            fetch: result.stats,
        };
        console.log(
            `[노랑풍선] 최종 후보 시간 보강: 성공 ${stats.succeeded}, `
            + `일시 오류 ${stats.transientError}, 응답 형식 불일치 ${stats.responseFormat}`,
        );
        return { state, stats };
    } finally {
        await browser.close();
    }
}
