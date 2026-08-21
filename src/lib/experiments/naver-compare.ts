export const NAVER_COMPARE_EXPERIMENT = {
    id: 'hide_naver_compare_20260821',
    label: '네이버 가격비교 버튼 숨김',
    // 배포 직후부터 숨기고, 14일의 온전한 날짜(8/22~9/4)를 확보한 뒤 자동 복원한다.
    hideStartsAt: '2026-08-21T22:00:00+09:00',
    hideEndsAt: '2026-09-05T00:00:00+09:00',
    measurementStartDate: '2026-08-22',
    measurementEndDate: '2026-09-04',
    previousPeriodStartDate: '2026-08-08',
    previousPeriodEndDate: '2026-08-21',
    // detail_open은 8/14부터만 존재하므로 숨김 전 전환율은 이 7일만 유효하다.
    comparableBaselineStartDate: '2026-08-14',
    comparableBaselineEndDate: '2026-08-20',
    detailTrackingStartedAt: '2026-08-14T18:49:13+09:00',
    // Supabase 신고 저장은 8/21 저녁부터 시작되어 숨김 전 신고율 기준선은 만들 수 없다.
    storedReportsStartedAt: '2026-08-21T18:33:34+09:00',
    minimumEvaluationDays: 7,
    minimumDetailUsers: 20,
    priceReportMinimumCount: 3,
    priceReportStopRate: 10,
} as const;

export type NaverCompareExperimentPhase = 'before' | 'hidden' | 'restored';

export function getNaverCompareExperimentPhase(now = new Date()): NaverCompareExperimentPhase {
    const time = now.getTime();
    if (time < new Date(NAVER_COMPARE_EXPERIMENT.hideStartsAt).getTime()) return 'before';
    if (time < new Date(NAVER_COMPARE_EXPERIMENT.hideEndsAt).getTime()) return 'hidden';
    return 'restored';
}

export function isNaverCompareHidden(now = new Date()): boolean {
    return getNaverCompareExperimentPhase(now) === 'hidden';
}

function dateValue(date: string): number {
    return new Date(`${date}T00:00:00Z`).getTime();
}

export function addCalendarDays(date: string, days: number): string {
    return new Date(dateValue(date) + days * 86_400_000).toISOString().slice(0, 10);
}

function minDate(a: string, b: string): string {
    return dateValue(a) <= dateValue(b) ? a : b;
}

function inclusiveDays(startDate: string, endDate: string): number {
    return Math.floor((dateValue(endDate) - dateValue(startDate)) / 86_400_000) + 1;
}

export function kstDate(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

export interface NaverCompareMeasurementRanges {
    comparableDays: number;
    baselineFull: { startDate: string; endDate: string };
    baseline: { startDate: string; endDate: string } | null;
    hidden: { startDate: string; endDate: string } | null;
    hiddenFull: { startDate: string; endDate: string } | null;
}

/**
 * GA4는 당일 데이터가 덜 채워질 수 있어 어제까지의 날짜만 쓴다.
 * 숨김 후 첫 7일과 숨김 전 마지막 7일을 같은 일수로 맞춰 비교한다.
 */
export function getNaverCompareMeasurementRanges(now = new Date()): NaverCompareMeasurementRanges {
    const experiment = NAVER_COMPARE_EXPERIMENT;
    const latestCompleteDate = addCalendarDays(kstDate(now), -1);
    const hiddenEnd = minDate(latestCompleteDate, experiment.measurementEndDate);

    if (dateValue(hiddenEnd) < dateValue(experiment.measurementStartDate)) {
        return {
            comparableDays: 0,
            baselineFull: {
                startDate: experiment.previousPeriodStartDate,
                endDate: experiment.previousPeriodEndDate,
            },
            baseline: null,
            hidden: null,
            hiddenFull: null,
        };
    }

    const availableDays = inclusiveDays(experiment.measurementStartDate, hiddenEnd);
    const comparableDays = Math.min(availableDays, experiment.minimumEvaluationDays);
    const baselineEnd = experiment.comparableBaselineEndDate;
    const baselineStart = addCalendarDays(baselineEnd, -(comparableDays - 1));
    const comparableHiddenEnd = addCalendarDays(experiment.measurementStartDate, comparableDays - 1);

    return {
        comparableDays,
        baselineFull: {
            startDate: experiment.previousPeriodStartDate,
            endDate: experiment.previousPeriodEndDate,
        },
        baseline: { startDate: baselineStart, endDate: baselineEnd },
        hidden: { startDate: experiment.measurementStartDate, endDate: comparableHiddenEnd },
        hiddenFull: { startDate: experiment.measurementStartDate, endDate: hiddenEnd },
    };
}
