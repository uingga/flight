import type { ActiveCollectionRun, CrawlHistoryEntry, CollectionStat } from './admin-collection-history';

export interface OnlineCollectionSchedule {
    due: boolean;
    nextCollectionAt: string | null;
    intervalDays: number | null;
    anchorAt: string | null;
    protectionUntil?: string | null;
    previousFailure?: { at: string; detail: string } | null;
}
export type CurrentSourceState = {
    kind: 'rest' | 'partial'; label: string; message: string;
    nextEligibleAt?: string;
    rest?: { from: string; until: string };
    previousFailure?: { at: string; detail: string } | null;
};

export function isTaoyuanUnavailable(stat?: CollectionStat): boolean {
    return Boolean(stat?.partial && !stat.preserved && !stat.skipped
        && /타오위안|\bTPE\b/i.test(stat.detail || '') && /HTTP\s*500/i.test(stat.detail || ''));
}

export function currentSourceState(input: {
    source: string; now: number; onlineSchedule?: OnlineCollectionSchedule;
    history?: CrawlHistoryEntry[]; active?: ActiveCollectionRun | null;
    circuit?: { nextProbeAt?: string };
}): CurrentSourceState | null {
    if (!Number.isFinite(input.now)) return null;
    const active = input.active;
    if (active && ['queued', 'in_progress'].includes(active.status)
        && active.plannedSources.includes(input.source) && !active.skippedSources.includes(input.source)) return null;
    // Never describe a live or unconfirmed protection circuit as a routine schedule break.
    if (input.circuit && (!input.circuit.nextProbeAt || !Number.isFinite(Date.parse(input.circuit.nextProbeAt))
        || Date.parse(input.circuit.nextProbeAt) > input.now)) return null;
    const schedule = input.onlineSchedule;
    if (input.source === 'onlinetour' && schedule) {
        if (schedule.protectionUntil && (!Number.isFinite(Date.parse(schedule.protectionUntil))
            || Date.parse(schedule.protectionUntil) > input.now)) return null;
        const from = Date.parse(schedule.anchorAt || ''), until = Date.parse(schedule.nextCollectionAt || '');
        if (!schedule.due && [2, 3].includes(schedule.intervalDays || 0) && Number.isFinite(from)
            && from <= input.now && until > input.now && until - from === schedule.intervalDays! * 86400000) {
            return { kind: 'rest', label: '일정상 휴식', message: `${schedule.intervalDays}일 간격 · 현재 회차는 조회하지 않습니다.`,
                nextEligibleAt: schedule.nextCollectionAt!, rest: { from: schedule.anchorAt!, until: schedule.nextCollectionAt! },
                previousFailure: schedule.previousFailure };
        }
    }
    if (input.source === 'modetour') {
        const latest = (input.history || []).filter(e => Number.isFinite(Date.parse(e.timestamp))
            && Date.parse(e.timestamp) <= input.now && e.sites.modetour && !e.sites.modetour.skipped
            && e.sites.modetour.skipReason !== 'not-requested')
            .slice().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
        if (isTaoyuanUnavailable(latest?.sites.modetour)) return {
            kind: 'partial', label: '일부 반영 · 원본 조회 불가',
            message: '타오위안 원본 응답 오류(HTTP 500) · 매물 유무 미확인. 해당 구간은 기존 데이터 유지, 나머지는 반영했습니다.',
        };
    }
    return null;
}

export function collectionDetail(stat: CollectionStat): string | undefined {
    if (isTaoyuanUnavailable(stat)) return `원본 사이트 응답 오류 · 매물 유무 미확인. ${stat.detail}`;
    if (stat.detail === 'remote_worker_identity_mismatch') return '작업자 응답 식별 불일치 · 원본 항공권 유무는 확인하지 못했습니다.';
    return stat.detail;
}
