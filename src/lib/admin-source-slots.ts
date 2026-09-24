/**
 * 어드민 "여행사별 수집 상태" 막대 그래프의 공통 회차 축.
 *
 * 예전에는 여행사마다 자기 기록만 모아 마지막 16개를 그려서, 카드마다 막대 축이 달랐다
 * (땡처리는 하루 2회, 진행 중 회차는 막대 없음, PC 대체가 끼면 막대 하나 더).
 * 여기서는 일반 예약 회차(06:17·10:12·13:23·16:31·19:31 KST)를 축으로 고정한다.
 * 온라인투어와 땡처리닷컴 PC 주 수집도 같은 다섯 시각을 사용한다. 각 여행사 이벤트를
 * "그 회차 시각부터 다음 회차 시각 전까지" 창에 귀속시켜 회차당 막대 하나로 합친다.
 * 회차 시작 0~5분 랜덤 지연, 수집 소요 시간, PC 대체·수동 캡처의 늦은 반영은 모두 이 창 안에
 * 들어오므로 예약 시각으로 정규화된다.
 * 별도 수집하는 마이리얼트립·트립닷컴은 일반 회차에 끼워 넣지 않고 실제 기록별로 표시한다.
 */

export const CRAWL_SLOT_MINUTES_KST = [6 * 60 + 17, 10 * 60 + 12, 13 * 60 + 23, 16 * 60 + 31, 19 * 60 + 31] as const;
export const ONLINE_SLOT_MINUTES_KST = CRAWL_SLOT_MINUTES_KST;
export const SLOT_AXIS_LENGTH = 20;

const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 86_400_000;
const TTANG_PC_FOUR_FROM = Date.parse('2026-09-07T00:00:00+09:00');
const TTANG_PC_FIVE_FROM = Date.parse('2026-09-24T19:31:00+09:00');

export type SourceSlotEvent = {
    timestamp: string;
    value: number;
    countKind?: 'scraped' | 'shown' | 'manual';
    reason?: string;
    partial?: boolean;
    preserved: boolean;
    skipped: boolean;
    skippedUntil?: string;
    skipReason?: 'schedule' | 'circuit' | 'not-requested';
    manual: boolean;
    localFallback: boolean;
};

export type SlotStatus =
    | 'auto'        // 자동 수집 성공
    | 'pc'          // PC 대체 성공
    | 'manual'      // 수동 캡처 성공
    | 'failed'      // 수집 실패(이전 데이터 유지)
    | 'skipped'     // 차단 휴식 등으로 요청 자체를 안 함
    | 'unscheduled' // 이 여행사는 이 회차에 원래 예정 없음
    | 'running'     // 실제 실행 상태가 확인된 회차
    | 'pending'     // 예약 시각은 지났지만 실행 여부 또는 결과를 기다림
    | 'missing';    // 지난 회차인데 기록이 없음

export type SourceSlotBar = {
    slotAt: string;
    status: SlotStatus;
    /** 최종 결과의 수집 건수. 결과가 없으면 null. */
    value: number | null;
    /** 최종 결과로 채택된 이벤트. */
    final: SourceSlotEvent | null;
    /** 창 안에 들어온 모든 이벤트(시간순). 툴팁에서 "자동 실패 → PC 대체 성공"처럼 보여준다. */
    events: SourceSlotEvent[];
    scheduled: boolean;
    isLatest: boolean;
    runStage?: 'preparing' | 'crawling' | 'publishing';
};

/** 최근 회차 축. `now` 이전(포함)의 예약 회차를 오래된 순으로 `length`개 돌려준다. */
export function recentSlotTimes(now: number, length = SLOT_AXIS_LENGTH): number[] {
    return recentSlotTimesForSchedule(now, length, CRAWL_SLOT_MINUTES_KST);
}

