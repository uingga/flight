const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// daily-crawl.yml과 함께 유지해야 하는 일반 항공권 수집 시각(UTC)이다.
export const DAILY_CRAWL_CRONS = Object.freeze([
    '17 23 * * *',
    '12 2 * * *',
    '23 5 * * *',
    '31 8 * * *',
]);

// 땡처리닷컴은 차단 위험을 낮추기 위해 일반 4개 회차 중 08:17·14:23 KST만 수집한다.
export const TTANG_CRAWL_CRONS = Object.freeze([
    '17 23 * * *',
    '23 5 * * *',
]);

// daily-crawl.yml에서 한 번에 확인하는 일반 여행사다. 마이리얼트립은 별도
// 워크플로우 소스이므로 전체 일반 크롤 완료 시각을 복원할 때 포함하지 않는다.
export const FULL_CRAWL_SOURCE_KEYS = Object.freeze([
    'ybtour',
    'hanatour',
    'modetour',
    'onlinetour',
    'ttang',
]);

// GitHub 예약 실행이 45분 넘게 생성되지 않으면 운영실에 먼저 알리고,
// 60분부터 watchdog이 workflow_dispatch 보조 실행을 요청한다.
export const CRAWL_WARNING_MINUTES = 45;
export const CRAWL_FALLBACK_MINUTES = 60;

function toTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * 캐시에서 마지막 전체 일반 크롤 완료 시각을 읽는다.
 *
 * timestamp는 부분 소스 복구와 후처리에서도 바뀔 수 있으므로 예약 누락 판단에 쓰지
 * 않는다. 새 캐시는 fullCrawlUpdatedAt을 명시하고, 필드가 없는 이전 캐시는 모든 일반
 * 여행사의 마지막 성공 시각 중 가장 오래된 값을 사용해 보수적으로 한 번 복구한다.
 */
export function getFullCrawlUpdatedAt(cache) {
    const explicit = toTimestamp(cache?.fullCrawlUpdatedAt);
    if (explicit !== null) return new Date(explicit).toISOString();

    const legacySourceTimes = FULL_CRAWL_SOURCE_KEYS.map(source =>
        toTimestamp(cache?.sourceUpdatedAt?.[source])
    );
    if (legacySourceTimes.some(timestamp => timestamp === null)) return null;

    return new Date(Math.min(...legacySourceTimes)).toISOString();
}

export function parseDailyCron(cron) {
    const match = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec((cron || '').trim());
    if (!match) return null;

    const minute = Number(match[1]);
    const hour = Number(match[2]);
    if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
    return { minute, hour };
}

/** 예약 회차 시각이 땡처리닷컴 수집 허용 회차인지 확인한다. */
export function isTtangCrawlSlot(expectedAt) {
    const expectedTimestamp = toTimestamp(expectedAt);
    if (expectedTimestamp === null) return false;
    const expected = new Date(expectedTimestamp);
    return TTANG_CRAWL_CRONS.some(cron => {
        const parsed = parseDailyCron(cron);
        return parsed
            && expected.getUTCHours() === parsed.hour
            && expected.getUTCMinutes() === parsed.minute;
    });
}

/** 해당 일일 cron 식이 now 이전에 가장 최근에 예정됐던 시각을 반환한다. */
export function getScheduledAtForCron(cron, now = Date.now()) {
    const parsed = parseDailyCron(cron);
    const nowTimestamp = toTimestamp(now);
    if (!parsed || nowTimestamp === null) return null;

    const current = new Date(nowTimestamp);
    let scheduledAt = Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth(),
        current.getUTCDate(),
        parsed.hour,
        parsed.minute,
    );
    if (scheduledAt > nowTimestamp) scheduledAt -= DAY_MS;
    return scheduledAt;
}

function scheduledSlotsBetween(startExclusive, endInclusive, crons) {
    const slots = [];
    const firstDay = Math.floor(startExclusive / DAY_MS) * DAY_MS;
    const lastDay = Math.floor(endInclusive / DAY_MS) * DAY_MS;

    for (let day = firstDay; day <= lastDay; day += DAY_MS) {
        for (const cron of crons) {
            const parsed = parseDailyCron(cron);
            if (!parsed) continue;
            const scheduledAt = day + parsed.hour * 60 * MINUTE_MS + parsed.minute * MINUTE_MS;
            if (scheduledAt > startExclusive && scheduledAt <= endInclusive) {
                slots.push({ cron, scheduledAt });
            }
        }
    }

    return slots.sort((a, b) => a.scheduledAt - b.scheduledAt);
}

/**
 * 마지막 전체 크롤 완료 이후 아직 새 전체 크롤이 덮지 못한 가장 오래된 예약 회차를 찾는다.
 * 뒤 회차가 막 예정됐다는 이유로 앞 회차 누락이 가려지지 않도록 oldest pending을 사용한다.
 */
export function getCrawlScheduleHealth(lastCompletedAt, options = {}) {
    const nowTimestamp = toTimestamp(options.now ?? Date.now());
    if (nowTimestamp === null) throw new Error('Invalid current time');

    const warningMinutes = options.warningMinutes ?? CRAWL_WARNING_MINUTES;
    const fallbackMinutes = options.fallbackMinutes ?? CRAWL_FALLBACK_MINUTES;
    const crons = options.crons ?? DAILY_CRAWL_CRONS;
    const parsedCompletedAt = lastCompletedAt ? toTimestamp(lastCompletedAt) : null;
    // 데이터가 오래 멈췄더라도 운영실에 무한 목록을 만들지 않도록 최근 7일만 센다.
    const scanStart = Math.max(parsedCompletedAt ?? 0, nowTimestamp - 7 * DAY_MS);
    const pendingSlots = scheduledSlotsBetween(scanStart, nowTimestamp, crons);
    const oldestPending = pendingSlots[0] ?? null;

    if (!oldestPending) {
        const latestExpected = crons
            .map(cron => ({ cron, scheduledAt: getScheduledAtForCron(cron, nowTimestamp) }))
            .filter(slot => slot.scheduledAt !== null)
            .sort((a, b) => b.scheduledAt - a.scheduledAt)[0] ?? null;

        return {
            status: 'healthy',
            expectedAt: latestExpected ? new Date(latestExpected.scheduledAt).toISOString() : null,
            expectedCron: latestExpected?.cron ?? null,
            lastCompletedAt: parsedCompletedAt === null ? null : new Date(parsedCompletedAt).toISOString(),
            delayMinutes: 0,
            pendingSlots: 0,
            warningMinutes,
            fallbackMinutes,
        };
    }

    const delayMinutes = Math.max(0, Math.floor((nowTimestamp - oldestPending.scheduledAt) / MINUTE_MS));
    const status = delayMinutes >= fallbackMinutes
        ? 'overdue'
        : delayMinutes >= warningMinutes
            ? 'late'
            : 'waiting';

    return {
        status,
        expectedAt: new Date(oldestPending.scheduledAt).toISOString(),
        expectedCron: oldestPending.cron,
        lastCompletedAt: parsedCompletedAt === null ? null : new Date(parsedCompletedAt).toISOString(),
        delayMinutes,
        pendingSlots: pendingSlots.length,
        warningMinutes,
        fallbackMinutes,
    };
}
