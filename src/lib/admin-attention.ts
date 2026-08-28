export type AdminAttentionTab = 'operations' | 'audience';

export interface AdminAttentionItem {
    id: 'crawl-schedule' | 'collection' | 'comparison' | 'booking-links' | 'reports' | 'alert-candidates' | 'alert-review-load';
    area: string;
    state: string;
    cause: string;
    nextAction: string;
    tab: AdminAttentionTab;
}

export interface AdminAttentionInput {
    crawlSchedule?: {
        issue: boolean;
        delayMinutes: number;
        overdue: boolean;
    };
    collection: {
        sourceIssueCount: number;
        criticalAlertCount: number;
    };
    comparison: {
        needsAttention: boolean;
        lastCheckedLabel?: string;
    };
    bookingLinks: {
        failed: number;
        systemicSources: number;
    };
    reports: {
        available: boolean;
        loadError: boolean;
        needsReview: number;
        activeHides: number;
    };
    alerts: {
        available: boolean;
        unavailable: boolean;
        loadError: boolean;
        qualifiedCandidates: number;
        pendingRecipients: number;
        deliveryAvailable: boolean;
    };
}

/** 기존 어드민 응답만 조합해 오늘의 상태 → 원인 후보 → 다음 행동을 만든다. */
export function buildAdminAttentionItems(input: AdminAttentionInput): AdminAttentionItem[] {
    const items: AdminAttentionItem[] = [];

    if (input.crawlSchedule?.issue) {
        items.push({
            id: 'crawl-schedule',
            area: '전체 자동 수집',
            state: `${input.crawlSchedule.delayMinutes}분 지연`,
            cause: input.crawlSchedule.overdue
                ? '예정 회차가 자동 복구 확인 기준을 넘었습니다.'
                : '예정 회차의 완료 기록이 아직 반영되지 않았습니다.',
            nextAction: input.crawlSchedule.overdue
                ? '최근 수집 기록과 자동 복구 결과를 확인하세요.'
                : '완료 기록이 들어오는지 확인하세요.',
            tab: 'operations',
        });
    }

    if (input.collection.sourceIssueCount > 0 || input.collection.criticalAlertCount > 0) {
        items.push({
            id: 'collection',
            area: '여행사 항공권 수집',
            state: input.collection.sourceIssueCount > 0
                ? `${input.collection.sourceIssueCount}곳 확인 필요`
                : `${input.collection.criticalAlertCount}건 무결성 경보`,
            cause: input.collection.criticalAlertCount > 0
                ? '새 수집 결과를 폐기하고 이전 데이터를 유지한 기록이 있습니다.'
                : '최근 갱신이 늦거나 연속 실패한 여행사가 있습니다.',
            nextAction: '여행사별 최근 수집량과 실패 기록을 확인하세요.',
            tab: 'operations',
        });
    }

    if (input.comparison.needsAttention) {
        items.push({
            id: 'comparison',
            area: '가격 비교 데이터',
            state: '갱신 상태 확인',
            cause: input.comparison.lastCheckedLabel
                ? `마지막 확인 ${input.comparison.lastCheckedLabel}`
                : '가격 비교 확인 기록이 없습니다.',
            nextAction: '최근 가격 비교 수집 기록의 성공·실패 수를 확인하세요.',
            tab: 'operations',
        });
    }

    if (input.bookingLinks.failed > 0) {
        items.push({
            id: 'booking-links',
            area: '예약 링크 연결',
            state: `${input.bookingLinks.failed}개 확인 필요`,
            cause: input.bookingLinks.systemicSources > 0
                ? `${input.bookingLinks.systemicSources}개 여행사에서 여러 대표 링크가 함께 실패했습니다.`
                : '개별 대표 링크가 예약 화면까지 열리지 않았습니다.',
            nextAction: '최근 실패 링크와 재확인 결과를 확인하세요.',
            tab: 'operations',
        });
    }

    if (input.reports.loadError || !input.reports.available) {
        items.push({
            id: 'reports',
            area: '사용자 신고',
            state: '신고 상태 확인 불가',
            cause: '현재 신고·숨김 현황 응답을 사용할 수 없습니다.',
            nextAction: '항공권·수집 탭에서 오류 안내를 확인하세요.',
            tab: 'operations',
        });
    } else if (input.reports.needsReview > 0) {
        items.push({
            id: 'reports',
            area: '사용자 신고',
            state: `${input.reports.needsReview}개 확인 필요`,
            cause: `신고 기준을 넘어 현재 ${input.reports.activeHides}개 항공권이 숨김 상태입니다.`,
            nextAction: '신고 근거를 보고 계속 숨김 또는 다시 표시를 결정하세요.',
            tab: 'operations',
        });
    }

    if (input.alerts.loadError || input.alerts.unavailable) {
        items.push({
            id: 'alert-review-load',
            area: '알림 후보',
            state: '후보 상태 확인 불가',
            cause: input.alerts.loadError
                ? '현재 알림 후보 응답을 불러오지 못했습니다.'
                : '현재 알림 후보 저장소 또는 발송 준비 상태를 사용할 수 없습니다.',
            nextAction: '고객·알림 탭에서 오류 안내를 확인하세요.',
            tab: 'audience',
        });
    } else if (input.alerts.available && input.alerts.qualifiedCandidates > 0) {
        items.push({
            id: 'alert-candidates',
            area: '알림 후보',
            state: `${input.alerts.qualifiedCandidates}개 승인 대기`,
            cause: `${input.alerts.pendingRecipients}명에게 보낼 수 있는 품질 기준 통과 후보가 있습니다.`,
            nextAction: input.alerts.deliveryAvailable
                ? '가격·일정·문구를 확인한 뒤 발송 여부를 결정하세요.'
                : '발송 연결 상태를 확인한 뒤 후보를 검토하세요.',
            tab: 'audience',
        });
    }

    return items;
}