function recentSlotTimesForSchedule(now: number, length: number, minutesOfDay: readonly number[]): number[] {
    const kstDayStart = Math.floor((now + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
    const slots: number[] = [];
    const daysNeeded = Math.ceil(length / minutesOfDay.length) + 1;
    for (let dayOffset = -daysNeeded; dayOffset <= 0; dayOffset += 1) {
        const day = kstDayStart + dayOffset * DAY_MS;
        for (const minutes of minutesOfDay) {
            const at = day + minutes * 60_000;
            if (at <= now) slots.push(at);
        }
    }
    return slots.slice(-length);
}

/** 여행사가 이 회차에 원래 수집 예정인지. 땡처리의 과거 2·4회와 현재 5회를 구분한다. */
export function isSourceScheduledAt(source: string, slotAt: number): boolean {
    if (source === 'myrealtrip' || source === 'tripcom') return false;
    if (source === 'ttang') {
        const kstMinutes = Math.floor(((slotAt + KST_OFFSET_MS) % DAY_MS) / 60_000);
        if (slotAt >= TTANG_PC_FIVE_FROM) return CRAWL_SLOT_MINUTES_KST.some(minutes => minutes === kstMinutes);
        if (slotAt >= TTANG_PC_FOUR_FROM) return CRAWL_SLOT_MINUTES_KST.slice(0, 4).some(minutes => minutes === kstMinutes);
        return kstMinutes === CRAWL_SLOT_MINUTES_KST[0] || kstMinutes === CRAWL_SLOT_MINUTES_KST[2];
    }
    return true;
}

export function eventStatus(event: SourceSlotEvent): Exclude<SlotStatus, 'unscheduled' | 'running' | 'pending' | 'missing'> {
    if (event.manual) return 'manual';
    if (event.skipped) return 'skipped';
    if (event.preserved) return 'failed';
    if (event.localFallback) return 'pc';
    return 'auto';
}

/**
 * 창 안의 이벤트를 최종 결과 하나로 합친다.
 * 실제 결과(성공·실패)가 있으면 그중 마지막, 없으면 마지막 건너뜀.
 * 예: 자동 실패 → PC 대체 성공 = PC 성공, 자동 실패 → 수동 캡처 = 수동 성공.
 */
export function pickFinalEvent(events: SourceSlotEvent[]): SourceSlotEvent | null {
    if (events.length === 0) return null;
    const substantive = events.filter(event => !event.skipped);
    if (substantive.length > 0) return substantive[substantive.length - 1];
    return events[events.length - 1];
}

export function buildSourceSlotBars(input: {
    source: string;
    events: SourceSlotEvent[];
    now: number;
    length?: number;
    /**
     * 전체 자동 수집이 마지막으로 끝난 시각. 가장 최근 회차가 이미 끝났는데 이 여행사 기록이
     * 없으면 "진행 중"이 아니라 "기록 없음"으로 그린다.
     */
    completedThrough?: number | null;
    /** Presentation only: a persisted online 2/3-day interval, not a new skip event. */
    scheduledRest?: { from: string; until: string };
    currentRun?: { startedAt: string; status: string; stage: 'queued' | 'preparing' | 'crawling' | 'publishing'; plannedSources: string[]; skippedSources: string[] } | null;
}): SourceSlotBar[] {
    if (input.source === 'myrealtrip' || input.source === 'tripcom') {
        // General-crawl cache preservation is not an independently collected run.
        const records = input.events.filter(event => {
            const at = Date.parse(event.timestamp);
            return Number.isFinite(at) && at <= input.now
                && event.skipReason !== 'schedule' && event.skipReason !== 'not-requested';
        }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
        const length = input.length ?? SLOT_AXIS_LENGTH;
        const recent = length > 0 ? records.slice(-length) : [];
        return recent.map((event, index) => ({
            slotAt: event.timestamp,
            status: eventStatus(event),
            value: event.skipped ? null : event.value,
            final: event,
            events: [event],
            scheduled: false,
            isLatest: index === recent.length - 1,
        }));
    }
    const slots = input.source === 'onlinetour'
        ? recentSlotTimesForSchedule(input.now, input.length ?? SLOT_AXIS_LENGTH, ONLINE_SLOT_MINUTES_KST)
        : recentSlotTimes(input.now, input.length ?? SLOT_AXIS_LENGTH);
    if (slots.length === 0) return [];
    const sorted = [...input.events]
        .map(event => ({ event, at: new Date(event.timestamp).getTime() }))
        .filter(item => Number.isFinite(item.at) && item.at <= input.now)
        .sort((a, b) => a.at - b.at);

    const activeAt = input.currentRun ? Date.parse(input.currentRun.startedAt) : NaN;
    const activeSlot = Number.isFinite(activeAt) && activeAt <= input.now
        ? input.source === 'onlinetour'
            ? recentSlotTimesForSchedule(activeAt, 1, ONLINE_SLOT_MINUTES_KST)[0]
            : recentSlotTimes(activeAt, 1)[0]
        : null;

    return slots.map((slotAt, index) => {
        const windowEnd = index + 1 < slots.length ? slots[index + 1] : Number.POSITIVE_INFINITY;
        // 첫 칸은 축보다 오래된 이벤트를 끌어오지 않도록 자기 회차 시각부터만 본다.
        const events = sorted
            .filter(item => item.at >= slotAt && item.at < windowEnd)
            .map(item => item.event);
        const scheduled = isSourceScheduledAt(input.source, slotAt);
        const isLatest = index === slots.length - 1;
        const final = pickFinalEvent(events);
        // 일정상 미실행 기록만 있는 칸은 "예정 없음"과 같은 뜻이므로 자리표시로 그린다.
        const scheduleSkip = final !== null && final.skipped && final.skipReason === 'schedule';
        const pcScheduleSkip = scheduleSkip && input.source === 'ttang' && scheduled;
        const onlyScheduleSkip = scheduleSkip && !pcScheduleSkip;
        const statusFinal = pcScheduleSkip ? null : final;
        const restFrom = Date.parse(input.scheduledRest?.from || ''), restUntil = Date.parse(input.scheduledRest?.until || '');
        const plannedRest = input.source === 'onlinetour' && Number.isFinite(restFrom) && Number.isFinite(restUntil)
            && restUntil > restFrom && slotAt > restFrom && slotAt < restUntil
            && !(slotAt === activeSlot && input.currentRun?.plannedSources.includes(input.source)
                && !input.currentRun.skippedSources.includes(input.source));

        let status: SlotStatus;
        if (statusFinal && !onlyScheduleSkip) status = eventStatus(statusFinal);
        else if (!scheduled || onlyScheduleSkip || plannedRest) status = 'unscheduled';
        else if (slotAt === activeSlot && input.currentRun?.status === 'in_progress'
            && input.currentRun.stage !== 'queued' && input.currentRun.plannedSources.includes(input.source)
            && !input.currentRun.skippedSources.includes(input.source)) status = 'running';
        else if (isLatest && !(input.completedThrough && input.completedThrough >= slotAt)) status = 'pending';
        else status = 'missing';

        return {
            slotAt: new Date(slotAt).toISOString(),
            status,
            value: statusFinal && !statusFinal.skipped ? statusFinal.value : null,
            final: statusFinal,
            events,
            scheduled,
            isLatest,
            runStage: status === 'running' && input.currentRun?.stage !== 'queued' ? input.currentRun?.stage : undefined,
        };
    });
}
