'use client';

import { useState, useEffect } from 'react';
import styles from './admin.module.css';
import { isAnalyticsExcluded, setAnalyticsExcluded } from '@/lib/analytics';
import { buildAdminAttentionItems } from '@/lib/admin-attention';

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from(rawData, character => character.charCodeAt(0));
}

function compactCircuitCause(circuit?: { reason: 'blocked' | 'rate_limited'; detail: string }): string {
    if (!circuit) return '원인 확인 중';
    if (circuit.reason === 'rate_limited') return '요청 제한';
    if (/captcha/i.test(circuit.detail)) return 'CAPTCHA';
    if (/접근 제한 안내/.test(circuit.detail)) return '접근 제한 안내';
    if (/403/.test(circuit.detail)) return 'HTTP 403';
    if (/aborted|요청 실패|요청 중단/i.test(circuit.detail)) return '요청 중단';
    return '접근 차단';
}

interface CrawlHistoryEntry {
    timestamp: string;
    sites: Record<string, { total: number; scraped?: number; preserved?: boolean; skipped?: boolean; manual?: boolean; added?: number; removed?: number }>;
    alerts: string[];
}

interface BookingLinkProbe {
    source: string;
    flightId: string;
    route: string;
    departureDate: string;
    checkedAt: string;
    stage: 'initial' | 'retry' | 'confirmation';
    outcome?: 'passed' | 'failed' | 'unavailable';
    success: boolean;
    statusCode: number | null;
    finalUrl: string;
    reason: string | null;
    durationMs: number;
    verificationMethod?: 'browser_navigation' | 'crawl_evidence';
    evidenceAt?: string | null;
}

interface BookingLinkHealthEntry {
    date: string;
    checkedAt: string;
    summary: {
        scheduled: number;
        passed: number;
        failed: number;
        unavailable?: number;
        recovered: number;
        systemicSources: number;
        checkedSources: number;
    };
    sources: Array<{
        source: string;
        status: 'healthy' | 'recovered' | 'isolated_failure' | 'systemic_suspected' | 'evidence_unavailable' | 'not_checked';
        availableFlights: number;
        checks: BookingLinkProbe[];
    }>;
}

interface AdminData {
    timestamp: string;
    totalFlights: number;
    bySource: Record<string, number>;
    byRegion: Record<string, number>;
    byCity: Record<string, number>;
    byAirline: Record<string, number>;
    byDepartureCity: Record<string, number>;
    avgPriceBySource: Record<string, number>;
    priceByRegion: Record<string, { min: number; max: number; avg: number; count: number }>;
    cheapest: { route: string; airline: string; price: number; date: string; source: string }[];
    crawlHistory?: CrawlHistoryEntry[];
    /** 전체 크롤 예약 회차와 마지막 완료 시각을 비교한 자동화 상태. */
    crawlScheduleHealth?: {
        status: 'healthy' | 'waiting' | 'late' | 'overdue';
        expectedAt: string | null;
        expectedCron: string | null;
        lastCompletedAt: string | null;
        delayMinutes: number;
        pendingSlots: number;
        warningMinutes: number;
        fallbackMinutes: number;
    };
    /** 여행사별 마지막 성공 갱신 시각. 무결성 가드가 새 결과를 폐기하면 여기서 멈춘다. */
    sourceUpdatedAt?: Record<string, string>;
    /** 여행사별 연속 실패 횟수. 0이 아니면 그만큼 이전 데이터로 버티고 있다는 뜻이다. */
    staleStreak?: Record<string, number>;
    /** 접근 거부·요청 제한 뒤 해당 여행사에 자동 요청을 쉬고 있는 상태. */
    sourceCircuits?: Record<string, {
        reason: 'blocked' | 'rate_limited';
        openedAt: string;
        nextProbeAt: string;
        resumePolicy: 'cooldown_or_adapter_change';
        adapterVersion: string;
        status?: number;
        detail: string;
        localFallback?: {
            status: 'success' | 'blocked' | 'failed';
            lastAttemptAt: string;
            nextProbeAt?: string;
            detail: string;
        };
    }>;
    manualCaptureStatus?: Record<string, {
        capturedAt: string;
        lastImportedAt: string;
        accepted: number;
        review: number;
        filtered: number;
        completeRegions?: string[];
        emptyRegions?: string[];
        excludedRegions?: string[];
        naverPending?: boolean;
        naverDeferred?: number;
    }>;
    naverStatus?: {
        lastCrawledAt: string | null;
        lastAttemptAt: string | null;
        ageDays: number | null;
        freshEntries: number;
        pricedEntries: number;
        expiredEntries: number;
        failedEntries: number;
        neverCheckedEntries: number;
        totalEntries: number;
    } | null;
    naverCrawlHistory?: Array<{
        id: string;
        timestamp: string;
        startedAt?: string;
        durationSeconds?: number;
        runner: 'local' | 'github' | 'manual';
        sourceFilter: string;
        maxFlights: number;
        navigationLimit?: number;
        needed: number;
        attempted: number;
        navigations?: number;
        skippedFresh?: number;
        newRoutes: number;
        newRoutesAttempted: number;
        changedRoutes?: number;
        periodicRoutes?: number;
        reasonCounts?: Record<string, number>;
        priorityGroups?: Record<string, number>;
        selectedPriorityGroups?: Record<string, number>;
        deferred: number;
        deferredNeverChecked: number;
        oldestDeferredHours: number | null;
        success: number;
        misses: number;
        noResult?: number;
        routeErrors?: number;
        transientErrors?: number;
        blocked?: number;
        healthChecks?: number;
        abortedEarly: boolean;
        abortReason?: string;
    }>;
    bookingLinkHealth?: {
        version: number;
        updatedAt: string;
        entries: BookingLinkHealthEntry[];
    } | null;
}

interface DealAlertCandidate {
    flightId: string;
    departureCity: string;
    arrivalCity: string;
    departureDate: string;
    returnDate: string;
    airline: string;
    source: string;
    price: number;
    effectivePrice: number;
    feeNote?: string;
    score: number;
    reasons: string[];
}

interface AlertApprovalBatch {
    batchKey: string;
    kind: 'route' | 'deal';
    title: string;
    body: string;
    url: string;
    flightId: string;
    departureCity: string;
    arrivalCity: string;
    departureDate: string;
    returnDate: string;
    airline: string;
    source: string;
    effectivePrice: number;
    score: number;
    reasons: string[];
    selectionRank: number;
    recipientCount: number;
    recipientConditions: Array<{
        kind: 'route' | 'deal';
        departureCity: string;
        destination: string;
        maxPrice: number;
        departureDateFrom?: string;
        departureDateTo?: string;
        selectionRank: number;
        recipientCount: number;
    }>;
}

interface AlertApprovalGroup {
    groupKey: string;
    recipientConditions: AlertApprovalBatch['recipientConditions'];
    recipientCount: number;
    batches: AlertApprovalBatch[];
}

interface AlertPreviewStatus {
    state: 'working' | 'success' | 'error';
    message: string;
}

function groupAlertApprovalBatches(batches: AlertApprovalBatch[]): AlertApprovalGroup[] {
    const grouped = new Map<string, AlertApprovalGroup>();
    for (const batch of batches) {
        const conditionKey = batch.recipientConditions
            .map(condition => [
                condition.kind,
                condition.departureCity,
                condition.destination,
                condition.maxPrice,
                condition.departureDateFrom || '',
                condition.departureDateTo || '',
            ].join('|'))
            .sort()
            .join('::');
        const existing = grouped.get(conditionKey);
        if (existing) {
            existing.batches.push(batch);
            existing.recipientCount = Math.max(existing.recipientCount, batch.recipientCount);
        } else {
            grouped.set(conditionKey, {
                groupKey: conditionKey || batch.batchKey,
                recipientConditions: batch.recipientConditions,
                recipientCount: batch.recipientCount,
                batches: [batch],
            });
        }
    }
    return Array.from(grouped.values()).map(group => ({
        ...group,
        batches: group.batches.sort((a, b) => a.selectionRank - b.selectionRank || b.score - a.score),
    }));
}

function alertConditionDateLabel(condition: AlertApprovalBatch['recipientConditions'][number]): string {
    if (condition.departureDateFrom && condition.departureDateTo) {
        return `${condition.departureDateFrom} ~ ${condition.departureDateTo}`;
    }
    if (condition.departureDateFrom) return `${condition.departureDateFrom} 이후`;
    if (condition.departureDateTo) return `${condition.departureDateTo} 이전`;
    return '날짜 제한 없음';
}

interface DealAlertReviewData {
    available: boolean;
    approvalMode: 'manual';
    deliveryAvailable: boolean;
    message?: string;
    generatedAt: string;
    scoreThreshold: number;
    subscriptions: number;
    qualifiedCandidates: number;
    pendingRecipients: number;
    approvalBatches: AlertApprovalBatch[];
    reviews: Array<{
        condition: {
            id: string;
            departureCity: string;
            region: string;
            maxPrice: number;
        };
        matchingFlights: number;
        qualifiedCount: number;
        candidates: DealAlertCandidate[];
        rejectionCounts: Record<string, number>;
    }>;
}

interface UserStatsData {
    available: boolean;
    message?: string;
    generatedAt: string;
    summary: {
        subscribers: number;
        everSubscribed: number;
        activeAlerts: number;
        cancelledAlerts: number;
        alertsPerSubscriber: number;
        routeAlerts: number;
        dealAlerts: number;
        notified: number;
        neverNotified: number;
        reachableNow: number;
        registrationsToday: number;
        alertUsersToday: number;
        registrationsLast7Days: number;
        registrationsLast30Days: number;
        accountAvailable: boolean;
        accounts: number;
        accountsToday: number;
        accountsLast7Days: number;
        accountsLast30Days: number;
        activeSessions: number;
        favorites: number;
        favoritesToday: number;
        recentFlights: number;
        savedSearches: number;
        savedSearchesToday: number;
        saversToday: number;
    };
    topRoutes: Array<{
        route: string;
        count: number;
        devices: number;
        avgTarget: number | null;
        currentLowest: number | null;
        reachable: boolean | null;
        gap: number | null;
    }>;
    topRegions: Array<{ label: string; count: number; devices: number; avgTarget: number | null }>;
    trend: Array<{ date: string; count: number }>;
}

interface FlightFilterSummary {
    collected: number;
    visible: number;
    excluded: number;
    reasons: {
        staleMyrealtrip: number;
        staleOtherSources: number;
        reported: number;
        duplicate: number;
        naverExpensive: number;
        expired: number;
        oneWay: number;
    };
    visibleBySource: Record<string, number>;
    visibleByRegion: Record<string, number>;
    visibleByCity: Record<string, number>;
    visibleByDepartureCity: Record<string, number>;
    visibleByAirline: Record<string, number>;
    quality: {
        missingTimes: number;
        missingSeats: number;
        missingBookingLink: number;
        missingExactAirports: number;
        freshNaverComparison: number;
    };
    lowestVisible: Array<{
        id: string;
        route: string;
        airline: string;
        price: number;
        date: string;
        source: string;
    }>;
}

interface FlightReportAdminData {
    available: boolean;
    message?: string;
    generatedAt?: string;
    summary?: {
        recentReports: number;
        reportsToday: number;
        reportsLast7Days: number;
        reportsLast30Days: number;
        activeHides: number;
        needsReview: number;
    };
    reports: Array<{
        id: number;
        flight_id: string;
        source: string;
        report_type: 'price_changed' | 'unavailable';
        status: string;
        departure_city: string;
        arrival_city: string;
        departure_date: string;
        arrival_date: string;
        airline: string | null;
        displayed_price: number;
        created_at: string;
        result: Record<string, unknown> | null;
    }>;
    hides: Array<{
        flight_id: string;
        source: string;
        latest_report_id: number;
        status: 'active' | 'manual' | 'released' | 'expired' | 'resolved';
        report_count: number;
        price_changed_count: number;
        unavailable_count: number;
        hidden_at: string;
        expires_at: string | null;
        released_at: string | null;
        release_reason: string | null;
        updated_at: string;
    }>;
    events: Array<{
        id: number;
        report_id: number;
        flight_id: string;
        source: string;
        event_type: string;
        details: Record<string, unknown>;
        created_at: string;
    }>;
}

interface GaListItem {
    label: string;
    count: number;
}

interface GaHourlyBucket {
    startHour: number;
    endHour: number;
    sessions: number;
}

interface GaHourlySessions {
    timeZone: string;
    timeZoneSource: 'property' | 'kst_fallback';
    bucketHours: number;
    today: GaHourlyBucket[];
    recent7: GaHourlyBucket[];
    current: GaHourlyBucket[];
}

interface GaStatsData {
    available: boolean;
    message?: string;
    generatedAt: string;
    days: number;
    totals: { users: number; pageViews: number; sessions: number };
    periods: {
        today: { users: number; pageViews: number; sessions: number };
        recent7: { users: number; pageViews: number; sessions: number };
        previous7: { users: number; pageViews: number; sessions: number };
        current: { users: number; pageViews: number; sessions: number };
        previous: { users: number; pageViews: number; sessions: number };
    };
    activityPeriods?: {
        today: GaActivityPeriod;
        recent7: GaActivityPeriod;
        current: GaActivityPeriod;
    };
    hourlySessions?: GaHourlySessions;
    todayOverview?: {
        audience: { newUsers: number; returningUsers: number; rate: number | null };
        savedSearchUsers: number;
        topRoutes: GaListItem[] | null;
        channels: Array<{ label: string; sessions: number; users: number }> | null;
        referrals: Array<{ source: string; label: string; sessions: number; users: number }> | null;
    };
    returning: {
        current: { newUsers: number; returningUsers: number; rate: number | null };
        previous: { newUsers: number; returningUsers: number; rate: number | null };
    };
    monitoring: {
        recent7Share: number | null;
        sessionsPerUser: number | null;
        behaviorAvailable: boolean;
        newUsers: {
            users: number;
            detailOpen: number;
            bookingClick: number;
            share: number;
            alertSetup: number;
            detailOpenRate: number | null;
            bookingClickRate: number | null;
            shareRate: number | null;
        };
        returningUsers: GaStatsData['monitoring']['newUsers'];
    };
    trend: Array<{ date: string; users: number; pageViews: number; sessions: number }>;
    events: Array<{ name: string; label: string; count: number; users: number }>;
    otherEvents: Array<{ name: string; label: string; count: number; users: number }>;
    conversion: {
        detailOpenUsers: number;
        detailOpenRate: number | null;
        bookingClickUsers: number;
        bookingClickRate: number | null;
        detailToBookingRate: number | null;
        alertSetupUsers: number;
        alertSetupRate: number | null;
    };
    bookingByAgency: GaListItem[] | null;
    bookingByRoute: GaListItem[] | null;
    alertByEntry: GaListItem[] | null;
    detailByEntry: GaListItem[] | null;
    channels: Array<{ label: string; sessions: number; users: number; note?: string }> | null;
    referrals: Array<{ source: string; label: string; sessions: number; users: number }> | null;
    campaigns: Array<{
        name: string;
        source: string;
        label: string;
        sessions: number;
        users: number;
        bookingClicks: number | null;
    }> | null;
    dateFilter: {
        picks: number;
        emptyPicks: number;
        emptyRate: number | null;
        leadTime: GaListItem[] | null;
        range: GaListItem[] | null;
        method: GaListItem[] | null;
        presets: GaListItem[] | null;
    };
    warnings: string[];
}

interface GaActivityPeriod {
    visitors: number;
    detailOpenUsers: number;
    bookingClickUsers: number;
    alertSetupUsers: number;
    routeAlertSetupUsers: number;
    dealAlertSetupUsers: number;
    shareUsers: number;
    detailOpenRate: number | null;
    bookingClickRate: number | null;
    alertSetupRate: number | null;
    detailToBookingRate: number | null;
}

interface ThreadsAttribution {
    content: string;
    sessions: number;
    users: number;
    detailOpens: number;
    detailUsers: number;
    bookingClicks: number;
    bookingUsers: number;
}

interface ThreadsInsightsData {
    available: boolean;
    message?: string;
    generatedAt: string;
    posts: Array<{
        id: string;
        text: string;
        timestamp: string;
        permalink: string;
        mediaType: string;
        shortcode: string;
        isQuotePost: boolean;
        metrics: {
            views: number;
            likes: number;
            replies: number;
            reposts: number;
            quotes: number;
            shares: number;
        };
        engagementRate: number | null;
        trackingContent: string | null;
        shareCode: string | null;
        attribution: ThreadsAttribution | null;
        attributionShared: boolean;
    }>;
    attribution: {
        available: boolean;
        message?: string;
        rows: ThreadsAttribution[];
        totals: Omit<ThreadsAttribution, 'content'>;
        verifiedTotals: Omit<ThreadsAttribution, 'content'>;
    };
}

const SOURCE_NAMES: Record<string, string> = {
    hanatour: '하나투어',
    modetour: '모두투어',
    ttang: '땡처리닷컴',
    ybtour: '노랑풍선',
    onlinetour: '온라인투어',
    myrealtrip: '마이리얼트립',
};

const SOURCE_COLORS: Record<string, string> = {
    hanatour: '#7c3aed',
    modetour: '#059669',
    ttang: '#dc2626',
    ybtour: '#d97706',
    onlinetour: '#1e40af',
    myrealtrip: '#2563eb',
};
const SOURCE_ORDER = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip'] as const;
const NAVER_PRIORITY_LABELS: Record<string, string> = {
    deadline: '7일 마감',
    changed_top: '신규·변경 상위',
    top: '추천 상위',
    standard: '보통',
    low: '추천 하위',
};

/**
 * 어드민 탭.
 *
 * 초보 운영자가 "지금 뭘 봐야 하지?"에서 시작해 필요한 세부 화면으로 내려가도록 나눈다.
 */
const TABS = [
    { id: 'overview', label: '오늘', hint: '지금 볼 것' },
    { id: 'threads', label: 'Threads', hint: '글·유입·예약' },
    { id: 'visitors', label: '방문·예약', hint: '유입·행동·관심' },
    { id: 'operations', label: '항공권·수집', hint: '품질·변화·갱신' },
    { id: 'audience', label: '고객·알림', hint: '가입·수요·발송' },
] as const;

type VisibleTabId = typeof TABS[number]['id'];
type LegacyTabId = 'collection' | 'flights' | 'members' | 'alerts';
type TabId = VisibleTabId | LegacyTabId;

const TAB_STORAGE = 'tikitikit_admin_tab';

/** 마지막 갱신이 이 시간을 넘기면 지연으로 본다. 마이리얼트립은 별도 워크플로우가 하루 두 번만 돈다. */
const STALE_AFTER_HOURS: Record<string, number> = { myrealtrip: 20 };
const DEFAULT_STALE_AFTER_HOURS = 8;

const DEAL_REJECTION_LABELS: Record<string, string> = {
    otherDeparture: '출발지가 다름',
    otherRegion: '지역이 다름',
    overBudget: '예산보다 비쌈',
    expired: '출발일이 지남',
    stale: '가격이 3일 넘게 미확인',
    weakPrice: '가격이 좋다는 근거 부족',
    lowScore: '특가라기엔 점수 부족',
};

function formatKST(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}분 전`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}시간 전`;
    return `${Math.floor(hrs / 24)}일 전`;
}

function formatDuration(seconds?: number): string {
    if (!Number.isFinite(seconds) || Number(seconds) < 0) return '기록 없음';
    const totalMinutes = Math.round(Number(seconds) / 60);
    if (totalMinutes < 1) return `${Math.round(Number(seconds))}초`;
    if (totalMinutes < 60) return `${totalMinutes}분`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
}

function formatPrice(price: number): string {
    return `${price.toLocaleString('ko-KR')}원`;
}

function comparisonText(current: number, previous: number, unit = '명'): string {
    if (previous === 0) {
        return current === 0 ? '직전 기간과 같아요' : `직전 기간 0${unit} → ${current.toLocaleString()}${unit}`;
    }
    const change = Math.round(((current - previous) / previous) * 100);
    if (change === 0) return '직전 기간과 같아요';
    return `직전 기간보다 ${Math.abs(change).toLocaleString()}% ${change > 0 ? '늘었어요' : '줄었어요'}`;
}

function reportStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        pending: '신고 기록됨',
        processing: '수동 확인 중',
        confirmed: '정보 일치',
        updated: '정보 갱신',
        removed: '판매 종료',
        check_failed: '확인 실패',
    };
    return labels[status] || status;
}

/**
 * 어드민 키를 브라우저에 남겨 새로고침마다 다시 입력하지 않게 한다.
 *
 * 이 키는 이미 모든 어드민 API 호출에 `?key=`로 실려 URL에 노출되므로,
 * localStorage 보관이 기존 방식보다 노출을 늘리지 않는다. 대신 키가 바뀌거나
 * 인증에 실패하면 즉시 지우고, 공용 PC를 위해 로그아웃 버튼을 둔다.
 */
const ADMIN_KEY_STORAGE = 'tikitikit_admin_key';

const readSavedKey = (): string => {
    if (typeof window === 'undefined') return '';
    try { return window.localStorage.getItem(ADMIN_KEY_STORAGE) || ''; } catch { return ''; }
};

const saveKey = (value: string) => {
    try { window.localStorage.setItem(ADMIN_KEY_STORAGE, value); } catch { /* 저장 불가여도 이번 세션은 정상 동작 */ }
};

const clearSavedKey = () => {
    try { window.localStorage.removeItem(ADMIN_KEY_STORAGE); } catch { /* noop */ }
};

type PeriodRow = {
    label: string;
    today: string | number;
    recent7: string | number;
    recent30: string | number;
    note?: string;
};

function PeriodTable({ rows }: { rows: PeriodRow[] }) {
    return (
        <div className={styles.periodTableWrap}>
            <table className={styles.periodTable}>
                <thead>
                    <tr>
                        <th>무엇을 봤나요?</th>
                        <th>오늘<small>현재까지</small></th>
                        <th>최근 7일<small>어제까지</small></th>
                        <th>최근 30일<small>어제까지</small></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={row.label}>
                            <td>
                                <strong>{row.label}</strong>
                                {row.note && <small>{row.note}</small>}
                            </td>
                            <td>{row.today}</td>
                            <td>{row.recent7}</td>
                            <td>{row.recent30}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function BehaviorSnapshot({ activity }: { activity: NonNullable<GaStatsData['activityPeriods']> }) {
    const periods = [
        { key: 'today', title: '오늘', caption: '현재까지', data: activity.today },
        { key: 'recent7', title: '7일', caption: '어제까지', data: activity.recent7 },
        { key: 'current', title: '30일', caption: '어제까지', data: activity.current },
    ] as const;

    const rate = (value: number | null) => value === null ? '—' : `${value}%`;

    return (
        <div className={styles.behaviorSummary}>
            <div className={styles.behaviorSummaryHead} aria-hidden="true">
                <span>기간</span>
                <span>방문</span>
                <span>상세 열람</span>
                <span>예약 이동</span>
                <span>방문 → 예약</span>
            </div>
            {periods.map(period => (
                <article key={period.key} className={styles.behaviorSummaryRow}>
                    <header>
                        <strong>{period.title}</strong>
                        <small>{period.caption}</small>
                    </header>
                    <div className={styles.behaviorSummaryStage}>
                        <span>방문</span>
                        <strong>{period.data.visitors.toLocaleString()}명</strong>
                        <small>100%</small>
                    </div>
                    <div className={styles.behaviorSummaryStage}>
                        <span>상세 열람</span>
                        <strong>{period.data.detailOpenUsers.toLocaleString()}명</strong>
                        <small>{rate(period.data.detailOpenRate)}</small>
                    </div>
                    <div className={styles.behaviorSummaryStage}>
                        <span>예약 이동</span>
                        <strong>{period.data.bookingClickUsers.toLocaleString()}명</strong>
                        <small>상세 대비 {rate(period.data.detailToBookingRate)}</small>
                    </div>
                    <div className={styles.behaviorSummaryResult}>
                        <span>방문 → 예약</span>
                        <strong>{rate(period.data.bookingClickRate)}</strong>
                    </div>
                </article>
            ))}
            <p className={styles.behaviorFootnote}>
                상세 열람은 방문자 대비, 예약 이동 아래 비율은 상세 열람자 대비입니다.
                마지막 ‘방문 → 예약’이 전체 방문자 중 여행사 예약 페이지까지 이동한 비율입니다.
            </p>
        </div>
    );
}

function VisitorTrendChart({ trend }: { trend: GaStatsData['trend'] }) {
    const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, trend.length - 1));

    useEffect(() => {
        setSelectedIndex(Math.max(0, trend.length - 1));
    }, [trend.length]);

    if (trend.length === 0) return <div className={styles.emptyState}>일별 방문 기록이 아직 없어요.</div>;

    const max = Math.max(...trend.map(point => point.users), 1);
    const selected = trend[Math.min(selectedIndex, trend.length - 1)];
    const tickIndexes = new Set([0, 7, 14, 21, trend.length - 1].filter(index => index < trend.length));
    const shortDate = (date: string) => {
        const [, month, day] = date.split('-').map(Number);
        return `${month}/${day}`;
    };
    const selectedDate = shortDate(selected.date).replace('/', '월 ') + '일';

    return (
        <div className={styles.visitorTrend}>
            <div className={styles.visitorTrendSelected} aria-live="polite">
                <span>{selectedDate}</span>
                <strong>{selected.users.toLocaleString()}명</strong>
                <small>· 재방문 포함 총 {selected.sessions.toLocaleString()}회 접속</small>
            </div>
            <div className={`${styles.trendChart} ${styles.desktopVisitorTrend}`} aria-label="최근 30일 일별 방문자">
                {trend.map((point, index) => (
                    <button
                        key={point.date}
                        type="button"
                        className={index === selectedIndex ? `${styles.trendCol} ${styles.trendColSelected}` : styles.trendCol}
                        onClick={() => setSelectedIndex(index)}
                        aria-label={`${point.date}, 방문자 ${point.users}명`}
                        aria-pressed={index === selectedIndex}
                    >
                        <span className={styles.trendValue}>{point.users.toLocaleString()}명</span>
                        <span className={styles.trendTrack}>
                            <span className={styles.trendBar} style={{ height: `${Math.max(3, (point.users / max) * 100)}%` }} />
                        </span>
                        <span className={styles.trendDate}>{tickIndexes.has(index) ? shortDate(point.date) : ''}</span>
                    </button>
                ))}
            </div>
            <div className={styles.verticalTrend} aria-label="최근 30일 일별 방문자">
                {[...trend].reverse().map(point => (
                    <div key={point.date} className={styles.verticalTrendRow}>
                        <time dateTime={point.date}>{shortDate(point.date)}</time>
                        <div className={styles.verticalTrendTrack} aria-hidden="true">
                            <div
                                className={styles.verticalTrendBar}
                                style={{ width: `${Math.max(2, (point.users / max) * 100)}%` }}
                            />
                        </div>
                        <strong>{point.users.toLocaleString()}명</strong>
                    </div>
                ))}
            </div>
            <p className={styles.trendHint}>방문자는 사람 수, 접속은 같은 사람의 재방문을 포함한 횟수입니다.</p>
        </div>
    );
}

function hourRangeLabel(bucket: GaHourlyBucket) {
    const hour = (value: number) => `${String(value).padStart(2, '0')}:00`;
    return `${hour(bucket.startHour)}–${hour(bucket.endHour)}`;
}

function HourlyTimeZoneBadge({ data }: { data: GaHourlySessions }) {
    const isKst = data.timeZone === 'Asia/Seoul';
    const isFallback = data.timeZoneSource === 'kst_fallback';
    const label = isFallback
        ? '속성 시간대 미수신 · KST 임시 기준'
        : isKst
            ? 'GA4 속성 시간대 · KST (Asia/Seoul)'
            : `GA4 속성 시간대 · ${data.timeZone} (KST 아님)`;

    return (
        <span className={isKst && !isFallback ? styles.hourlyTimeZone : `${styles.hourlyTimeZone} ${styles.hourlyTimeZoneWarn}`}>
            {label}
        </span>
    );
}

function TodayHourlySessions({ data }: { data: GaHourlySessions }) {
    const total = data.today.reduce((sum, bucket) => sum + bucket.sessions, 0);
    const max = Math.max(...data.today.map(bucket => bucket.sessions), 1);
    const peak = total > 0
        ? data.today.reduce((best, bucket) => bucket.sessions > best.sessions ? bucket : best)
        : null;

    return (
        <div className={styles.hourlyPanel}>
            <div className={styles.hourlyPanelHead}>
                <div className={styles.hourlyPeak}>
                    <span>가장 붐빈 시간</span>
                    <strong>{peak ? hourRangeLabel(peak) : '아직 없음'}</strong>
                    <small>{peak ? `${peak.sessions.toLocaleString()}회 · 오늘 전체 ${total.toLocaleString()}회` : '오늘 시작된 접속이 아직 없습니다.'}</small>
                </div>
                <HourlyTimeZoneBadge data={data} />
            </div>
            <div className={styles.hourlyChartScroll}>
                <div className={styles.hourlyChart} role="list" aria-label="오늘 1시간 단위 세션">
                    {data.today.map(bucket => {
                        const isPeak = peak?.startHour === bucket.startHour;
                        return (
                            <div
                                key={bucket.startHour}
                                className={isPeak ? `${styles.hourlyBarColumn} ${styles.hourlyBarColumnPeak}` : styles.hourlyBarColumn}
                                role="listitem"
                                aria-label={`${hourRangeLabel(bucket)}, 접속 ${bucket.sessions}회`}
                                title={`${hourRangeLabel(bucket)} · ${bucket.sessions.toLocaleString()}회`}
                            >
                                <span className={styles.hourlyBarValue}>{bucket.sessions > 0 ? bucket.sessions.toLocaleString() : ''}</span>
                                <span className={styles.hourlyBarTrack} aria-hidden="true">
                                    <span
                                        className={styles.hourlyBar}
                                        style={{ height: bucket.sessions > 0 ? `${Math.max(6, (bucket.sessions / max) * 100)}%` : '0%' }}
                                    />
                                </span>
                                <time className={styles.hourlyBarTime} dateTime={`${String(bucket.startHour).padStart(2, '0')}:00`}>
                                    {bucket.startHour % 3 === 0 ? `${String(bucket.startHour).padStart(2, '0')}시` : ''}
                                </time>
                            </div>
                        );
                    })}
                </div>
            </div>
            <p className={styles.hourlyFootnote}>세션은 해당 시간에 시작된 접속 횟수입니다. 아직 오지 않은 시간은 0으로 표시합니다.</p>
        </div>
    );
}

function HourlySessionsComparison({ data, days }: { data: GaHourlySessions; days: number }) {
    const recent7Total = data.recent7.reduce((sum, bucket) => sum + bucket.sessions, 0);
    const currentTotal = data.current.reduce((sum, bucket) => sum + bucket.sessions, 0);
    const share = (sessions: number, total: number) => total > 0 ? (sessions / total) * 100 : 0;
    const shareLabel = (sessions: number, total: number) => {
        const value = share(sessions, total);
        return `${Number(value.toFixed(1))}%`;
    };
    const peak = (buckets: GaHourlyBucket[], total: number) => total > 0
        ? buckets.reduce((best, bucket) => bucket.sessions > best.sessions ? bucket : best)
        : null;
    const recent7Peak = peak(data.recent7, recent7Total);
    const currentPeak = peak(data.current, currentTotal);
    const maxShare = Math.max(
        ...data.recent7.map(bucket => share(bucket.sessions, recent7Total)),
        ...data.current.map(bucket => share(bucket.sessions, currentTotal)),
        1,
    );

    const PeakCard = ({ label, bucket, total }: { label: string; bucket: GaHourlyBucket | null; total: number }) => (
        <article className={styles.hourlyPeakCard}>
            <span>{label}</span>
            <strong>{bucket ? hourRangeLabel(bucket) : '아직 없음'}</strong>
            <small>{bucket ? `${bucket.sessions.toLocaleString()}회 · 전체의 ${shareLabel(bucket.sessions, total)}` : '집계된 접속이 없습니다.'}</small>
        </article>
    );

    return (
        <div className={styles.hourlyComparePanel}>
            <div className={styles.hourlyCompareTop}>
                <div className={styles.hourlyPeakGrid}>
                    <PeakCard label="최근 7일 피크" bucket={recent7Peak} total={recent7Total} />
                    <PeakCard label={`최근 ${days}일 피크`} bucket={currentPeak} total={currentTotal} />
                </div>
                <HourlyTimeZoneBadge data={data} />
            </div>
            <div className={styles.hourlyCompareScroll}>
                <div className={styles.hourlyCompareChart}>
                    <div className={styles.hourlyCompareHead} aria-hidden="true">
                        <span>시간</span>
                        <span>최근 7일</span>
                        <span>최근 {days}일</span>
                    </div>
                    {data.recent7.map((bucket, index) => {
                        const current = data.current[index] || { ...bucket, sessions: 0 };
                        const recent7Share = share(bucket.sessions, recent7Total);
                        const currentShare = share(current.sessions, currentTotal);
                        return (
                            <div className={styles.hourlyCompareRow} key={bucket.startHour}>
                                <time>{hourRangeLabel(bucket)}</time>
                                <div className={styles.hourlyCompareMetric} aria-label={`최근 7일 ${hourRangeLabel(bucket)}, ${bucket.sessions}회, ${shareLabel(bucket.sessions, recent7Total)}`}>
                                    <span className={styles.hourlyCompareTrack} aria-hidden="true">
                                        <span className={styles.hourlyCompareBarRecent} style={{ width: `${(recent7Share / maxShare) * 100}%` }} />
                                    </span>
                                    <span>{shareLabel(bucket.sessions, recent7Total)} · {bucket.sessions.toLocaleString()}회</span>
                                </div>
                                <div className={styles.hourlyCompareMetric} aria-label={`최근 ${days}일 ${hourRangeLabel(current)}, ${current.sessions}회, ${shareLabel(current.sessions, currentTotal)}`}>
                                    <span className={styles.hourlyCompareTrack} aria-hidden="true">
                                        <span className={styles.hourlyCompareBarCurrent} style={{ width: `${(currentShare / maxShare) * 100}%` }} />
                                    </span>
                                    <span>{shareLabel(current.sessions, currentTotal)} · {current.sessions.toLocaleString()}회</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <p className={styles.hourlyFootnote}>어제까지 끝난 날짜만 3시간씩 묶었습니다. 기간 길이가 달라 막대는 각 기간 전체 세션에서 차지한 비중으로 비교합니다.</p>
        </div>
    );
}

function RankList({
    items,
    empty = '아직 보여줄 데이터가 없어요.',
}: {
    items: Array<{ label: string; value: string; note?: string }>;
    empty?: string;
}) {
    if (items.length === 0) return <div className={styles.emptyState}>{empty}</div>;
    return (
        <div className={styles.rankList}>
            {items.map((item, index) => (
                <div key={`${item.label}-${index}`} className={styles.rankRow}>
                    <span className={styles.rankNumber}>{index + 1}</span>
                    <span className={styles.rankLabel}>{item.label}{item.note && <small>{item.note}</small>}</span>
                    <strong>{item.value}</strong>
                </div>
            ))}
        </div>
    );
}

function TodayBehaviorSummary({
    data,
    sessions,
}: {
    data: NonNullable<GaStatsData['activityPeriods']>['today'];
    sessions: number;
}) {
    const rate = (value: number | null) => value === null ? '—' : `${value}%`;

    return (
        <div className={styles.todayBehaviorSummary}>
            <div className={styles.todayBehaviorFlow}>
                <div className={styles.todayBehaviorStage}>
                    <span>방문</span>
                    <strong>{data.visitors.toLocaleString()}명</strong>
                    <small>재방문 포함 총 {sessions.toLocaleString()}회 접속</small>
                </div>
                <div className={styles.todayBehaviorStage}>
                    <span>상세 열람</span>
                    <strong>{data.detailOpenUsers.toLocaleString()}명</strong>
                    <small>방문 대비 {rate(data.detailOpenRate)}</small>
                </div>
                <div className={styles.todayBehaviorStage}>
                    <span>예약 이동</span>
                    <strong>{data.bookingClickUsers.toLocaleString()}명</strong>
                    <small>상세 대비 {rate(data.detailToBookingRate)}</small>
                </div>
            </div>
            <div className={styles.todayBehaviorResult}>
                <span>방문 → 예약 페이지 이동</span>
                <strong>{rate(data.bookingClickRate)}</strong>
            </div>
        </div>
    );
}

const DONUT_COLORS = ['#ff5b78', '#5267d9', '#27a878', '#f2a33a', '#8b6fc0'];

function DonutBreakdown({ title, items }: { title: string; items: GaListItem[] | null }) {
    if (items === null) {
        return (
            <article className={styles.donutCard}>
                <h3>{title}</h3>
                <div className={styles.emptyState}>불러오지 못했습니다.</div>
            </article>
        );
    }

    const counted = items.filter(item => item.count > 0).sort((a, b) => b.count - a.count);
    if (counted.length === 0) {
        return (
            <article className={styles.donutCard}>
                <h3>{title}</h3>
                <div className={styles.emptyState}>아직 집계된 데이터가 없습니다.</div>
            </article>
        );
    }

    const displayed = counted.length <= 5
        ? counted
        : [
            ...counted.slice(0, 4),
            { label: '기타', count: counted.slice(4).reduce((sum, item) => sum + item.count, 0) },
        ];
    const total = displayed.reduce((sum, item) => sum + item.count, 0);
    let angle = 0;
    const segments = displayed.map((item, index) => {
        const start = angle;
        angle += (item.count / total) * 360;
        return `${DONUT_COLORS[index]} ${start}deg ${angle}deg`;
    });
    const chartLabel = displayed
        .map(item => `${item.label} ${Math.round((item.count / total) * 100)}%`)
        .join(', ');

    return (
        <article className={styles.donutCard}>
            <h3>{title}</h3>
            <div className={styles.donutBody}>
                <div
                    className={styles.donutChart}
                    role="img"
                    aria-label={`${title}: ${chartLabel}`}
                    style={{ background: `conic-gradient(${segments.join(', ')})` }}
                >
                    <div className={styles.donutCenter}>
                        <strong>{total.toLocaleString()}</strong>
                        <span>선택</span>
                    </div>
                </div>
                <ul className={styles.donutLegend}>
                    {displayed.map((item, index) => (
                        <li key={item.label}>
                            <span className={styles.donutSwatch} style={{ backgroundColor: DONUT_COLORS[index] }} />
                            <span>{item.label}</span>
                            <strong>{item.count.toLocaleString()}회</strong>
                            <small>{Math.round((item.count / total) * 100)}%</small>
                        </li>
                    ))}
                </ul>
            </div>
        </article>
    );
}

function SectionNav({ items }: { items: Array<{ href: string; label: string }> }) {
    return (
        <nav className={styles.sectionNav} aria-label="이 화면의 세부 항목">
            {items.map(item => <a key={item.href} href={item.href}>{item.label}</a>)}
        </nav>
    );
}

function koreaDateKey(value: string | number | Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(value));
}

export default function AdminPage() {
    const [data, setData] = useState<AdminData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [key, setKey] = useState('');
    const [authed, setAuthed] = useState(false);
    const [analyticsExcluded, setAnalyticsExcludedState] = useState(false);
    const [dealAlertReview, setDealAlertReview] = useState<DealAlertReviewData | null>(null);
    const [dealAlertReviewError, setDealAlertReviewError] = useState<string | null>(null);
    const [alertApprovalAction, setAlertApprovalAction] = useState<string | null>(null);
    const [alertPreviewAction, setAlertPreviewAction] = useState<string | null>(null);
    const [previewedAlertBatches, setPreviewedAlertBatches] = useState<string[]>([]);
    const [alertPreviewStatuses, setAlertPreviewStatuses] = useState<Record<string, AlertPreviewStatus>>({});
    const [queuedAlertBatches, setQueuedAlertBatches] = useState<string[]>([]);
    const [alertApprovalMessage, setAlertApprovalMessage] = useState<string | null>(null);
    const [userStats, setUserStats] = useState<UserStatsData | null>(null);
    const [userStatsError, setUserStatsError] = useState<string | null>(null);
    const [gaStats, setGaStats] = useState<GaStatsData | null>(null);
    const [gaStatsError, setGaStatsError] = useState<string | null>(null);
    const [threadsInsights, setThreadsInsights] = useState<ThreadsInsightsData | null>(null);
    const [threadsInsightsError, setThreadsInsightsError] = useState<string | null>(null);
    const [flightReports, setFlightReports] = useState<FlightReportAdminData | null>(null);
    const [flightReportsError, setFlightReportsError] = useState<string | null>(null);
    const [flightReportAction, setFlightReportAction] = useState<string | null>(null);
    const [flightFilterSummary, setFlightFilterSummary] = useState<FlightFilterSummary | null>(null);
    const [tab, setTab] = useState<TabId>('overview');
    // 크롤 히스토리 표가 무엇을 세는지: 사이트에 나가는 수(shown)인지 긁어온 원본 수(scraped)인지
    const [crawlMetric, setCrawlMetric] = useState<'shown' | 'scraped' | 'turnover'>('shown');

    useEffect(() => {
        setAnalyticsExcludedState(isAnalyticsExcluded());
        // 새로고침해도 보던 탭에 그대로 머무르게 한다
        try {
            const savedTab = window.localStorage.getItem(TAB_STORAGE);
            const migratedTab = ['health', 'collection', 'reports', 'flights'].includes(savedTab || '')
                ? 'operations'
                : ['users', 'members', 'alerts'].includes(savedTab || '')
                    ? 'audience'
                    : savedTab;
            if (migratedTab && TABS.some(t => t.id === migratedTab)) setTab(migratedTab as TabId);
        } catch { /* 저장소를 못 읽어도 기본 탭으로 동작한다 */ }
        const params = new URLSearchParams(window.location.search);
        // URL의 key가 우선 (공유받은 링크로 들어온 경우), 없으면 지난번에 저장해 둔 키로 자동 로그인
        const urlKey = params.get('key') || readSavedKey();
        if (urlKey) {
            setKey(urlKey);
            setAuthed(true);
            fetchData(urlKey);
        } else {
            setLoading(false);
        }
    }, []);

    async function fetchFlightFilterSummary() {
        try {
            const response = await fetch('/api/flights?summaryOnly=1', { cache: 'no-store' });
            const json = await response.json();
            if (!response.ok || !json.filterSummary) throw new Error('summary unavailable');
            setFlightFilterSummary(json.filterSummary);
        } catch {
            setFlightFilterSummary(null);
        }
    }

    async function fetchData(authKey: string) {
        setLoading(true);
        try {
            const crawlRes = await fetch(`/api/crawl-log?key=${encodeURIComponent(authKey)}`);
            if (crawlRes.status === 401) {
                // 키가 바뀐 뒤 옛 키로 자동 로그인이 반복되지 않도록 지운다
                clearSavedKey();
                setError('인증 실패: 올바른 키를 입력해주세요.');
                setAuthed(false);
                setLoading(false);
                return;
            }
            const json = await crawlRes.json();
            if (json.error) {
                setError(json.error);
                setLoading(false);
                return;
            }
            setData(json);
            await fetchFlightFilterSummary();

            try {
                const dealResponse = await fetch(`/api/deal-alert-candidates?key=${encodeURIComponent(authKey)}`);
                const dealJson = await dealResponse.json();
                if (dealResponse.ok) {
                    setDealAlertReview(dealJson);
                    setDealAlertReviewError(null);
                } else {
                    setDealAlertReviewError(dealJson.error || '조건형 특가 후보를 불러오지 못했습니다.');
                }
            } catch {
                setDealAlertReviewError('조건형 특가 후보를 불러오지 못했습니다.');
            }

            try {
                const statsResponse = await fetch(`/api/user-stats?key=${encodeURIComponent(authKey)}`);
                const statsJson = await statsResponse.json();
                if (statsResponse.ok) {
                    setUserStats(statsJson);
                    setUserStatsError(null);
                } else {
                    setUserStatsError(statsJson.error || '유저 통계를 불러오지 못했습니다.');
                }
            } catch {
                setUserStatsError('유저 통계를 불러오지 못했습니다.');
            }

            try {
                const gaResponse = await fetch(`/api/ga-stats?key=${encodeURIComponent(authKey)}`);
                const gaJson = await gaResponse.json();
                if (gaResponse.ok) {
                    setGaStats(gaJson);
                    setGaStatsError(null);
                } else {
                    setGaStatsError(gaJson.error || '방문 통계를 불러오지 못했습니다.');
                }
            } catch {
                setGaStatsError('방문 통계를 불러오지 못했습니다.');
            }

            try {
                const threadsResponse = await fetch(`/api/threads-insights?key=${encodeURIComponent(authKey)}`);
                const threadsJson = await threadsResponse.json();
                if (threadsResponse.ok) {
                    setThreadsInsights(threadsJson);
                    setThreadsInsightsError(null);
                } else {
                    setThreadsInsightsError(threadsJson.message || threadsJson.error || 'Threads 인사이트를 불러오지 못했습니다.');
                }
            } catch {
                setThreadsInsightsError('Threads 인사이트를 불러오지 못했습니다.');
            }

            try {
                const reportResponse = await fetch(`/api/admin-flight-reports?key=${encodeURIComponent(authKey)}`);
                const reportJson = await reportResponse.json();
                if (reportResponse.ok) {
                    setFlightReports(reportJson);
                    setFlightReportsError(null);
                } else {
                    setFlightReportsError(reportJson.error || '항공권 신고 현황을 불러오지 못했습니다.');
                }
            } catch {
                setFlightReportsError('항공권 신고 현황을 불러오지 못했습니다.');
            }

            setAuthed(true);
            setError(null);
            saveKey(authKey);
            setAnalyticsExcluded(true);
            setAnalyticsExcludedState(true);

        } catch {
            setError('데이터를 불러오는데 실패했습니다.');
        }
        setLoading(false);
    }

    function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        fetchData(key);
    }

    async function approveAlertBatch(batch: AlertApprovalBatch) {
        const approved = window.confirm([
            `${batch.recipientCount.toLocaleString()}명에게 아래 알림을 보낼까요?`,
            '',
            batch.title,
            batch.body,
        ].join('\n'));
        if (!approved) return;

        setAlertApprovalAction(batch.batchKey);
        setAlertApprovalMessage(null);
        try {
            const response = await fetch('/api/deal-alert-candidates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, batchKey: batch.batchKey }),
            });
            const json = await response.json();
            if (!response.ok) throw new Error(json.error || '발송 작업을 시작하지 못했습니다.');
            setQueuedAlertBatches(current => current.includes(batch.batchKey) ? current : [...current, batch.batchKey]);
            setAlertApprovalMessage(`${batch.recipientCount.toLocaleString()}명 대상 알림의 발송 작업을 시작했습니다.`);
        } catch (approvalError) {
            setAlertApprovalMessage(approvalError instanceof Error ? approvalError.message : '발송 작업을 시작하지 못했습니다.');
        } finally {
            setAlertApprovalAction(null);
        }
    }

    async function previewAlertBatch(batch: AlertApprovalBatch) {
        const setPreviewStatus = (status: AlertPreviewStatus) => {
            setAlertPreviewStatuses(current => ({ ...current, [batch.batchKey]: status }));
        };
        if (!dealAlertReview?.deliveryAvailable) {
            setPreviewStatus({
                state: 'error',
                message: '시험 발송 서버 연결이 꺼져 있습니다. GitHub 발송 키 설정을 먼저 확인해야 합니다.',
            });
            return;
        }
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
            setPreviewStatus({ state: 'error', message: '이 브라우저는 웹 알림 시험 발송을 지원하지 않습니다.' });
            return;
        }
        const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidPublicKey) {
            setPreviewStatus({ state: 'error', message: '웹 알림 공개키 설정이 없어 시험 발송을 준비할 수 없습니다.' });
            return;
        }

        setAlertPreviewAction(batch.batchKey);
        setPreviewStatus({ state: 'working', message: '브라우저 알림 권한을 확인하고 있습니다…' });
        try {
            const permission = Notification.permission === 'default'
                ? await Notification.requestPermission()
                : Notification.permission;
            if (permission !== 'granted') throw new Error('브라우저 알림 권한을 허용해야 내 기기로 시험 발송할 수 있습니다.');

            setPreviewStatus({ state: 'working', message: '이 기기의 알림 수신 정보를 준비하고 있습니다…' });
            const registration = await navigator.serviceWorker.register('/sw.js');
            const subscription = await registration.pushManager.getSubscription()
                || await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
                });
            const serialized = subscription.toJSON();
            if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) {
                throw new Error('이 브라우저의 알림 수신 정보를 만들지 못했습니다.');
            }

            setPreviewStatus({ state: 'working', message: '시험 알림을 서버에 요청하고 있습니다…' });
            const response = await fetch('/api/deal-alert-candidates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key,
                    batchKey: batch.batchKey,
                    action: 'test',
                    subscription: {
                        endpoint: serialized.endpoint,
                        keys: serialized.keys,
                    },
                }),
            });
            const json = await response.json();
            if (!response.ok) throw new Error(json.error || '시험 발송 작업을 시작하지 못했습니다.');
            setPreviewedAlertBatches(current => current.includes(batch.batchKey) ? current : [...current, batch.batchKey]);
            setPreviewStatus({
                state: 'success',
                message: '시험 발송 요청이 접수됐습니다. 알림이 도착하면 문구와 링크를 확인해주세요.',
            });
        } catch (previewError) {
            setPreviewStatus({
                state: 'error',
                message: previewError instanceof Error ? previewError.message : '시험 발송 작업을 시작하지 못했습니다.',
            });
        } finally {
            setAlertPreviewAction(null);
        }
    }

    async function updateFlightHide(flightId: string, action: 'keep_hidden' | 'release') {
        const actionKey = `${flightId}:${action}`;
        setFlightReportAction(actionKey);
        try {
            const response = await fetch('/api/admin-flight-reports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, flightId, action }),
            });
            const json = await response.json();
            if (!response.ok) throw new Error(json.error || '상태 변경에 실패했습니다.');
            const refreshResponse = await fetch(`/api/admin-flight-reports?key=${encodeURIComponent(key)}`);
            const refreshJson = await refreshResponse.json();
            if (!refreshResponse.ok) throw new Error(refreshJson.error || '새 상태를 불러오지 못했습니다.');
            setFlightReports(refreshJson);
            setFlightReportsError(null);
            await fetchFlightFilterSummary();
        } catch (actionError) {
            setFlightReportsError(actionError instanceof Error ? actionError.message : '상태 변경에 실패했습니다.');
        } finally {
            setFlightReportAction(null);
        }
    }

    if (!authed && !loading) {
        return (
            <div className={styles.loginContainer}>
                <div className={styles.loginCard}>
                    <h1>🔒 티키티킷 운영실</h1>
                    <p>관리자 키를 입력하세요</p>
                    <form onSubmit={handleLogin}>
                        <input
                            type="password"
                            value={key}
                            onChange={e => setKey(e.target.value)}
                            placeholder="Admin Key"
                            className={styles.loginInput}
                            autoFocus
                        />
                        <button type="submit" className={styles.loginBtn}>접속</button>
                    </form>
                    {error && <p className={styles.errorText}>{error}</p>}
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className={styles.loadingPage} role="status" aria-live="polite" aria-busy="true">
                <header className={styles.loadingHeader} aria-hidden="true">
                    <div>
                        <strong>티키티킷 운영실</strong>
                        <span>최신 운영 데이터를 불러오는 중입니다</span>
                    </div>
                    <span className={styles.loadingHeaderAction} />
                </header>
                <div className={styles.loadingLayout} aria-hidden="true">
                    <nav className={styles.loadingNav} aria-label="관리자 메뉴를 준비하는 중">
                        {['오늘', '방문·예약', '항공권·수집', '고객·알림'].map((label, index) => (
                            <div key={label} className={index === 0 ? `${styles.loadingNavItem} ${styles.loadingNavItemActive}` : styles.loadingNavItem}>
                                <span>{label}</span>
                                <i />
                            </div>
                        ))}
                    </nav>
                    <main className={styles.loadingContent}>
                        <div className={styles.loadingStatus}><span />운영 현황을 정리하고 있어요</div>
                        <section className={styles.loadingSection}>
                            <div className={styles.loadingSectionHead}><i /><i /></div>
                            <div className={styles.loadingCardGrid}>
                                {[0, 1, 2].map(item => <div key={item} className={styles.loadingStatCard}><i /><b /><i /></div>)}
                            </div>
                        </section>
                        <section className={styles.loadingSection}>
                            <div className={styles.loadingSectionHead}><i /><i /></div>
                            <div className={styles.loadingRows}>
                                {[0, 1, 2, 3].map(item => <div key={item}><i /><b /></div>)}
                            </div>
                        </section>
                    </main>
                </div>
                <span className={styles.loadingSrOnly}>관리자 데이터를 불러오는 중입니다.</span>
            </div>
        );
    }

    if (!data) {
        return (
            <div className={styles.container}>
                <h1>티키티킷 운영실</h1>
                <p>{error || '데이터를 불러올 수 없습니다.'}</p>
            </div>
        );
    }

    const allSources = [...SOURCE_ORDER];
    const sortedRegions = Object.entries(flightFilterSummary?.visibleByRegion || data.byRegion).sort((a, b) => b[1] - a[1]);
    const sortedCities = Object.entries(flightFilterSummary?.visibleByCity || data.byCity).sort((a, b) => b[1] - a[1]);
    const sortedAirlines = Object.entries(flightFilterSummary?.visibleByAirline || data.byAirline).sort((a, b) => b[1] - a[1]);
    const sortedDepCities = Object.entries(flightFilterSummary?.visibleByDepartureCity || data.byDepartureCity).sort((a, b) => b[1] - a[1]);
    const exclusionReasons = flightFilterSummary ? [
        { label: '같은 정확한 일정 중 더 싼 표만 남김', count: flightFilterSummary.reasons.duplicate },
        { label: '네이버보다 10만원·20% 이상 비쌈', count: flightFilterSummary.reasons.naverExpensive },
        { label: '신고가 3건 이상 쌓여 임시 숨김', count: flightFilterSummary.reasons.reported },
        { label: '마이리얼트립 가격 확인이 하루 넘게 멈춤', count: flightFilterSummary.reasons.staleMyrealtrip },
        { label: '일반 여행사 가격 확인이 이틀 넘게 멈춤', count: flightFilterSummary.reasons.staleOtherSources },
        { label: '출발일이 지남', count: flightFilterSummary.reasons.expired },
        { label: '출발일과 귀국일이 같음', count: flightFilterSummary.reasons.oneWay },
    ].filter(item => item.count > 0) : [];

    const latestCrawl = data.crawlHistory?.[data.crawlHistory.length - 1];
    const sourceVisibleCounts = Object.fromEntries(allSources.map(source => [
        source,
        flightFilterSummary?.visibleBySource[source]
            ?? latestCrawl?.sites[source]?.total
            ?? data.bySource[source]
            ?? 0,
    ])) as Record<string, number>;
    const criticalAlerts = (latestCrawl?.alerts || []).filter(a => a.startsWith('🚨'));
    const crawlScheduleHealth = data.crawlScheduleHealth;
    const crawlScheduleIssue = crawlScheduleHealth?.status === 'late'
        || crawlScheduleHealth?.status === 'overdue';

    const selectTab = (next: TabId) => {
        setTab(next);
        try { window.localStorage.setItem(TAB_STORAGE, next); } catch { /* noop */ }
    };

    // 한 칸이 보여줄 수를 한 곳에서 고른다. 예전에는 정상 수집된 여행사는 필터 전 수가,
    // 실패해 이전 데이터를 물려받은 여행사는 필터 후 수가 같은 표에 섞여 있었다.
    const metricOf = (stat?: CrawlHistoryEntry['sites'][string]): number | null => {
        if (!stat || stat.skipped) return null;
        if (crawlMetric === 'shown') return stat.total;
        if (crawlMetric === 'turnover') return stat.added ?? null;
        return stat.scraped ?? null;
    };
    const sumMetric = (sites: CrawlHistoryEntry['sites']): number =>
        Object.values(sites).reduce((acc, stat) => acc + (metricOf(stat) ?? 0), 0);

    const sourceWasAttempted = (entry: CrawlHistoryEntry, source: string): boolean => {
        const stat = entry.sites[source];
        if (!stat || stat.skipped || stat.manual) return false;
        // 2026-08-30 이전 일반 회차는 실행하지 않은 마이리얼트립 캐시를 성공처럼 기록했다.
        // 원본 수집량도 실패 표식도 없는 마이리얼트립은 과거 기록에서도 시도로 세지 않는다.
        if (source === 'myrealtrip' && stat.scraped === undefined && !stat.preserved) return false;
        return true;
    };

    const sourceHasHistoryEvent = (entry: CrawlHistoryEntry, source: string): boolean => {
        const stat = entry.sites[source];
        return Boolean(stat && (stat.skipped || stat.manual || sourceWasAttempted(entry, source)));
    };

    const turnoverOf = (entry: CrawlHistoryEntry) => {
        const attemptedSources = allSources.filter(source => sourceWasAttempted(entry, source));
        const stats = attemptedSources.map(source => ({ source, stat: entry.sites[source] }));
        const measured = stats.filter(({ stat }) => stat?.added !== undefined || stat?.removed !== undefined);
        if (measured.length === 0) return null;

        const failedSources = measured
            .filter(({ stat }) => stat?.preserved)
            .map(({ source }) => SOURCE_NAMES[source] || source);
        const missingSources = stats
            .filter(({ stat }) => !stat || stat.skipped || (stat.added === undefined && stat.removed === undefined))
            .map(({ source }) => SOURCE_NAMES[source] || source);
        const reliable = attemptedSources.length > 0 && failedSources.length === 0 && missingSources.length === 0;
        const valid = measured.filter(({ stat }) => !stat?.preserved);
        const added = valid.reduce((sum, { stat }) => sum + (stat?.added || 0), 0);
        const removed = valid.reduce((sum, { stat }) => sum + (stat?.removed || 0), 0);

        return { entry, reliable, failedSources, missingSources, added, removed, changed: added + removed };
    };
    const turnoverHistory = (data.crawlHistory || [])
        .map(turnoverOf)
        .filter((row): row is NonNullable<ReturnType<typeof turnoverOf>> => row !== null);
    const turnoverCoverageDays = turnoverHistory.length > 0
        ? Math.floor(
            (new Date(turnoverHistory[turnoverHistory.length - 1].entry.timestamp).getTime()
                - new Date(turnoverHistory[0].entry.timestamp).getTime()) / 86_400_000,
        )
        : 0;

    const todayKey = koreaDateKey(Date.now());
    const periodStart = (daysAgo: number) => new Date(`${koreaDateKey(Date.now() - daysAgo * 86_400_000)}T00:00:00+09:00`).getTime();
    const crawlPeriod = (daysAgo: number) => (data.crawlHistory || []).filter(entry => {
        const timestamp = new Date(entry.timestamp).getTime();
        return Number.isFinite(timestamp)
            && timestamp >= periodStart(daysAgo)
            && timestamp < periodStart(0);
    });
    const crawlSummary = (entries: CrawlHistoryEntry[]) => {
        const automaticEntries = entries.filter(entry =>
            Object.values(entry.sites).some(site => !site.manual),
        );
        const failed = automaticEntries.filter(entry =>
            entry.alerts.some(alert => alert.startsWith('🚨'))
            || Object.values(entry.sites).some(site => site.preserved && !site.skipped),
        ).length;
        const reliableChanges = automaticEntries
            .map(turnoverOf)
            .filter((row): row is NonNullable<ReturnType<typeof turnoverOf>> => Boolean(row?.reliable));
        return {
            runs: automaticEntries.length,
            failed,
            added: reliableChanges.reduce((sum, row) => sum + row.added, 0),
            removed: reliableChanges.reduce((sum, row) => sum + row.removed, 0),
        };
    };
    const crawlToday = crawlSummary((data.crawlHistory || []).filter(entry => koreaDateKey(entry.timestamp) === todayKey));
    const crawl7 = crawlSummary(crawlPeriod(7));
    const crawl30 = crawlSummary(crawlPeriod(30));
    const crawl30RecordedDays = new Set(crawlPeriod(30).map(entry => koreaDateKey(entry.timestamp))).size;

    const crawlRunRows = (data.crawlHistory || []).map(entry => {
        const attemptedSources = allSources.filter(source => sourceWasAttempted(entry, source));
        if (attemptedSources.length === 0) return null;
        const failedSources = attemptedSources.filter(source => entry.sites[source]?.preserved);
        const critical = entry.alerts.filter(alert => alert.startsWith('🚨'));
        const successCount = Math.max(0, attemptedSources.length - failedSources.length);
        const status: 'success' | 'partial' | 'failed' = failedSources.length === 0 && critical.length === 0
            ? 'success'
            : successCount > 0 ? 'partial' : 'failed';
        const scrapedValues = attemptedSources
            .map(source => entry.sites[source]?.scraped)
            .filter((value): value is number => value !== undefined);
        const scraped = scrapedValues.length > 0
            ? scrapedValues.reduce((sum, value) => sum + value, 0)
            : null;
        const shown = attemptedSources.reduce((sum, source) => sum + (entry.sites[source]?.total || 0), 0);
        const turnover = turnoverOf(entry);
        const kind = attemptedSources.length === 1 && attemptedSources[0] === 'myrealtrip'
            ? 'myrealtrip'
            : 'regular';
        return {
            entry,
            attemptedSources,
            failedSources,
            critical,
            successCount,
            status,
            scraped,
            shown,
            turnover,
            kind,
            label: kind === 'myrealtrip' ? '마이리얼트립' : '일반 5개 여행사',
        };
    }).filter((row): row is NonNullable<typeof row> => row !== null);

    const naverRunRows = (data.naverCrawlHistory || []).map(entry => {
        const successRate = entry.attempted > 0 ? Math.round((entry.success / entry.attempted) * 100) : 0;
        const status: 'success' | 'partial' | 'failed' = !entry.abortedEarly && entry.misses === 0
            ? 'success'
            : entry.success > 0 ? 'partial' : 'failed';
        const errorParts = [
            ['결과 없음', entry.noResult || 0],
            ['노선 오류', entry.routeErrors || 0],
            ['일시 오류', entry.transientErrors || 0],
            ['접근 제한', entry.blocked || 0],
        ].filter(([, count]) => Number(count) > 0) as Array<[string, number]>;
        return {
            entry,
            status,
            successRate,
            errorSummary: errorParts.length > 0
                ? errorParts.map(([label, count]) => `${label} ${count.toLocaleString()}`).join(' · ')
                : '오류 없음',
        };
    });
    const latestRegularCrawlRun = [...crawlRunRows].reverse().find(row => row.kind === 'regular') || null;
    const latestMyrealtripCrawlRun = [...crawlRunRows].reverse().find(row => row.kind === 'myrealtrip') || null;
    const latestNaverRun = naverRunRows[naverRunRows.length - 1] || null;

    const last24Hours = Date.now() - 24 * 60 * 60 * 1000;
    const collectionTimeline = [
        ...crawlRunRows
            .filter(row => new Date(row.entry.timestamp).getTime() >= last24Hours)
            .map(row => {
                const changeText = row.turnover?.reliable
                    ? `신규 ${row.turnover.added.toLocaleString()} · 제외 ${row.turnover.removed.toLocaleString()}`
                    : '변화량 판단 제외';
                return {
                    id: `agency-${row.entry.timestamp}`,
                    timestamp: row.entry.timestamp,
                    title: row.label,
                    status: row.status,
                    summary: `${row.successCount}/${row.attemptedSources.length}곳 반영 · 원본 ${row.scraped?.toLocaleString() ?? '—'} → 노출 ${row.shown.toLocaleString()}`,
                    detail: row.failedSources.length > 0
                        ? `이전 데이터 유지: ${row.failedSources.map(source => SOURCE_NAMES[source] || source).join(', ')} · ${changeText}`
                        : row.critical[0]?.replace(/^🚨\s*/, '') || changeText,
                };
            }),
        ...naverRunRows
            .filter(row => new Date(row.entry.timestamp).getTime() >= last24Hours)
            .map(row => {
                const entry = row.entry;
                const target = entry.sourceFilter === 'all'
                    ? '전체 노선'
                    : `${SOURCE_NAMES[entry.sourceFilter] || entry.sourceFilter} 노선`;
                return {
                    id: `naver-${entry.id}`,
                    timestamp: entry.timestamp,
                    title: '네이버 가격 비교 수집',
                    status: row.status,
                    summary: `${entry.success.toLocaleString()}/${entry.attempted.toLocaleString()}개 성공 (${row.successRate}%) · 이월 ${entry.deferred.toLocaleString()}`,
                    detail: entry.abortedEarly
                        ? `${target} · ${entry.abortReason || '안전장치로 조기 중단'} · ${row.errorSummary}`
                        : `${target} · 페이지 이동 ${(entry.navigations ?? entry.attempted).toLocaleString()}회 · ${row.errorSummary}`,
                };
            }),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 16);
    const bookingLinkEntries = (data.bookingLinkHealth?.entries || []).slice(-30);
    const latestBookingLinkHealth = bookingLinkEntries[bookingLinkEntries.length - 1] || null;
    const bookingLinkSystemicIssue = (latestBookingLinkHealth?.summary.systemicSources || 0) > 0;
    const bookingLinkHasFailure = (latestBookingLinkHealth?.summary.failed || 0) > 0;
    const bookingLinkEvidenceUnavailable = (latestBookingLinkHealth?.summary.unavailable || 0) > 0;
    const bookingLinkChartPeak = Math.max(
        ...bookingLinkEntries.map(entry => entry.summary.passed + entry.summary.failed),
        1,
    );
    const bookingLinkFailureDetails = bookingLinkEntries.flatMap(entry => entry.sources.flatMap(source => {
        if (source.status !== 'isolated_failure' && source.status !== 'systemic_suspected') return [];
        const latestByFlight = new Map<string, BookingLinkProbe>();
        source.checks.forEach(check => latestByFlight.set(check.flightId, check));
        return Array.from(latestByFlight.values())
            .filter(check => !check.success && check.outcome !== 'unavailable')
            .map(check => ({ ...check, date: entry.date, sourceStatus: source.status }));
    })).slice(-12).reverse();
    const sourceIssueCount = allSources.filter(source => {
        const updatedAt = data.sourceUpdatedAt?.[source];
        const ageHours = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) / 3_600_000 : null;
        return (data.staleStreak?.[source] || 0) > 0
            || ageHours === null
            || ageHours > (STALE_AFTER_HOURS[source] ?? DEFAULT_STALE_AFTER_HOURS);
    }).length;
    const naverNeedsAttention = !data.naverStatus
        || !data.naverStatus.lastCrawledAt
        || data.naverStatus.freshEntries === 0;
    const reportsToReview = flightReports?.summary?.needsReview || 0;
    const attentionItems = buildAdminAttentionItems({
        crawlSchedule: crawlScheduleHealth ? {
            issue: crawlScheduleIssue,
            delayMinutes: crawlScheduleHealth.delayMinutes,
            overdue: crawlScheduleHealth.status === 'overdue',
        } : undefined,
        collection: {
            sourceIssueCount,
            criticalAlertCount: criticalAlerts.length,
        },
        comparison: {
            needsAttention: naverNeedsAttention,
            lastCheckedLabel: data.naverStatus?.lastCrawledAt
                ? timeAgo(data.naverStatus.lastCrawledAt)
                : undefined,
        },
        bookingLinks: {
            failed: latestBookingLinkHealth?.summary.failed || 0,
            systemicSources: latestBookingLinkHealth?.summary.systemicSources || 0,
        },
        reports: {
            available: Boolean(flightReports?.available),
            loadError: Boolean(flightReportsError),
            needsReview: reportsToReview,
            activeHides: flightReports?.summary?.activeHides || 0,
        },
        alerts: {
            available: Boolean(dealAlertReview?.available),
            unavailable: Boolean(dealAlertReview && !dealAlertReview.available),
            loadError: Boolean(dealAlertReviewError),
            qualifiedCandidates: dealAlertReview?.qualifiedCandidates || 0,
            pendingRecipients: dealAlertReview?.pendingRecipients || 0,
            deliveryAvailable: Boolean(dealAlertReview?.deliveryAvailable),
        },
    });
    const gaActivity = gaStats?.activityPeriods;
    const gaPeriodRows: PeriodRow[] = gaActivity ? [
        {
            label: '사이트를 방문한 사람',
            today: `${gaActivity.today.visitors.toLocaleString()}명`,
            recent7: `${gaActivity.recent7.visitors.toLocaleString()}명`,
            recent30: `${gaActivity.current.visitors.toLocaleString()}명`,
            note: '같은 사람이 여러 번 와도 한 명으로 셉니다.',
        },
        {
            label: '항공권 상세를 본 사람',
            today: `${gaActivity.today.detailOpenUsers.toLocaleString()}명`,
            recent7: `${gaActivity.recent7.detailOpenUsers.toLocaleString()}명`,
            recent30: `${gaActivity.current.detailOpenUsers.toLocaleString()}명`,
        },
        {
            label: '여행사 예약 버튼을 누른 사람',
            today: `${gaActivity.today.bookingClickUsers.toLocaleString()}명`,
            recent7: `${gaActivity.recent7.bookingClickUsers.toLocaleString()}명`,
            recent30: `${gaActivity.current.bookingClickUsers.toLocaleString()}명`,
        },
        {
            label: '방문 → 예약 페이지 이동률',
            today: gaActivity.today.bookingClickRate === null ? '—' : `${gaActivity.today.bookingClickRate}%`,
            recent7: gaActivity.recent7.bookingClickRate === null ? '—' : `${gaActivity.recent7.bookingClickRate}%`,
            recent30: gaActivity.current.bookingClickRate === null ? '—' : `${gaActivity.current.bookingClickRate}%`,
            note: '전체 방문자 중 여행사 예약 페이지까지 이동한 비율입니다. 가장 먼저 볼 지표입니다.',
        },
        {
            label: '상세 → 예약 페이지 이동률',
            today: gaActivity.today.detailToBookingRate === null ? '—' : `${gaActivity.today.detailToBookingRate}%`,
            recent7: gaActivity.recent7.detailToBookingRate === null ? '—' : `${gaActivity.recent7.detailToBookingRate}%`,
            recent30: gaActivity.current.detailToBookingRate === null ? '—' : `${gaActivity.current.detailToBookingRate}%`,
            note: '상세를 본 사람 중 예약 버튼을 누른 비율입니다. 상세 화면의 설득력을 보는 보조 지표입니다.',
        },
        {
            label: '알림을 등록한 사람',
            today: `${gaActivity.today.alertSetupUsers.toLocaleString()}명`,
            recent7: `${gaActivity.recent7.alertSetupUsers.toLocaleString()}명`,
            recent30: `${gaActivity.current.alertSetupUsers.toLocaleString()}명`,
        },
    ] : [];

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.headerRow}>
                    <h1>티키티킷 운영실</h1>
                    <button
                        type="button"
                        className={styles.logoutBtn}
                        onClick={() => {
                            clearSavedKey();
                            setAuthed(false);
                            setKey('');
                            setData(null);
                            // ?key= 가 남아 있으면 새로고침 때 다시 자동 로그인된다
                            window.history.replaceState(null, '', window.location.pathname);
                        }}
                    >
                        로그아웃
                    </button>
                </div>
                <span className={styles.lastUpdated}>
                    항공권 데이터 기준: {formatKST(data.timestamp)} ({timeAgo(data.timestamp)})
                </span>
            </header>

            {/* 무결성 경보 — 크롤이 반쪽 결과를 폐기하고 이전 데이터로 버티는 중이라는 뜻.
                탭 안에 두면 다른 탭을 보는 동안 놓치므로 탭 바깥 최상단에 고정한다. */}
            {criticalAlerts.length > 0 && latestCrawl && (
                <div className={styles.integrityBanner} role="alert">
                    <strong>항공권 수집을 확인해주세요</strong>
                    <p>
                        아래 문제로 새 수집 결과를 버리고 이전 데이터를 그대로 쓰고 있어요.
                        고칠 때까지 해당 여행사 항공권은 갱신되지 않습니다.
                    </p>
                    <ul>
                        {criticalAlerts.map((alert, i) => <li key={i}>{alert.replace(/^🚨\s*/, '')}</li>)}
                    </ul>
                    <span>{formatKST(latestCrawl.timestamp)} 크롤 기준</span>
                </div>
            )}

            {crawlScheduleIssue && crawlScheduleHealth && (
                <div className={styles.integrityBanner} role="alert">
                    <strong>
                        {crawlScheduleHealth.status === 'overdue'
                            ? '자동 수집 회차가 누락됐어요'
                            : '자동 수집 시작이 늦어지고 있어요'}
                    </strong>
                    <p>
                        {crawlScheduleHealth.expectedAt
                            ? `${formatKST(crawlScheduleHealth.expectedAt).replace(/:\d{2}$/, '')} 예정 회차가 ${crawlScheduleHealth.delayMinutes}분째 반영되지 않았습니다.`
                            : '예정된 전체 수집이 아직 반영되지 않았습니다.'}
                        {' '}
                        {crawlScheduleHealth.status === 'overdue'
                            ? `${crawlScheduleHealth.fallbackMinutes}분 기준을 넘어 자동 복구 확인 대상입니다.`
                            : `${crawlScheduleHealth.fallbackMinutes}분까지 완료되지 않으면 자동 복구를 시도합니다.`}
                    </p>
                    <span>
                        마지막 전체 수집 완료: {crawlScheduleHealth.lastCompletedAt ? formatKST(crawlScheduleHealth.lastCompletedAt).replace(/:\d{2}$/, '') : '기록 없음'}
                        {crawlScheduleHealth.pendingSlots > 1 ? ` · 미반영 회차 ${crawlScheduleHealth.pendingSlots}개` : ''}
                    </span>
                </div>
            )}

            <nav className={styles.tabNav}>
                {TABS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        className={tab === t.id ? `${styles.tabBtn} ${styles.tabBtnActive}` : styles.tabBtn}
                        onClick={() => selectTab(t.id)}
                    >
                        <span className={styles.tabLabel}>
                            {t.label}
                            {t.id === 'operations' && (crawlScheduleIssue || criticalAlerts.length > 0 || sourceIssueCount > 0 || bookingLinkHasFailure) && (
                                <span className={styles.tabDot} title={`점검 필요 ${criticalAlerts.length}건`} />
                            )}
                            {t.id === 'operations' && (flightReports?.summary?.activeHides || 0) > 0 && (
                                <span className={styles.reportTabCount} title="현재 임시 숨김 항공권">
                                    {flightReports?.summary?.activeHides}
                                </span>
                            )}
                            {t.id === 'audience' && (dealAlertReview?.qualifiedCandidates || 0) > 0 && (
                                <span className={styles.reportTabCount} title="승인 대기 알림 후보">
                                    {dealAlertReview?.qualifiedCandidates}
                                </span>
                            )}
                        </span>
                        <span className={styles.tabHint}>{t.hint}</span>
                    </button>
                ))}
            </nav>

            {tab === 'overview' && (<>
                <section className={styles.section} id="overview-actions">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>오늘 처리할 일</h2>
                            <p>문제가 있는 항목만 나타납니다. 누르면 원인과 기록을 볼 수 있어요.</p>
                        </div>
                        <span className={styles.nowBadge}>지금</span>
                    </div>
                    {attentionItems.length === 0 ? (
                        <div className={styles.allClear}>
                            <span aria-hidden="true">✓</span>
                            <div><strong>수집·예약 링크·신고·알림 후보 모두 정상이에요</strong><small>오늘 바로 처리할 운영 항목이 없습니다.</small></div>
                        </div>
                    ) : (
                        <div className={styles.actionGrid}>
                            {attentionItems.map(item => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => selectTab(item.tab)}
                                    className={styles.actionCardWarn}
                                >
                                    <span>{item.area}</span>
                                    <strong>{item.state}</strong>
                                    <small><b>원인 후보</b> · {item.cause}</small>
                                    <small className={styles.actionNext}><b>다음 행동</b> · {item.nextAction}</small>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                <section className={styles.section} id="overview-performance">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>오늘 방문 흐름</h2>
                            <p>오늘 들어온 사람이 예약 페이지까지 얼마나 이동했는지 봅니다.</p>
                        </div>
                    </div>
                    {gaStatsError ? (
                        <div className={styles.dealReviewEmpty}>{gaStatsError}</div>
                    ) : gaStats && !gaStats.available ? (
                        <div className={styles.dealReviewEmpty}>{gaStats.message || '방문 통계를 불러오지 못했습니다.'}</div>
                    ) : gaActivity ? (
                        <TodayBehaviorSummary data={gaActivity.today} sessions={gaStats.periods.today.sessions} />
                    ) : (
                        <div className={styles.dealReviewEmpty}>방문 통계를 불러오는 중입니다.</div>
                    )}
                </section>

                <section className={styles.section} id="overview-hourly">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>오늘 시간대별 접속</h2>
                            <p>오늘 세션이 시작된 시간을 1시간 단위로 보여줍니다.</p>
                        </div>
                    </div>
                    {gaStatsError ? (
                        <div className={styles.dealReviewEmpty}>{gaStatsError}</div>
                    ) : !gaStats?.available ? (
                        <div className={styles.dealReviewEmpty}>{gaStats?.message || '시간대별 접속을 불러오는 중입니다.'}</div>
                    ) : gaStats.hourlySessions ? (
                        <TodayHourlySessions data={gaStats.hourlySessions} />
                    ) : (
                        <div className={styles.dealReviewEmpty}>시간대별 접속을 아직 불러오지 못했습니다.</div>
                    )}
                </section>

                <section className={styles.section} id="overview-people">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>오늘 사람과 저장</h2>
                            <p>가입하거나 표를 저장하고 알림을 적용한 사람을 오늘 기준으로 봅니다.</p>
                        </div>
                    </div>
                    <div className={styles.todaySignalGrid}>
                        <article>
                            <span>가입한 사람</span>
                            <strong>{userStats?.available && userStats.summary.accountAvailable ? `${userStats.summary.accountsToday.toLocaleString()}명` : '—'}</strong>
                            <small>오늘 새 계정을 만든 사람</small>
                        </article>
                        <article>
                            <span>저장한 사람</span>
                            <strong>{userStats?.available && userStats.summary.accountAvailable ? `${userStats.summary.saversToday.toLocaleString()}명` : '—'}</strong>
                            <small>{userStats?.available && userStats.summary.accountAvailable
                                ? `항공권 찜 ${userStats.summary.favoritesToday.toLocaleString()}개 · 검색 조건 ${userStats.summary.savedSearchesToday.toLocaleString()}개`
                                : '저장 기록을 확인하는 중입니다.'}</small>
                        </article>
                        <article>
                            <span>알림을 적용한 사람</span>
                            <strong>{userStats?.available ? `${userStats.summary.alertUsersToday.toLocaleString()}명` : '—'}</strong>
                            <small>{userStats?.available ? `새 알림 조건 ${userStats.summary.registrationsToday.toLocaleString()}개` : '알림 기록을 확인하는 중입니다.'}</small>
                        </article>
                        <article>
                            <span>처음 온 사람</span>
                            <strong>{gaStats?.available && gaStats.todayOverview ? `${gaStats.todayOverview.audience.newUsers.toLocaleString()}명` : '—'}</strong>
                            <small>오늘 첫 방문으로 분류된 사람</small>
                        </article>
                        <article>
                            <span>다시 온 사람</span>
                            <strong>{gaStats?.available && gaStats.todayOverview ? `${gaStats.todayOverview.audience.returningUsers.toLocaleString()}명` : '—'}</strong>
                            <small>오늘 재방문으로 분류된 사람</small>
                        </article>
                    </div>
                </section>

                <section className={styles.section} id="overview-acquisition">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>오늘 어디서 와서 무엇을 봤나</h2>
                            <p>오늘 발생한 방문 경로와 항공권 상세 열람만 표시합니다.</p>
                        </div>
                    </div>
                    <div className={styles.todayInsightGrid}>
                        <article className={styles.todayInsightCard}>
                            <header><strong>들어온 경로</strong><small>방문 횟수</small></header>
                            <RankList
                                items={(gaStats?.todayOverview?.channels || []).slice(0, 5).map(item => ({
                                    label: item.label,
                                    value: `${item.sessions.toLocaleString()}회`,
                                    note: `${item.users.toLocaleString()}명`,
                                }))}
                                empty="오늘 집계된 유입 경로가 없습니다."
                            />
                        </article>
                        <article className={styles.todayInsightCard}>
                            <header><strong>외부 사이트</strong><small>확인된 추천 링크</small></header>
                            <RankList
                                items={(gaStats?.todayOverview?.referrals || []).slice(0, 5).map(item => ({
                                    label: item.label,
                                    value: `${item.sessions.toLocaleString()}회`,
                                    note: `${item.users.toLocaleString()}명`,
                                }))}
                                empty="오늘 외부 사이트에서 들어온 기록이 없습니다."
                            />
                        </article>
                        <article className={styles.todayInsightCard}>
                            <header><strong>많이 누른 노선</strong><small>상세 열람 횟수</small></header>
                            <RankList
                                items={(gaStats?.todayOverview?.topRoutes || []).slice(0, 5).map(item => ({
                                    label: item.label.replace('-', ' → '),
                                    value: `${item.count.toLocaleString()}회`,
                                }))}
                                empty="오늘 아직 항공권 상세 열람이 없습니다."
                            />
                        </article>
                    </div>
                </section>

                <section className={styles.section} id="overview-crawl">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>최근 24시간 수집 기록</h2>
                            <p>여행사 항공권과 네이버 가격 비교 수집을 시간순으로 확인합니다.</p>
                        </div>
                    </div>
                    <div className={styles.crawlSchedule}>
                        <div className={styles.crawlScheduleHead}>
                            <strong>자동 크롤링 시간표</strong>
                            <span>한국시간 KST</span>
                        </div>
                        <div className={styles.crawlScheduleGrid}>
                            <article>
                                <span><em>GitHub</em> 일반 여행사</span>
                                <strong>08:17 · 11:12 · 14:23 · 17:31</strong>
                                <small>하루 4회 · 차단된 여행사는 각 회차 반영 뒤 PC에서 대체 수집</small>
                            </article>
                            <article>
                                <span><em>GitHub</em> 마이리얼트립</span>
                                <strong>07:05 · 18:03</strong>
                                <small>하루 2회 · 실제 예약 화면의 가격과 출·도착 시간 갱신</small>
                            </article>
                            <article>
                                <span><em>내 PC</em> 네이버 가격 비교</span>
                                <strong>11:12 1차 · 14:23 보완 · 17:31 수동 보완</strong>
                                <small>17:31은 14:23 미기동 안전망 + 늦게 반영된 모두투어 수동 캡처 확인 · 하루 합계 최대 200회</small>
                            </article>
                        </div>
                    </div>
                    {collectionTimeline.length === 0 ? (
                        <div className={styles.emptyState}>최근 24시간 수집 기록이 없습니다.</div>
                    ) : (
                        <div className={styles.collectionTimeline}>
                            {collectionTimeline.map(item => (
                                <article key={item.id} className={styles.collectionTimelineRow}>
                                    <time dateTime={item.timestamp}>{formatKST(item.timestamp).replace(/:\d{2}$/, '')}</time>
                                    <span className={`${styles.collectionStatus} ${styles[`collectionStatus_${item.status}`]}`}>
                                        {item.status === 'success' ? '성공' : item.status === 'partial' ? '일부 실패' : '실패'}
                                    </span>
                                    <div>
                                        <strong>{item.title}</strong>
                                        <small>{item.detail}</small>
                                    </div>
                                    <b>{item.summary}</b>
                                </article>
                            ))}
                        </div>
                    )}
                </section>

            </>)}

            {tab === 'operations' && (<>
                <section className={`${styles.section} ${styles.operationsOrderCurrent}`} id="operations-current">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>현재 항공권 상태</h2>
                            <p>사용자 화면에 실제로 보이는 표와 바로 고쳐야 할 정보 누락입니다.</p>
                        </div>
                        <span className={styles.nowBadge}>지금</span>
                    </div>
                    <div className={styles.compactStats}>
                        <div><span>수집 파일에 있는 표</span><strong>{flightFilterSummary?.collected.toLocaleString() ?? data.totalFlights.toLocaleString()}</strong></div>
                        <div><span>사이트에 보이는 표</span><strong>{flightFilterSummary?.visible.toLocaleString() ?? '—'}</strong></div>
                        <div><span>기준에 따라 제외</span><strong>{flightFilterSummary?.excluded.toLocaleString() ?? '—'}</strong></div>
                    </div>
                    <h3 className={styles.sectionSubTitle}>정보가 비어 있는 항공권</h3>
                    <div className={styles.qualityGrid}>
                        <div className={(flightFilterSummary?.quality.missingTimes || 0) > 0 ? styles.qualityCardNotice : styles.qualityCard}>
                            <span>출·도착 시간 미표기</span><strong>{flightFilterSummary?.quality.missingTimes.toLocaleString() ?? '—'}</strong>
                            <small>카드에서 시간을 보여줄 수 없음</small>
                        </div>
                        <div className={(flightFilterSummary?.quality.missingSeats || 0) > 0 ? styles.qualityCardSoft : styles.qualityCard}>
                            <span>남은 좌석 수 미표기</span><strong>{flightFilterSummary?.quality.missingSeats.toLocaleString() ?? '—'}</strong>
                            <small>여행사가 제공하지 않는 표도 포함</small>
                        </div>
                        <div className={(flightFilterSummary?.quality.missingBookingLink || 0) > 0 ? styles.qualityCardWarn : styles.qualityCard}>
                            <span>예약 링크 없음</span><strong>{flightFilterSummary?.quality.missingBookingLink.toLocaleString() ?? '—'}</strong>
                        </div>
                    </div>
                    {exclusionReasons.length > 0 && (
                        <div className={styles.openDisclosure}>
                            <h3>제외된 항공권 이유</h3>
                            <div className={styles.openDisclosureBody}>
                                <RankList items={exclusionReasons.map(item => ({ label: item.label, value: `${item.count.toLocaleString()}개` }))} />
                            </div>
                        </div>
                    )}
                </section>

                <section className={`${styles.section} ${styles.operationsOrderSources}`} id="operations-sources">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>여행사별 수집 상태</h2>
                            <p>최근 16회의 자동 수집·수동 캡처·건너뜀을 서로 다른 표식으로 보여줍니다.</p>
                        </div>
                    </div>
                    <div className={styles.sourceGraphLegend} aria-label="수집 그래프 범례">
                        <span><i className={styles.sourceLegendAuto} />자동 수집</span>
                        <span><i className={styles.sourceLegendFailed} />수집 실패</span>
                        <span><i className={styles.sourceLegendManual} />수동 캡처 성공</span>
                        <span><i className={styles.sourceLegendSkipped} />건너뜀</span>
                    </div>
                    {crawlScheduleHealth && (
                        <div className={crawlScheduleIssue ? `${styles.naverCompact} ${styles.naverCompactWarn}` : styles.naverCompact}>
                            <div>
                                <strong>전체 자동 수집</strong>
                                <span>
                                    {crawlScheduleHealth.lastCompletedAt
                                        ? `${timeAgo(crawlScheduleHealth.lastCompletedAt)} 완료`
                                        : '완료 기록 없음'}
                                </span>
                            </div>
                            <div>
                                <strong>
                                    {crawlScheduleHealth.status === 'healthy' ? '정상'
                                        : crawlScheduleHealth.status === 'waiting' ? '시작 대기'
                                            : crawlScheduleHealth.status === 'late' ? '지연'
                                                : '보조 실행 대상'}
                                </strong>
                                <span>
                                    {crawlScheduleHealth.expectedAt
                                        ? `${formatKST(crawlScheduleHealth.expectedAt).replace(/:\d{2}$/, '')} 회차`
                                        : '예정 회차 없음'}
                                </span>
                            </div>
                        </div>
                    )}
                    <div className={styles.sourceTrendGrid}>
                        {allSources.map(source => {
                            const updatedAt = data.sourceUpdatedAt?.[source];
                            const ageHours = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) / 3_600_000 : null;
                            const staleCount = data.staleStreak?.[source] || 0;
                            const circuit = data.sourceCircuits?.[source];
                            const circuitOpen = Boolean(
                                circuit && (!circuit.nextProbeAt || new Date(circuit.nextProbeAt).getTime() > Date.now()),
                            );
                            const manualCapture = data.manualCaptureStatus?.[source];
                            const late = ageHours === null || ageHours > (STALE_AFTER_HOURS[source] ?? DEFAULT_STALE_AFTER_HOURS);
                            const visibleCount = sourceVisibleCounts[source] || 0;
                            const loggedHistory = (data.crawlHistory || [])
                                .filter(entry => sourceHasHistoryEvent(entry, source))
                                .map(entry => ({
                                    timestamp: entry.timestamp,
                                    value: entry.sites[source]?.scraped ?? entry.sites[source]?.total ?? 0,
                                    preserved: Boolean(entry.sites[source]?.preserved),
                                    skipped: Boolean(entry.sites[source]?.skipped),
                                    manual: Boolean(entry.sites[source]?.manual),
                                }));
                            const hasCurrentManualLog = source === 'modetour' && Boolean(manualCapture) && loggedHistory.some(entry =>
                                entry.manual
                                && Math.abs(new Date(entry.timestamp).getTime() - new Date(manualCapture!.lastImportedAt).getTime()) < 5 * 60_000,
                            );
                            const history = [
                                ...loggedHistory,
                                ...(source === 'modetour' && manualCapture && !hasCurrentManualLog ? [{
                                    timestamp: manualCapture.lastImportedAt,
                                    value: manualCapture.accepted,
                                    preserved: false,
                                    skipped: false,
                                    manual: true,
                                }] : []),
                            ]
                                .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                                .slice(-16);
                            const latestFailedAt = [...history].reverse().find(entry => entry.preserved && !entry.skipped)?.timestamp;
                            const manualImportedAt = manualCapture
                                ? new Date(manualCapture.lastImportedAt).getTime()
                                : Number.NaN;
                            const failureAt = Math.max(
                                circuit?.openedAt ? new Date(circuit.openedAt).getTime() : 0,
                                latestFailedAt ? new Date(latestFailedAt).getTime() : 0,
                            );
                            const modetourManualApplied = source === 'modetour'
                                && Boolean(manualCapture)
                                && (circuitOpen || staleCount > 0)
                                && Number.isFinite(manualImportedAt)
                                && manualImportedAt >= failureAt;
                            const modetourManualNeeded = source === 'modetour'
                                && (circuitOpen || staleCount > 0)
                                && !modetourManualApplied;
                            const modetourFailureLabel = staleCount > 0 ? `${staleCount}회 실패` : '실패';
                            const pastValues = history
                                .slice(0, -1)
                                .filter(entry => !entry.preserved && !entry.manual && !entry.skipped)
                                .map(entry => entry.value)
                                .sort((a, b) => a - b);
                            const median = pastValues.length ? pastValues[Math.floor(pastValues.length / 2)] : 0;
                            const latestMeasured = [...history].reverse().find(entry => !entry.skipped) || null;
                            const slumped = Boolean(latestMeasured && !latestMeasured.preserved && !latestMeasured.manual && median >= 30 && latestMeasured.value < median * 0.6);
                            const issue = circuitOpen || staleCount > 0 || late || slumped;
                            const peak = Math.max(...history.filter(entry => !entry.skipped).map(entry => entry.value), 1);
                            const statusText = modetourManualApplied
                                ? `${modetourFailureLabel} · 수동 ${manualCapture!.accepted}건 반영${manualCapture!.naverPending ? ' · 네이버 대기' : ''}`
                                : modetourManualNeeded
                                ? `${modetourFailureLabel} · 수동 캡처 필요`
                                : circuitOpen
                                ? circuit!.localFallback?.status === 'success'
                                    ? 'GitHub 휴식·PC 대체 정상'
                                    : circuit!.localFallback?.status === 'blocked'
                                        ? 'GitHub·PC 모두 휴식 중'
                                        : circuit!.reason === 'rate_limited' ? '요청 제한으로 쉬는 중' : '접근 차단으로 쉬는 중'
                                : staleCount > 0
                                ? `이전 데이터 ${staleCount}회`
                                : slumped
                                    ? '평소보다 너무 적음'
                                    : late ? '갱신 늦음' : '정상';
                            return (
                                <article key={source} className={issue ? `${styles.sourceTrendCard} ${styles.sourceTrendCardWarn}` : styles.sourceTrendCard}>
                                    <div className={styles.sourceTrendHead}>
                                        <strong><span className={issue ? styles.sourceStateMarkWarn : styles.sourceStateMarkGood} />{SOURCE_NAMES[source]}</strong>
                                        <span className={issue ? styles.statusWarn : styles.statusGood}>{statusText}</span>
                                    </div>
                                    <div className={styles.sourceTrendSummary}>
                                        <div><strong>{visibleCount.toLocaleString()}</strong><span>사이트 노출</span></div>
                                        <div><strong>{latestMeasured ? latestMeasured.value.toLocaleString() : '—'}</strong><span>최근 실제 수집</span></div>
                                    </div>
                                    <div className={styles.sourceTrendBars} role="img" aria-label={`${SOURCE_NAMES[source]} 최근 ${history.length}회 자동·수동 수집 및 건너뜀 기록`}>
                                        {history.map((entry, index) => {
                                            const isLatest = index === history.length - 1;
                                            return (
                                                <span
                                                    key={`${entry.timestamp}-${index}`}
                                                    className={entry.manual
                                                        ? styles.sourceTrendBarManual
                                                        : entry.skipped
                                                        ? styles.sourceTrendBarSkipped
                                                        : entry.preserved
                                                        ? styles.sourceTrendBarPreserved
                                                        : isLatest && slumped
                                                            ? styles.sourceTrendBarBroken
                                                            : isLatest
                                                                ? styles.sourceTrendBarLatest
                                                                : styles.sourceTrendBar}
                                                    style={{ height: entry.manual ? '24px' : entry.skipped ? '12px' : `${Math.max(5, Math.round((entry.value / peak) * 100))}%` }}
                                                    title={entry.skipped
                                                        ? `${formatKST(entry.timestamp).replace(/\d{4}\. /, '')} · 건너뜀 (차단 휴식, 요청 없음)`
                                                        : `${formatKST(entry.timestamp).replace(/\d{4}\. /, '')} · ${entry.value.toLocaleString()}개${entry.manual ? ' · 수동 캡처 성공' : entry.preserved ? ' · 수집 실패, 이전 데이터 사용' : ' · 자동 수집'}`}
                                                >
                                                    {entry.manual ? '✓' : ''}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    <div className={styles.sourceTrendFoot}>
                                        <span>{history.length > 0 ? `최근 ${history.length}회` : '수집 기록 없음'}</span>
                                        <span>{source === 'modetour' && circuit
                                            ? `원인 ${compactCircuitCause(circuit)}`
                                            : updatedAt ? `${timeAgo(updatedAt)} 갱신` : '정상 갱신 기록 없음'}</span>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                    <div className={naverNeedsAttention ? `${styles.naverCompact} ${styles.naverCompactWarn}` : styles.naverCompact}>
                        <div>
                            <strong>가격 비교 데이터</strong>
                            <span>{data.naverStatus?.lastCrawledAt ? `${timeAgo(data.naverStatus.lastCrawledAt)} 성공` : '24시간 내 성공 기록 없음'}</span>
                        </div>
                        <div>
                            <strong>{data.naverStatus ? `${data.naverStatus.freshEntries.toLocaleString()} / ${data.naverStatus.totalEntries.toLocaleString()}개` : '—'}</strong>
                            <span>24시간 내 사용 가능 / 전체 대기열</span>
                        </div>
                    </div>
                </section>

                <section className={`${styles.section} ${styles.operationsOrderLinks}`} id="operations-booking-links">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>예약 링크 연결 상태</h2>
                            <p>5개 여행사는 대표 예약 화면을 열고, 땡처리닷컴은 차단 요청 없이 최신 정상 크롤 증거와 예약 URL 구조를 확인합니다.</p>
                        </div>
                        <span className={bookingLinkSystemicIssue ? styles.issueBadge : styles.nowBadge}>
                            {!latestBookingLinkHealth
                                ? '첫 점검 전'
                                : bookingLinkSystemicIssue
                                    ? `전체 문제 의심 ${latestBookingLinkHealth.summary.systemicSources}곳`
                                    : bookingLinkHasFailure
                                        ? '일부 링크 확인 필요'
                                        : bookingLinkEvidenceUnavailable
                                            ? '크롤 증거 확인 보류'
                                        : '정상'}
                        </span>
                    </div>
                    {!latestBookingLinkHealth ? (
                        <div className={styles.emptyState}>첫 자동 점검이 끝나면 최근 30일 흐름이 여기에 쌓입니다.</div>
                    ) : (
                        <>
                            <div className={styles.linkHealthSummary}>
                                <div>
                                    <span>마지막 점검</span>
                                    <strong>{formatKST(latestBookingLinkHealth.checkedAt).replace(/:\d{2}$/, '')}</strong>
                                </div>
                                <div>
                                    <span>정상 확인</span>
                                    <strong>{latestBookingLinkHealth.summary.passed.toLocaleString()}개</strong>
                                </div>
                                <div className={latestBookingLinkHealth.summary.failed > 0 ? styles.linkHealthSummaryWarn : undefined}>
                                    <span>검증 실패</span>
                                    <strong>{latestBookingLinkHealth.summary.failed.toLocaleString()}개</strong>
                                </div>
                                <div>
                                    <span>크롤 증거 확인 보류</span>
                                    <strong>{(latestBookingLinkHealth.summary.unavailable || 0).toLocaleString()}개</strong>
                                </div>
                                <div>
                                    <span>재확인 후 정상</span>
                                    <strong>{latestBookingLinkHealth.summary.recovered.toLocaleString()}곳</strong>
                                </div>
                            </div>
                            <div className={styles.linkHealthChart} role="img" aria-label="최근 30일 예약 링크 정상과 실패 흐름">
                                {bookingLinkEntries.map((entry, index) => {
                                    const passHeight = Math.round((entry.summary.passed / bookingLinkChartPeak) * 100);
                                    const failHeight = Math.round((entry.summary.failed / bookingLinkChartPeak) * 100);
                                    const showDate = index === bookingLinkEntries.length - 1 || index % 5 === 0;
                                    return (
                                        <div
                                            key={`${entry.date}-${entry.checkedAt}`}
                                            className={styles.linkHealthDay}
                                            title={`${entry.date} · 정상 ${entry.summary.passed} · 실패 ${entry.summary.failed} · 확인 보류 ${entry.summary.unavailable || 0} · 재확인 후 정상 ${entry.summary.recovered} · 전체 문제 의심 ${entry.summary.systemicSources}곳`}
                                        >
                                            <div className={styles.linkHealthBars}>
                                                {entry.summary.passed > 0 && <span className={styles.linkHealthPass} style={{ height: `${Math.max(4, passHeight)}%` }} />}
                                                {entry.summary.failed > 0 && <span className={styles.linkHealthFail} style={{ height: `${Math.max(4, failHeight)}%` }} />}
                                                {entry.summary.recovered > 0 && <i className={styles.linkHealthRecovered} aria-hidden="true" />}
                                            </div>
                                            <span className={styles.linkHealthDate}>{showDate ? entry.date.slice(5).replace('-', '.') : ''}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className={styles.linkHealthLegend}>
                                <span><i className={styles.linkHealthLegendPass} />정상</span>
                                <span><i className={styles.linkHealthLegendFail} />실패</span>
                                <span><i className={styles.linkHealthLegendRecovered} />재확인 후 정상</span>
                            </div>
                            {bookingLinkFailureDetails.length > 0 && (
                                <div className={styles.linkHealthFailures}>
                                    <h3>최근 확인이 필요한 링크</h3>
                                    {bookingLinkFailureDetails.map((failure, index) => (
                                        <article key={`${failure.date}-${failure.flightId}-${index}`}>
                                            <div>
                                                <strong>{SOURCE_NAMES[failure.source] || failure.source} · {failure.route}</strong>
                                                <span>{failure.departureDate} 출발 · {failure.reason || '예약 화면을 열지 못함'}</span>
                                            </div>
                                            <span className={failure.sourceStatus === 'systemic_suspected' ? styles.statusWarn : styles.statusMuted}>
                                                {failure.sourceStatus === 'systemic_suspected' ? '전체 문제 의심' : '개별 링크 실패'}
                                            </span>
                                            {failure.finalUrl && (
                                                <a href={failure.finalUrl} target="_blank" rel="noopener noreferrer">직접 열기</a>
                                            )}
                                        </article>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </section>

                <section className={`${styles.section} ${styles.operationsOrderMix}`} id="operations-mix">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>지금 어떤 표가 많은가</h2>
                            <p>현재 노출 중인 항공권의 쏠림과 콘텐츠로 살펴볼 만한 표를 봅니다.</p>
                        </div>
                    </div>
                    <div className={styles.analysisGrid}>
                        <div className={styles.analysisPanel}>
                            <h3>지역별 항공권</h3>
                            <RankList items={sortedRegions.slice(0, 6).map(([label, count]) => ({ label, value: `${count.toLocaleString()}개` }))} />
                        </div>
                        <div className={styles.analysisPanel}>
                            <h3>출발 공항</h3>
                            <RankList items={sortedDepCities.slice(0, 6).map(([label, count]) => ({ label, value: `${count.toLocaleString()}개` }))} />
                        </div>
                        <div className={styles.analysisPanel}>
                            <h3>항공권이 많은 도착지</h3>
                            <RankList items={sortedCities.slice(0, 6).map(([label, count]) => ({ label, value: `${count.toLocaleString()}개` }))} />
                        </div>
                        <div className={styles.analysisPanel}>
                            <h3>항공권이 많은 항공사</h3>
                            <RankList items={sortedAirlines.slice(0, 6).map(([label, count]) => ({ label, value: `${count.toLocaleString()}개` }))} />
                        </div>
                    </div>
                </section>

                <section className={`${styles.section} ${styles.operationsOrderReports}`} id="operations-reports">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>사용자 신고</h2>
                            <p>신고가 쌓여 숨긴 표와 사람이 확인해야 하는 표만 봅니다.</p>
                        </div>
                        <span className={(flightReports?.summary?.needsReview || 0) > 0 ? styles.issueBadge : styles.nowBadge}>
                            확인 필요 {flightReports?.summary?.needsReview || 0}
                        </span>
                    </div>
                    {flightReportsError ? (
                        <div className={styles.dealReviewEmpty}>{flightReportsError}</div>
                    ) : !flightReports?.available ? (
                        <div className={styles.dealReviewEmpty}>{flightReports?.message || '신고 정보를 불러오는 중입니다.'}</div>
                    ) : flightReports.hides.length === 0 ? (
                        <div className={styles.allClear}><span aria-hidden="true">✓</span><div><strong>현재 숨긴 항공권이 없어요</strong><small>새 신고가 생기면 이곳에 표시됩니다.</small></div></div>
                    ) : (
                        <div className={styles.reportList}>
                            {flightReports.hides.slice(0, 8).map(hide => {
                                const report = flightReports.reports.find(item => item.id === hide.latest_report_id)
                                    || flightReports.reports.find(item => item.flight_id === hide.flight_id);
                                const active = hide.status === 'active' || hide.status === 'manual';
                                return (
                                    <article key={hide.flight_id} className={styles.reportRow}>
                                        <div>
                                            <strong>{report ? `${report.departure_city} → ${report.arrival_city}` : hide.flight_id}</strong>
                                            <span>{SOURCE_NAMES[hide.source] || hide.source} · 신고 {hide.report_count}건 · {timeAgo(hide.updated_at)}</span>
                                        </div>
                                        <span className={active ? styles.statusWarn : styles.statusGood}>{active ? '숨김 중' : '해제됨'}</span>
                                        {active && (
                                            <div className={styles.reportActions}>
                                                <button type="button" onClick={() => updateFlightHide(hide.flight_id, 'keep_hidden')} disabled={flightReportAction !== null}>계속 숨김</button>
                                                <button type="button" onClick={() => updateFlightHide(hide.flight_id, 'release')} disabled={flightReportAction !== null}>다시 표시</button>
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section className={`${styles.section} ${styles.operationsOrderHistory}`} id="operations-history">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>크롤링 실행 기록</h2>
                            <p>항공권 수집과 네이버 가격 확인은 역할이 달라 각각의 성공 기준과 대기량을 따로 보여줍니다.</p>
                        </div>
                    </div>
                    <div className={styles.crawlLedgerStack}>
                        <article className={styles.crawlLedgerPanel}>
                            <div className={styles.crawlLedgerHead}>
                                <div>
                                    <span className={styles.crawlLedgerEyebrow}>항공권 원본·노출 데이터</span>
                                    <h3>여행사 항공권 수집</h3>
                                    <p>일반 5개 여행사와 마이리얼트립의 실제 수집 결과입니다.</p>
                                </div>
                                <span className={latestRegularCrawlRun?.status === 'success' ? styles.statusGood : styles.statusWarn}>
                                    {!latestRegularCrawlRun ? '기록 없음' : latestRegularCrawlRun.status === 'success' ? '최근 회차 정상' : '최근 회차 확인 필요'}
                                </span>
                            </div>

                            <div className={styles.crawlLedgerSummary}>
                                <div>
                                    <span>일반 5개 여행사</span>
                                    <strong>{latestRegularCrawlRun ? `${latestRegularCrawlRun.successCount}/${latestRegularCrawlRun.attemptedSources.length}곳 반영` : '—'}</strong>
                                    <small>{latestRegularCrawlRun ? `${formatKST(latestRegularCrawlRun.entry.timestamp).replace(/:\d{2}$/, '')} 완료` : '완료 기록 없음'}</small>
                                </div>
                                <div>
                                    <span>최근 원본 → 노출</span>
                                    <strong>{latestRegularCrawlRun ? `${latestRegularCrawlRun.scraped?.toLocaleString() ?? '—'} → ${latestRegularCrawlRun.shown.toLocaleString()}` : '—'}</strong>
                                    <small>필터 전 수집 → 사이트 반영</small>
                                </div>
                                <div>
                                    <span>최근 표 교체</span>
                                    <strong>{latestRegularCrawlRun?.turnover?.reliable
                                        ? `+${latestRegularCrawlRun.turnover.added.toLocaleString()} · −${latestRegularCrawlRun.turnover.removed.toLocaleString()}`
                                        : '판단 제외'}</strong>
                                    <small>신규 · 사라짐</small>
                                </div>
                                <div>
                                    <span>마이리얼트립</span>
                                    <strong>{latestMyrealtripCrawlRun
                                        ? latestMyrealtripCrawlRun.status === 'success' ? `${latestMyrealtripCrawlRun.shown.toLocaleString()}개 반영` : '이전 데이터 유지'
                                        : data.sourceUpdatedAt?.myrealtrip ? `${timeAgo(data.sourceUpdatedAt.myrealtrip)} 갱신` : '별도 기록 대기'}</strong>
                                    <small>{latestMyrealtripCrawlRun
                                        ? `${formatKST(latestMyrealtripCrawlRun.entry.timestamp).replace(/:\d{2}$/, '')} 완료`
                                        : '다음 전용 크롤부터 회차가 분리 기록됩니다.'}</small>
                                </div>
                            </div>

                            <div className={styles.crawlLedgerList}>
                                {crawlRunRows.length === 0 ? (
                                    <div className={styles.emptyState}>아직 여행사 크롤링 기록이 없습니다.</div>
                                ) : [...crawlRunRows].reverse().slice(0, 12).map(row => {
                                    const turnoverText = row.turnover?.reliable
                                        ? `신규 ${row.turnover.added.toLocaleString()} · 사라짐 ${row.turnover.removed.toLocaleString()}`
                                        : '변화량 판단 제외';
                                    const issueText = row.failedSources.length > 0
                                        ? `${row.failedSources.map(source => SOURCE_NAMES[source] || source).join(', ')} 이전 데이터 유지`
                                        : row.critical[0]?.replace(/^🚨\s*/, '') || '정상 반영';
                                    return (
                                        <div key={row.entry.timestamp} className={styles.crawlLedgerRow}>
                                            <time dateTime={row.entry.timestamp}>{formatKST(row.entry.timestamp).replace(/:\d{2}$/, '')}</time>
                                            <span className={`${styles.collectionStatus} ${styles[`collectionStatus_${row.status}`]}`}>
                                                {row.status === 'success' ? '성공' : row.status === 'partial' ? '일부 실패' : '실패'}
                                            </span>
                                            <div className={styles.crawlLedgerMain}>
                                                <strong>{row.label} · {row.successCount}/{row.attemptedSources.length}곳 반영</strong>
                                                <small>{issueText}</small>
                                            </div>
                                            <div className={styles.crawlLedgerNumbers}>
                                                <strong>원본 {row.scraped?.toLocaleString() ?? '—'} → 노출 {row.shown.toLocaleString()}</strong>
                                                <small>{turnoverText}</small>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </article>

                        <article className={styles.crawlLedgerPanel}>
                            <div className={styles.crawlLedgerHead}>
                                <div>
                                    <span className={styles.crawlLedgerEyebrow}>추천·가격 비교 데이터</span>
                                    <h3>네이버 가격 확인</h3>
                                    <p>내 PC가 네이버를 실제로 연 횟수와 성공률, 미처리 대기열을 보여줍니다.</p>
                                </div>
                                <span className={latestNaverRun?.status === 'success' && !naverNeedsAttention ? styles.statusGood : styles.statusWarn}>
                                    {!latestNaverRun ? '기록 없음' : latestNaverRun.status === 'success' && !naverNeedsAttention ? '최근 회차 정상' : '확인 필요'}
                                </span>
                            </div>

                            <div className={styles.crawlLedgerSummary}>
                                <div>
                                    <span>24시간 내 사용 가능</span>
                                    <strong>{data.naverStatus ? `${data.naverStatus.freshEntries.toLocaleString()} / ${data.naverStatus.totalEntries.toLocaleString()}` : '—'}</strong>
                                    <small>추천과 가격 비교에 실제 사용</small>
                                </div>
                                <div>
                                    <span>최근 실행 성공률</span>
                                    <strong>{latestNaverRun ? `${latestNaverRun.entry.success.toLocaleString()}/${latestNaverRun.entry.attempted.toLocaleString()} · ${latestNaverRun.successRate}%` : '—'}</strong>
                                    <small>{latestNaverRun ? `${formatKST(latestNaverRun.entry.timestamp).replace(/:\d{2}$/, '')} 완료` : '완료 기록 없음'}</small>
                                </div>
                                <div>
                                    <span>페이지 이동</span>
                                    <strong>{latestNaverRun
                                        ? `${(latestNaverRun.entry.navigations ?? latestNaverRun.entry.attempted).toLocaleString()} / ${(latestNaverRun.entry.navigationLimit ?? latestNaverRun.entry.maxFlights).toLocaleString()}`
                                        : '—'}</strong>
                                    <small>{latestNaverRun?.entry.durationSeconds !== undefined ? `소요 ${formatDuration(latestNaverRun.entry.durationSeconds)}` : '소요 시간은 다음 실행부터 기록'}</small>
                                </div>
                                <div>
                                    <span>다음 회차로 넘김</span>
                                    <strong>{latestNaverRun ? `${latestNaverRun.entry.deferred.toLocaleString()}개` : '—'}</strong>
                                    <small>{latestNaverRun
                                        ? latestNaverRun.entry.deferredNeverChecked > 0
                                            ? `한 번도 미확인 ${latestNaverRun.entry.deferredNeverChecked.toLocaleString()}개`
                                            : latestNaverRun.entry.oldestDeferredHours === null
                                                ? '밀린 항목 없음'
                                                : `최장 ${latestNaverRun.entry.oldestDeferredHours >= 24 ? `${(latestNaverRun.entry.oldestDeferredHours / 24).toFixed(1)}일` : `${Math.round(latestNaverRun.entry.oldestDeferredHours)}시간`}`
                                        : '대기열 기록 없음'}</small>
                                </div>
                            </div>

                            {data.naverStatus && (
                                <div className={styles.naverCoverageStrip}>
                                    <span><b>{data.naverStatus.pricedEntries.toLocaleString()}</b> 가격 확인 이력</span>
                                    <span><b>{data.naverStatus.expiredEntries.toLocaleString()}</b> 24시간 만료</span>
                                    <span><b>{data.naverStatus.neverCheckedEntries.toLocaleString()}</b> 성공 이력 없음</span>
                                    <span className={data.naverStatus.failedEntries > 0 ? styles.naverCoverageWarn : undefined}>
                                        <b>{data.naverStatus.failedEntries.toLocaleString()}</b> 마지막 시도가 오류
                                    </span>
                                </div>
                            )}

                            {latestNaverRun?.entry.selectedPriorityGroups && (
                                <div className={styles.naverPriorityStrip}>
                                    <strong>최근 선택 구성 ({latestNaverRun.entry.maxFlights.toLocaleString()}건 한도)</strong>
                                    <div>
                                        {Object.entries(latestNaverRun.entry.selectedPriorityGroups).map(([group, count]) => (
                                            <span key={group}>{NAVER_PRIORITY_LABELS[group] || group} <b>{count.toLocaleString()}</b></span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className={styles.crawlLedgerList}>
                                {naverRunRows.length === 0 ? (
                                    <div className={styles.emptyState}>아직 네이버 가격 확인 기록이 없습니다.</div>
                                ) : [...naverRunRows].reverse().slice(0, 12).map(row => {
                                    const entry = row.entry;
                                    const runner = entry.runner === 'local' ? '내 PC' : entry.runner === 'github' ? 'GitHub 진단' : '수동';
                                    const scope = entry.sourceFilter === 'all' ? '전체 여행사' : SOURCE_NAMES[entry.sourceFilter] || entry.sourceFilter;
                                    const queueText = entry.deferredNeverChecked > 0
                                        ? `이월 ${entry.deferred.toLocaleString()} · 미확인 ${entry.deferredNeverChecked.toLocaleString()}`
                                        : `이월 ${entry.deferred.toLocaleString()} · 최장 ${entry.oldestDeferredHours === null ? '없음' : entry.oldestDeferredHours >= 24 ? `${(entry.oldestDeferredHours / 24).toFixed(1)}일` : `${Math.round(entry.oldestDeferredHours)}시간`}`;
                                    return (
                                        <div key={entry.id} className={styles.crawlLedgerRow}>
                                            <time dateTime={entry.timestamp}>{formatKST(entry.timestamp).replace(/:\d{2}$/, '')}</time>
                                            <span className={`${styles.collectionStatus} ${styles[`collectionStatus_${row.status}`]}`}>
                                                {row.status === 'success' ? '성공' : row.status === 'partial' ? '일부 실패' : '실패'}
                                            </span>
                                            <div className={styles.crawlLedgerMain}>
                                                <strong>{runner} · {scope} · {entry.success.toLocaleString()}/{entry.attempted.toLocaleString()} 성공 ({row.successRate}%)</strong>
                                                <small>{entry.abortedEarly ? entry.abortReason || '안전장치로 조기 중단' : row.errorSummary}</small>
                                            </div>
                                            <div className={styles.crawlLedgerNumbers}>
                                                <strong>
                                                    이동 {(entry.navigations ?? entry.attempted).toLocaleString()}회 · 신규 {entry.newRoutesAttempted.toLocaleString()}/{entry.newRoutes.toLocaleString()}
                                                    {entry.changedRoutes !== undefined ? ` · 가격 변경 ${entry.changedRoutes.toLocaleString()}` : ''}
                                                    {entry.periodicRoutes !== undefined ? ` · 정기 ${entry.periodicRoutes.toLocaleString()}` : ''}
                                                </strong>
                                                <small>{queueText}{entry.durationSeconds !== undefined ? ` · ${formatDuration(entry.durationSeconds)}` : ''}</small>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </article>
                    </div>
                </section>
            </>)}

            {tab === 'audience' && (<>
                <section className={styles.section} id="audience-current">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>현재 이용 현황</h2>
                            <p>오늘 생긴 수가 아니라 데이터베이스에 지금 남아 있는 수입니다.</p>
                        </div>
                        <span className={styles.nowBadge}>지금</span>
                    </div>
                    {userStatsError ? (
                        <div className={styles.dealReviewEmpty}>{userStatsError}</div>
                    ) : !userStats?.available ? (
                        <div className={styles.dealReviewEmpty}>{userStats?.message || '고객 정보를 불러오는 중입니다.'}</div>
                    ) : (
                        <div className={styles.compactStats}>
                            <div><span>로그인 계정</span><strong>{userStats.summary.accounts.toLocaleString()}</strong></div>
                            <div><span>유효한 로그인</span><strong>{userStats.summary.activeSessions.toLocaleString()}</strong></div>
                            <div><span>찜한 항공권</span><strong>{userStats.summary.favorites.toLocaleString()}</strong></div>
                            <div><span>저장한 검색 조건</span><strong>{userStats.summary.savedSearches.toLocaleString()}</strong></div>
                            <div><span>알림을 켠 기기</span><strong>{userStats.summary.subscribers.toLocaleString()}</strong></div>
                            <div><span>활성 알림 조건</span><strong>{userStats.summary.activeAlerts.toLocaleString()}</strong></div>
                            <div><span>지금 목표가에 닿은 조건</span><strong>{userStats.summary.reachableNow.toLocaleString()}</strong></div>
                            <div><span>아직 발송 전인 조건</span><strong>{userStats.summary.neverNotified.toLocaleString()}</strong></div>
                        </div>
                    )}
                    <p className={styles.dataGap}>알림이 실제로 도착했는지와 사용자가 열었는지는 아직 기록하지 않습니다.</p>
                </section>

                <section className={styles.section} id="audience-growth">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>새로 생긴 계정과 알림</h2>
                            <p>누적 숫자만 보면 성장을 알기 어려워 기간별 증가분을 따로 봅니다.</p>
                        </div>
                    </div>
                    {userStats?.available ? (
                        <>
                            <PeriodTable rows={[
                                {
                                    label: '새 로그인 계정',
                                    today: `${userStats.summary.accountsToday.toLocaleString()}개`,
                                    recent7: `${userStats.summary.accountsLast7Days.toLocaleString()}개`,
                                    recent30: `${userStats.summary.accountsLast30Days.toLocaleString()}개`,
                                    note: '비밀번호 없이 이메일로 만든 계정입니다.',
                                },
                                {
                                    label: '새 알림 조건',
                                    today: `${userStats.summary.registrationsToday.toLocaleString()}개`,
                                    recent7: `${userStats.summary.registrationsLast7Days.toLocaleString()}개`,
                                    recent30: `${userStats.summary.registrationsLast30Days.toLocaleString()}개`,
                                    note: '나중에 끈 알림도 처음 등록한 날에는 포함합니다.',
                                },
                            ]} />
                            {userStats.trend.length > 0 && (() => {
                                const max = Math.max(...userStats.trend.map(point => point.count), 1);
                                return (
                                    <div className={styles.miniTrendWrap}>
                                        <h3 className={styles.sectionSubTitle}>최근 30일 새 알림</h3>
                                        <div className={styles.trendChart} aria-label="최근 30일 새 알림 조건">
                                            {userStats.trend.map(point => (
                                                <div key={point.date} className={styles.trendCol} title={`${point.date} · ${point.count}개`}>
                                                    <span className={styles.trendCount}>{point.count || ''}</span>
                                                    <div className={styles.trendTrack}>
                                                        <div className={styles.trendBar} style={{ height: `${Math.max(3, (point.count / max) * 100)}%` }} />
                                                    </div>
                                                    <span className={styles.trendDate}>{point.date.slice(5).replace('-', '/')}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}
                        </>
                    ) : (
                        <div className={styles.dealReviewEmpty}>고객 증가 정보를 불러오는 중입니다.</div>
                    )}
                </section>

                <section className={styles.section} id="audience-demand">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>사람들이 기다리는 표</h2>
                            <p>수요가 많은 순서로 5개만 보여드립니다.</p>
                        </div>
                    </div>
                    {userStats?.available ? (
                        <div className={styles.analysisGrid}>
                            <div className={styles.analysisPanel}>
                                <h3>많이 기다리는 노선</h3>
                                <RankList items={userStats.topRoutes.slice(0, 5).map(route => ({
                                    label: route.route,
                                    value: route.reachable === true
                                        ? '희망가 도달'
                                        : route.gap !== null
                                            ? `${formatPrice(route.gap)} 차이`
                                            : `${route.count.toLocaleString()}건`,
                                    note: [
                                        `${route.count.toLocaleString()}건 · ${route.devices.toLocaleString()}대`,
                                        route.avgTarget !== null ? `평균 희망 ${formatPrice(route.avgTarget)}` : null,
                                        route.currentLowest !== null ? `현재 최저 ${formatPrice(route.currentLowest)}` : '현재 항공권 없음',
                                    ].filter(Boolean).join(' · '),
                                }))} empty="등록된 노선 알림이 없어요." />
                            </div>
                            <div className={styles.analysisPanel}>
                                <h3>여행지를 열어둔 알림</h3>
                                <RankList items={userStats.topRegions.slice(0, 5).map(region => ({
                                    label: region.label,
                                    value: `${region.count.toLocaleString()}건`,
                                    note: region.avgTarget !== null ? `평균 희망 ${formatPrice(region.avgTarget)}` : undefined,
                                }))} empty="등록된 조건형 알림이 없어요." />
                            </div>
                        </div>
                    ) : (
                        <div className={styles.dealReviewEmpty}>알림 수요를 불러오는 중입니다.</div>
                    )}
                </section>

                <section className={styles.section} id="audience-candidates">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>승인 대기 알림</h2>
                            <p>아래 내용을 확인하고 승인한 알림만 발송합니다. 크롤링이 끝나도 자동으로 보내지 않습니다.</p>
                        </div>
                        <span className={styles.dryRunBadge}>내 승인 후 발송</span>
                    </div>
                    {dealAlertReviewError ? (
                        <div className={styles.dealReviewEmpty}>{dealAlertReviewError}</div>
                    ) : !dealAlertReview?.available ? (
                        <div className={styles.dealReviewEmpty}>{dealAlertReview?.message || '발송 후보를 불러오는 중입니다.'}</div>
                    ) : (
                        <>
                            <div className={styles.candidateSummary}>
                                <div><span>활성 알림 조건</span><strong>{dealAlertReview.subscriptions.toLocaleString()}개</strong></div>
                                <div><span>승인할 후보</span><strong>{dealAlertReview.qualifiedCandidates.toLocaleString()}개</strong></div>
                                <div><span>받을 사람</span><strong>{dealAlertReview.pendingRecipients.toLocaleString()}명</strong></div>
                            </div>
                            {alertApprovalMessage && <div className={styles.alertApprovalMessage}>{alertApprovalMessage}</div>}
                            {!dealAlertReview.deliveryAvailable && (
                                <div className={styles.alertApprovalWarning}>후보 확인은 가능하지만 GitHub 발송 연결이 없어 승인 버튼은 잠겨 있습니다.</div>
                            )}
                            <div className={styles.openDisclosure}>
                                <h3>실제로 보낼 내용</h3>
                                <div className={`${styles.openDisclosureBody} ${styles.dealReviewList}`}>
                                    {groupAlertApprovalBatches(dealAlertReview.approvalBatches).map(group => (
                                        <article key={group.groupKey} className={styles.alertRequestGroup}>
                                            <div className={styles.alertRequestHeading}>
                                                <div>
                                                    <span>한 번의 알림 요청</span>
                                                    <strong>{group.batches.length.toLocaleString()}개 후보 중 하나를 골라 보내요</strong>
                                                </div>
                                                <b>{group.recipientCount.toLocaleString()}명</b>
                                            </div>
                                            <div className={styles.recipientConditions}>
                                                {group.recipientConditions.map(condition => {
                                                    const dateLabel = alertConditionDateLabel(condition);
                                                    return (
                                                        <div key={`${condition.kind}-${condition.departureCity}-${condition.destination}-${condition.maxPrice}-${dateLabel}`}>
                                                            <strong>{condition.departureCity} 출발 · {condition.destination}</strong>
                                                            <span>{formatPrice(condition.maxPrice)} 이하 · {dateLabel}</span>
                                                            <b>{condition.recipientCount.toLocaleString()}명</b>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className={styles.alertCandidateStack}>
                                                {group.batches.map(batch => {
                                                    const queued = queuedAlertBatches.includes(batch.batchKey);
                                                    const previewed = previewedAlertBatches.includes(batch.batchKey);
                                                    const previewStatus = alertPreviewStatuses[batch.batchKey];
                                                    return (
                                                        <section key={batch.batchKey} className={styles.alertCandidateCard}>
                                                            <div className={styles.dealReviewCondition}>
                                                                <div>
                                                                    <strong>{batch.departureCity} → {batch.arrivalCity}</strong>
                                                                    <span>{batch.departureDate} ~ {batch.returnDate}</span>
                                                                </div>
                                                                <span>{batch.kind === 'route'
                                                                    ? '노선 지정 후보'
                                                                    : `${batch.selectionRank}순위 후보`}</span>
                                                            </div>
                                                            <div className={styles.notificationPreview}>
                                                                <span>받는 사람에게 이렇게 보여요</span>
                                                                <strong>{batch.title}</strong>
                                                                <p>{batch.body}</p>
                                                            </div>
                                                            <div className={styles.alertApprovalMeta}>
                                                                <div>
                                                                    <strong>{batch.recipientCount.toLocaleString()}명에게 발송</strong>
                                                                    <span>{SOURCE_NAMES[batch.source] || batch.source} · {batch.airline} · 품질 {batch.score}점</span>
                                                                    <small>{batch.reasons.join(' · ')}</small>
                                                                </div>
                                                                <div className={styles.alertApprovalActions}>
                                                                    <a href={batch.url} target="_blank" rel="noopener noreferrer">항공권 확인</a>
                                                                    <button
                                                                        type="button"
                                                                        className={styles.alertPreviewButton}
                                                                        onClick={() => previewAlertBatch(batch)}
                                                                        disabled={queued || alertPreviewAction === batch.batchKey}
                                                                    >
                                                                        {alertPreviewAction === batch.batchKey ? '시험 요청 중…' : previewed ? '다시 시험 발송' : '내 기기로 먼저 보내기'}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => approveAlertBatch(batch)}
                                                                        disabled={!dealAlertReview.deliveryAvailable || queued || alertApprovalAction === batch.batchKey}
                                                                    >
                                                                        {queued ? '발송 요청됨' : alertApprovalAction === batch.batchKey ? '요청 중…' : '전체 발송'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            {previewStatus && (
                                                                <div
                                                                    className={`${styles.alertPreviewStatus} ${styles[`alertPreviewStatus_${previewStatus.state}`]}`}
                                                                    role={previewStatus.state === 'error' ? 'alert' : 'status'}
                                                                    aria-live="polite"
                                                                >
                                                                    {previewStatus.message}
                                                                </div>
                                                            )}
                                                        </section>
                                                    );
                                                })}
                                            </div>
                                        </article>
                                    ))}
                                    {dealAlertReview.approvalBatches.length === 0 && (
                                        <div className={styles.dealReviewEmpty}>지금은 품질 기준과 알림 조건을 모두 통과한 후보가 없어요.</div>
                                    )}
                                </div>
                            </div>
                            <div className={styles.openDisclosure}>
                                <h3>제외 이유</h3>
                                <div className={`${styles.openDisclosureBody} ${styles.dealReviewList}`}>
                                    {dealAlertReview.reviews.filter(review => Object.values(review.rejectionCounts).some(count => count > 0)).map(review => {
                                        const rejectedCount = Object.values(review.rejectionCounts).reduce((sum, count) => sum + count, 0);
                                        return (
                                            <article key={review.condition.id} className={styles.dealReviewCard}>
                                                <div className={styles.dealReviewCondition}>
                                                    <div><strong>{review.condition.departureCity} 출발 · {review.condition.region === 'all' ? '아무데나' : review.condition.region === '중국' ? '중화권' : review.condition.region}</strong><span>{formatPrice(review.condition.maxPrice)} 이하</span></div>
                                                    <span>제외 {rejectedCount.toLocaleString()}개</span>
                                                </div>
                                                <div className={styles.dealRejections}>
                                                    {Object.entries(review.rejectionCounts)
                                                        .filter(([, count]) => count > 0)
                                                        .map(([reason, count]) => <span key={reason}>{DEAL_REJECTION_LABELS[reason] || reason} {count.toLocaleString()}</span>)}
                                                </div>
                                            </article>
                                        );
                                    })}
                                    {dealAlertReview.reviews.every(review => Object.values(review.rejectionCounts).every(count => count === 0)) && (
                                        <div className={styles.dealReviewEmpty}>제외된 표가 없어요.</div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </section>
            </>)}

            {tab === 'flights' && (<>
                <div className={styles.tabIntro}>
                    <div>
                        <span className={styles.eyebrow}>항공권 관리</span>
                        <h2>무엇이 보이고, 왜 빠졌는지 확인합니다</h2>
                        <p>현재 노출 상태와 신고받은 항공권, 빠진 정보, 항공권 구성을 한곳에서 봅니다.</p>
                    </div>
                </div>
                <SectionNav items={[
                    { href: '#flight-reports', label: '신고·숨김' },
                    { href: '#flight-visibility', label: '노출 현황' },
                    { href: '#flight-quality', label: '빠진 정보' },
                    { href: '#flight-mix', label: '항공권 구성' },
                ]} />
                <section className={styles.section} id="flight-reports">
                    <h2>신고받은 항공권</h2>
                    <p className={styles.sectionHelp}>
                        신고 한두 건은 기록만 하고, 24시간 안에 서로 다른 익명 기기 3개와 접속망 2곳 이상에서
                        신고한 항공권만 24시간 숨깁니다. 신고 때문에 여행사를 추가 크롤링하지 않습니다.
                    </p>
                    {flightReportsError && <div className={styles.reportError}>{flightReportsError}</div>}
                    {!flightReports?.available ? (
                        <div className={styles.dealReviewEmpty}>
                            {flightReports?.message || '신고 정보를 불러오는 중입니다.'}
                        </div>
                    ) : (<>
                        <PeriodTable rows={[
                            {
                                label: '새로 들어온 신고',
                                today: `${flightReports.summary?.reportsToday || 0}건`,
                                recent7: `${flightReports.summary?.reportsLast7Days || 0}건`,
                                recent30: `${flightReports.summary?.reportsLast30Days || 0}건`,
                                note: '가격이 다르거나 예약이 안 된다는 신고를 합친 수입니다.',
                            },
                        ]} />
                        <div className={styles.summaryCards}>
                            <div className={`${styles.summaryCard} ${(flightReports.summary?.activeHides || 0) > 0 ? styles.alertCard : ''}`}>
                                <span className={styles.summaryLabel}>현재 숨겨진 항공권</span>
                                <span className={styles.summaryValue}>{flightReports.summary?.activeHides || 0}</span>
                                <span className={styles.summarySub}>자동·관리자 숨김을 모두 포함합니다.</span>
                            </div>
                            <div className={styles.summaryCard}>
                                <span className={styles.summaryLabel}>관리자가 확인할 항공권</span>
                                <span className={styles.summaryValue}>{flightReports.summary?.needsReview || 0}</span>
                                <span className={styles.summarySub}>신고 기준을 넘어 24시간 임시 숨김 중입니다.</span>
                            </div>
                        </div>

                        <h3 className={styles.userSubTitle}>지금 확인할 항공권과 지난 처리</h3>
                        {flightReports.hides.length === 0 ? (
                            <div className={styles.dealReviewEmpty}>아직 임시 숨김 처리된 항공권이 없습니다.</div>
                        ) : (
                            <div className={styles.reportCards}>
                                {flightReports.hides.map(hide => {
                                    const active = hide.status === 'manual'
                                        || (hide.status === 'active' && Boolean(hide.expires_at) && new Date(hide.expires_at as string).getTime() > Date.now());
                                    const report = flightReports.reports.find(item => item.id === hide.latest_report_id)
                                        || flightReports.reports.find(item => item.flight_id === hide.flight_id);
                                    return (
                                        <article key={hide.flight_id} className={active ? styles.reportCardActive : styles.reportCard}>
                                            <div className={styles.reportCardHead}>
                                                <div>
                                                    <strong>{report ? `${report.departure_city} → ${report.arrival_city}` : hide.flight_id}</strong>
                                                    <span>{SOURCE_NAMES[hide.source] || hide.source} · 신고 {hide.report_count}건</span>
                                                </div>
                                                <span className={active ? styles.tagWarn : styles.tagMuted}>
                                                    {hide.status === 'manual' ? '관리자가 계속 숨김'
                                                        : active ? '24시간 임시 숨김'
                                                            : hide.status === 'resolved' ? '확인 후 해결'
                                                                : hide.status === 'expired' ? '자동으로 다시 표시'
                                                                    : '다시 표시'}
                                                </span>
                                            </div>
                                            <div className={styles.reportBreakdown}>
                                                <span>가격이 달라요 {hide.price_changed_count}</span>
                                                <span>예약이 안 돼요 {hide.unavailable_count}</span>
                                                <span>숨긴 시각 {formatKST(hide.hidden_at)}</span>
                                                {active && hide.expires_at && <span>자동 복구 {formatKST(hide.expires_at)}</span>}
                                            </div>
                                            {active && (
                                                <div className={styles.reportActions}>
                                                    {hide.status !== 'manual' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => updateFlightHide(hide.flight_id, 'keep_hidden')}
                                                            disabled={flightReportAction !== null}
                                                        >
                                                            {flightReportAction === `${hide.flight_id}:keep_hidden` ? '처리 중…' : '계속 숨김'}
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className={styles.reportReleaseBtn}
                                                        onClick={() => updateFlightHide(hide.flight_id, 'release')}
                                                        disabled={flightReportAction !== null}
                                                    >
                                                        {flightReportAction === `${hide.flight_id}:release` ? '처리 중…' : '다시 표시'}
                                                    </button>
                                                </div>
                                            )}
                                        </article>
                                    );
                                })}
                            </div>
                        )}

                        <h3 className={styles.userSubTitle}>최근 신고 내역</h3>
                        <div className={styles.cityDetail} style={{ overflowX: 'auto' }}>
                            <table className={styles.cityTable} style={{ minWidth: '760px' }}>
                                <thead>
                                    <tr><th>시간</th><th>여행사</th><th>항공권</th><th>신고</th><th>상태</th><th>표시 가격</th></tr>
                                </thead>
                                <tbody>
                                    {flightReports.reports.map(report => (
                                        <tr key={report.id}>
                                            <td style={{ whiteSpace: 'nowrap' }}>{formatKST(report.created_at).replace(/\d{4}\. /, '')}</td>
                                            <td>{SOURCE_NAMES[report.source] || report.source}</td>
                                            <td>{report.departure_city} → {report.arrival_city}<br /><small>{report.departure_date}</small></td>
                                            <td>{report.report_type === 'price_changed' ? '가격이 달라요' : '예약이 안 돼요'}</td>
                                            <td><span className={report.status === 'pending' ? styles.tagWarn : styles.tagMuted}>{reportStatusLabel(report.status)}</span></td>
                                            <td>{formatPrice(report.displayed_price)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>)}
                </section>
            </>)}

            {tab === 'collection' && (<>
            <div className={styles.tabIntro}>
                <div>
                    <span className={styles.eyebrow}>수집 상태</span>
                    <h2>여행사와 가격 정보가 제때 들어오는지 봅니다</h2>
                    <p>문제가 생기면 원인을 찾기 전에 먼저 어느 여행사의 정보가 얼마나 오래 멈췄는지 확인하세요.</p>
                </div>
            </div>
            <SectionNav items={[
                { href: '#collection-period', label: '오늘·7일·30일' },
                { href: '#collection-sources', label: '여행사별 상태' },
                { href: '#collection-changes', label: '항공권 변화' },
                { href: '#collection-naver', label: '네이버 가격' },
            ]} />
            <section className={styles.section} id="collection-period">
                <h2>수집 실행 요약</h2>
                <p className={styles.sectionHelp}>한 여행사라도 실패해 이전 데이터를 쓴 회차는 문제 회차로 셉니다.</p>
                <PeriodTable
                    rows={[
                        { label: '실행한 횟수', today: `${crawlToday.runs}회`, recent7: `${crawl7.runs}회`, recent30: `${crawl30.runs}회` },
                        { label: '문제가 있었던 회차', today: `${crawlToday.failed}회`, recent7: `${crawl7.failed}회`, recent30: `${crawl30.failed}회` },
                        { label: '새로 들어온 표', today: `${crawlToday.added.toLocaleString()}개`, recent7: `${crawl7.added.toLocaleString()}개`, recent30: `${crawl30.added.toLocaleString()}개` },
                        { label: '사라진 표', today: `${crawlToday.removed.toLocaleString()}개`, recent7: `${crawl7.removed.toLocaleString()}개`, recent30: `${crawl30.removed.toLocaleString()}개` },
                    ]}
                />
                {crawl30RecordedDays > 0 && crawl30RecordedDays < 30 && (
                    <p className={styles.dataNotice}>
                        최근 30일 칸에는 아직 기록이 있는 {crawl30RecordedDays}일치만 포함됩니다. 날짜가 쌓이면 30일치로 자동 채워집니다.
                    </p>
                )}
            </section>
            {/* 여행사별 수집 상태 — 노랑풍선이 이틀 가까이 반쪽으로 서비스되는 동안
                어느 화면에서도 그 사실을 알 수 없었다. 건수·마지막 갱신·추세를 한 카드에 모은다. */}
            <section className={styles.section} id="collection-sources">
                <h2>여행사별 수집 상태</h2>
                <p className={styles.sectionHelp}>
                    큰 숫자는 필터를 거쳐 지금 사이트에 실제로 보이는 항공권 수이고, 막대는 최근 수집에서 여행사로부터 가져온 양의 추이입니다.
                    건너뜀은 차단 휴식 때문에 요청 자체를 하지 않은 회차이며 실패 횟수나 수집량으로 계산하지 않습니다.
                </p>
                <div className={styles.sourceGraphLegend} aria-label="수집 그래프 범례">
                    <span><i className={styles.sourceLegendAuto} />자동 수집</span>
                    <span><i className={styles.sourceLegendFailed} />수집 실패</span>
                    <span><i className={styles.sourceLegendManual} />수동 캡처 성공</span>
                    <span><i className={styles.sourceLegendSkipped} />건너뜀</span>
                </div>
                <div className={styles.sourceGrid}>
                    {allSources.map(source => {
                        const updatedAt = data.sourceUpdatedAt?.[source];
                        const streak = data.staleStreak?.[source] || 0;
                        const circuit = data.sourceCircuits?.[source];
                        const circuitOpen = Boolean(
                            circuit && (!circuit.nextProbeAt || new Date(circuit.nextProbeAt).getTime() > Date.now()),
                        );
                        const manualCapture = data.manualCaptureStatus?.[source];
                        const staleAfter = STALE_AFTER_HOURS[source] ?? DEFAULT_STALE_AFTER_HOURS;
                        const ageHours = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) / 3600000 : null;
                        const stale = ageHours === null || ageHours > staleAfter;

                        const loggedHistory = (data.crawlHistory || [])
                            .filter(entry => sourceHasHistoryEvent(entry, source))
                            .map(entry => ({
                                ts: entry.timestamp,
                                value: entry.sites[source]?.scraped ?? entry.sites[source]?.total ?? 0,
                                preserved: Boolean(entry.sites[source]?.preserved),
                                skipped: Boolean(entry.sites[source]?.skipped),
                                manual: Boolean(entry.sites[source]?.manual),
                            }));
                        const hasCurrentManualLog = source === 'modetour' && Boolean(manualCapture) && loggedHistory.some(entry =>
                            entry.manual
                            && Math.abs(new Date(entry.ts).getTime() - new Date(manualCapture!.lastImportedAt).getTime()) < 5 * 60_000,
                        );
                        const history = [
                            ...loggedHistory,
                            ...(source === 'modetour' && manualCapture && !hasCurrentManualLog ? [{
                                ts: manualCapture.lastImportedAt,
                                value: manualCapture.accepted,
                                preserved: false,
                                skipped: false,
                                manual: true,
                            }] : []),
                        ]
                            .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
                            .slice(-16);
                        const latestFailedAt = [...history].reverse().find(entry => entry.preserved && !entry.skipped)?.ts;
                        const manualImportedAt = manualCapture
                            ? new Date(manualCapture.lastImportedAt).getTime()
                            : Number.NaN;
                        const failureAt = Math.max(
                            circuit?.openedAt ? new Date(circuit.openedAt).getTime() : 0,
                            latestFailedAt ? new Date(latestFailedAt).getTime() : 0,
                        );
                        const modetourManualApplied = source === 'modetour'
                            && Boolean(manualCapture)
                            && (circuitOpen || streak > 0)
                            && Number.isFinite(manualImportedAt)
                            && manualImportedAt >= failureAt;
                        const modetourManualNeeded = source === 'modetour'
                            && (circuitOpen || streak > 0)
                            && !modetourManualApplied;
                        const modetourFailureLabel = streak > 0 ? `${streak}회 실패` : '실패';

                        // 무결성 가드가 막지 못하고 통과한 반쪽 결과도 여기서는 보이게 한다.
                        // 가드는 직전 한 번과만 비교하므로, 반쪽 결과가 한 번 자리를 잡으면
                        // 그 다음부터는 그 낮은 값이 기준이 되어 조용해진다(노랑풍선 89건이 그랬다).
                        // 최근 중앙값과 견주면 그렇게 굳어버린 상태도 드러난다.
                        const past = history.slice(0, -1).filter(h => !h.preserved && !h.manual && !h.skipped).map(h => h.value).sort((a, b) => a - b);
                        const median = past.length ? past[Math.floor(past.length / 2)] : 0;
                        const latestMeasured = [...history].reverse().find(entry => !entry.skipped) || null;
                        const slumped = Boolean(
                            latestMeasured && !latestMeasured.preserved && !latestMeasured.manual && median >= 30 && latestMeasured.value < median * 0.6,
                        );

                        const status = circuitOpen || streak > 0 || slumped ? 'broken' : stale ? 'stale' : 'ok';
                        const peak = Math.max(...history.filter(entry => !entry.skipped).map(h => h.value), 1);
                        const shown = flightFilterSummary?.visibleBySource?.[source] ?? 0;

                        return (
                            <div
                                key={source}
                                className={[
                                    styles.sourceCard,
                                    status === 'broken' ? styles.sourceCardBroken : '',
                                    status === 'stale' ? styles.sourceCardStale : '',
                                ].filter(Boolean).join(' ')}
                            >
                                <div className={styles.sourceCardHead}>
                                    <span className={styles.sourceName}>
                                        <span
                                            className={styles.sourceDot}
                                            style={{ background: SOURCE_COLORS[source] || '#6b7280' }}
                                        />
                                        {SOURCE_NAMES[source] || source}
                                    </span>
                                    <span
                                        className={[
                                            styles.statusBadge,
                                            status === 'broken' ? styles.statusBadgeBroken : '',
                                            status === 'stale' ? styles.statusBadgeStale : '',
                                        ].filter(Boolean).join(' ')}
                                    >
                                        {modetourManualApplied
                                            ? `GitHub ${modetourFailureLabel} · 수동 ${manualCapture!.accepted}건 반영${manualCapture!.naverPending ? ' · 네이버 대기' : ''}`
                                            : modetourManualNeeded
                                            ? `GitHub ${modetourFailureLabel} · 수동 캡처 필요`
                                            : circuitOpen
                                            ? circuit!.localFallback?.status === 'success'
                                                ? `GitHub 휴식 · PC ${formatKST(circuit!.localFallback.lastAttemptAt)} 성공`
                                                : circuit!.localFallback?.status === 'blocked'
                                                    ? `PC도 차단 · ${formatKST(circuit!.localFallback.nextProbeAt || circuit!.nextProbeAt)} 재탐색`
                                                    : circuit!.reason === 'rate_limited'
                                                        ? `요청 제한 · ${formatKST(circuit!.nextProbeAt)} 재탐색`
                                                        : `접근 차단 · ${formatKST(circuit!.nextProbeAt)} 재탐색`
                                            : streak > 0
                                                ? `이전 데이터 사용 ${streak}회`
                                            : slumped
                                                    ? `평소보다 너무 적음 (${median.toLocaleString()}건 수준)`
                                                    : status === 'stale' ? '예정 시간보다 늦음' : '정상'}
                                    </span>
                                </div>

                                <div className={styles.sourceCount}>
                                    {shown.toLocaleString()}
                                    <small>건 노출 중</small>
                                </div>

                                <div className={styles.sourceMeta}>
                                    {updatedAt
                                        ? <span>마지막 갱신 {timeAgo(updatedAt)}</span>
                                        : <span>갱신 기록 없음</span>}
                                    {latestMeasured && !latestMeasured.preserved && !latestMeasured.manual && (
                                        <span>최근 자동 수집 {latestMeasured.value.toLocaleString()}건 · 사이트 노출 {shown.toLocaleString()}건</span>
                                    )}
                                    {modetourManualNeeded && (
                                        <span>PC 자동 접속 없음 · 일반 Chrome 결과 화면을 캡처해 전달</span>
                                    )}
                                    {source === 'modetour' && circuit && (
                                        <span>마지막 실제 실패 {formatKST(circuit.openedAt)} · 원인: {circuit.detail}</span>
                                    )}
                                    {source === 'modetour' && manualCapture && (
                                        <span>
                                            최근 수동 반영 {formatKST(manualCapture.lastImportedAt)} · 확정 {manualCapture.accepted}건
                                            {manualCapture.review > 0 ? ` · 확인 필요 ${manualCapture.review}건` : ''}
                                            {manualCapture.emptyRegions?.length ? ` · 빈 지역 ${manualCapture.emptyRegions.join('/')}` : ''}
                                            {manualCapture.naverPending
                                                ? ` · 네이버 확인 대기${manualCapture.naverDeferred ? ` ${manualCapture.naverDeferred}건` : ''}`
                                                : ''}
                                        </span>
                                    )}
                                </div>

                                <div className={styles.sparkBars} role="img" aria-label={`${SOURCE_NAMES[source]} 최근 ${history.length}회 자동·수동 수집 및 건너뜀 기록`}>
                                    {history.map((h, i) => (
                                        <span
                                            key={i}
                                            className={h.manual
                                                ? `${styles.sparkBar} ${styles.sparkBarManual}`
                                                : h.skipped
                                                    ? `${styles.sparkBar} ${styles.sparkBarSkipped}`
                                                : h.preserved
                                                    ? `${styles.sparkBar} ${styles.sparkBarPreserved}`
                                                    : styles.sparkBar}
                                            style={{ height: h.manual ? '18px' : h.skipped ? '8px' : `${Math.max(4, Math.round((h.value / peak) * 100))}%` }}
                                            title={h.skipped
                                                ? `${formatKST(h.ts).replace(/\d{4}\. /, '')} · 건너뜀 (차단 휴식, 요청 없음)`
                                                : `${formatKST(h.ts).replace(/\d{4}\. /, '')} · ${h.value.toLocaleString()}건${h.manual ? ' (수동 캡처 성공)' : h.preserved ? ' (수집 실패, 이전 데이터 유지)' : ' (자동 수집)'}`}
                                        >
                                            {h.manual ? '✓' : ''}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* 크롤링 히스토리 */}
            {data.crawlHistory && data.crawlHistory.length > 0 && (
                <section className={styles.section} id="collection-changes">
                    <h2>항공권 수집 기록</h2>
                    <h3 className={styles.userSubTitle}>실행할 때마다 표가 얼마나 바뀌었나</h3>
                    <p className={styles.sectionHelp}>
                        <strong>새로 들어옴</strong>은 직전 크롤에는 없던 항공권, <strong>사라짐</strong>은 직전에는 있었지만
                        이번에 없어진 항공권입니다. <strong>총 변동</strong>은 두 수를 합친 값입니다. 수집에 실패해 이전 데이터를
                        유지한 회차는 급감·급증으로 오해하지 않도록 판단에서 통째로 제외합니다.
                    </p>
                    <div className={turnoverCoverageDays >= 14 ? styles.naverStatus : `${styles.naverStatus} ${styles.naverStatusStale}`}>
                        <strong>{turnoverCoverageDays >= 14 ? '판단 가능한 기록이 쌓였습니다.' : '아직 판단을 보류합니다.'}</strong>
                        <span>
                            측정 시작 후 {turnoverCoverageDays.toLocaleString()}일 경과 · 최소 14일 필요 · 최근 약 30일 보관
                        </span>
                    </div>
                    {turnoverHistory.length === 0 ? (
                        <div className={styles.dealReviewEmpty}>변동 측정을 시작한 뒤의 크롤 기록이 아직 없습니다.</div>
                    ) : (
                        <div className={styles.cityDetail} style={{ maxHeight: '520px', overflow: 'auto' }}>
                            <table className={styles.cityTable} style={{ minWidth: '680px' }}>
                                <thead>
                                    <tr>
                                        <th>크롤 시간</th>
                                        <th>새로 들어옴</th>
                                        <th>사라짐</th>
                                        <th>총 변동</th>
                                        <th>쉽게 말하면</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[...turnoverHistory].reverse().map(row => {
                                        const excluded = !row.reliable;
                                        const explanation = row.failedSources.length > 0
                                            ? `${row.failedSources.join(', ')} 수집 실패 — 판단에서 제외`
                                            : row.missingSources.length > 0
                                                ? '일부 여행사 측정값 없음 — 판단에서 제외'
                                                : row.changed === 0
                                                    ? '새로 생기거나 사라진 표가 없음'
                                                    : `${row.added.toLocaleString()}개 들어오고 ${row.removed.toLocaleString()}개 사라짐`;
                                        return (
                                            <tr key={row.entry.timestamp}>
                                                <td style={{ whiteSpace: 'nowrap' }}>
                                                    {formatKST(row.entry.timestamp).replace(/\d{4}\. /, '')}
                                                </td>
                                                <td style={{ textAlign: 'center', color: excluded ? '#64748b' : '#34d399' }}>
                                                    {excluded ? '—' : `${row.added.toLocaleString()}개`}
                                                </td>
                                                <td style={{ textAlign: 'center', color: excluded ? '#64748b' : '#f87171' }}>
                                                    {excluded ? '—' : `${row.removed.toLocaleString()}개`}
                                                </td>
                                                <td style={{ textAlign: 'center', fontWeight: 700 }}>
                                                    {excluded ? '제외' : `${row.changed.toLocaleString()}개`}
                                                </td>
                                                <td>
                                                    <span className={excluded ? styles.tagWarn : row.changed === 0 ? styles.tagMuted : styles.tagGood}>
                                                        {explanation}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <h3 className={styles.userSubTitle}>최근 회차를 여행사별로 보기</h3>
                    <div className={styles.metricToggle}>
                        <span className={styles.metricLabel}>표시 기준</span>
                        <button
                            type="button"
                            className={crawlMetric === 'shown' ? `${styles.metricBtn} ${styles.metricBtnActive}` : styles.metricBtn}
                            onClick={() => setCrawlMetric('shown')}
                        >
                            사이트에 보이는 표
                        </button>
                        <button
                            type="button"
                            className={crawlMetric === 'scraped' ? `${styles.metricBtn} ${styles.metricBtnActive}` : styles.metricBtn}
                            onClick={() => setCrawlMetric('scraped')}
                        >
                            여행사에서 가져온 표
                        </button>
                        <button
                            type="button"
                            className={crawlMetric === 'turnover' ? `${styles.metricBtn} ${styles.metricBtnActive}` : styles.metricBtn}
                            onClick={() => setCrawlMetric('turnover')}
                        >
                            처음 확인한 표
                        </button>
                    </div>
                    <p className={styles.sectionHelp}>
                        <strong>사이트에 보이는 표</strong>는 중복·만료·가격 기준을 모두 통과한 수이고,
                        <strong>여행사에서 가져온 표</strong>는 필터 전 원본 수입니다. 두 숫자는 뜻이 달라 한 표 안에서 섞지 않습니다.
                        <strong>처음 확인한 표</strong>는 직전 실행에는 없던 표의 수입니다. 개수만 보면 표가 통째로 바뀌어도
                        변동이 없어 보이므로, 어느 시각 크롤이 실제로 일하는지는 이 기준으로 봐야 합니다.
                        표 전체가 한 기준으로만 표시됩니다. 수집 건수와 들고남을 따로 남기기 시작한 것은 2026-08-21부터라,
                        그 이전 기록은 수집 건수가 <code>—</code>로 비어 있고 노출 건수 자리에도 여행사마다 기준이 섞여 있습니다.
                        회차별 수치와 경고는 최근 약 30일을 보관하고, 파일 용량이 큰 도시·지역 상세만 7일 뒤 정리합니다.
                    </p>
                    <div className={styles.previousDataNotice} role="note">
                        <span className={styles.previousDataNoticeBadge}>⚠ 이전 데이터 사용</span>
                        <span>이번 수집에 문제가 있어 새 값 대신 직전 정상 데이터를 표시한다는 뜻입니다.</span>
                    </div>
                    <div className={styles.collectionStateNotice} role="note">
                        <span className={styles.manualDataBadge}>✓ 수동 캡처 성공</span>
                        <span className={styles.skippedDataBadge}>건너뜀</span>
                        <span>수동 반영과 요청 자체를 하지 않은 회차를 자동 수집 실패와 분리해 표시합니다.</span>
                    </div>
                    <div className={styles.cityDetail} style={{ overflowX: 'auto' }}>
                        <table className={styles.cityTable} style={{ minWidth: '500px' }}>
                            <thead>
                                <tr>
                                    <th>시간</th>
                                    {allSources.map(s => (
                                        <th key={s} style={{ color: SOURCE_COLORS[s] }}>
                                            {SOURCE_NAMES[s] || s}
                                        </th>
                                    ))}
                                    <th>합계</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...data.crawlHistory].reverse().slice(0, 14).map((entry, idx, arr) => {
                                    const prev = arr[idx + 1];
                                    const total = sumMetric(entry.sites);
                                    const prevTotal = prev ? sumMetric(prev.sites) : null;
                                    const manualEntry = Object.values(entry.sites).some(stat => stat.manual);
                                    const previousManualEntry = prev ? Object.values(prev.sites).some(stat => stat.manual) : false;
                                    const totalDiff = !manualEntry && !previousManualEntry && prevTotal !== null ? total - prevTotal : null;

                                    return (
                                        <tr key={entry.timestamp}>
                                            <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                                {formatKST(entry.timestamp).replace(/\d{4}. /, '')}
                                            </td>
                                            {allSources.map(source => {
                                                const stat = entry.sites[source];
                                                const prevStat = prev?.sites[source];
                                                const count = metricOf(stat);
                                                const prevCount = metricOf(prevStat);
                                                // 수집에 실패해 이전 데이터를 물려받은 칸은 측정치가 아니다.
                                                // 여기에 증감을 붙이면 일어나지 않은 변화를 읽게 된다.
                                                const skipped = Boolean(stat?.skipped);
                                                const manual = Boolean(stat?.manual);
                                                const preserved = Boolean(stat?.preserved && !skipped);
                                                const diff = !preserved && !skipped && !manual
                                                    && !prevStat?.preserved && !prevStat?.skipped && !prevStat?.manual
                                                    && prevCount !== null && count !== null
                                                    ? count - prevCount
                                                    : null;
                                                return (
                                                    <td
                                                        key={source}
                                                        className={manual
                                                            ? styles.manualDataCell
                                                            : skipped
                                                                ? styles.skippedDataCell
                                                                : preserved ? styles.previousDataCell : undefined}
                                                        style={{ textAlign: 'center' }}
                                                    >
                                                        <span className={preserved ? styles.previousDataValue : undefined}>
                                                            {count === null ? '—' : count.toLocaleString()}
                                                        </span>
                                                        {manual && (
                                                            <span className={styles.manualDataBadge} title="운영자가 일반 브라우저 캡처를 검수해 반영한 값입니다.">
                                                                ✓ 수동 성공
                                                            </span>
                                                        )}
                                                        {skipped && (
                                                            <span className={styles.skippedDataBadge} title="차단 휴식 때문에 요청하지 않았으며 실패 횟수에 포함하지 않습니다.">
                                                                건너뜀
                                                            </span>
                                                        )}
                                                        {preserved && (
                                                            <span
                                                                className={styles.previousDataBadge}
                                                                title="이번 수집에 문제가 있어 직전 정상 데이터를 표시하고 있습니다. 이번 회차의 새 측정값이 아닙니다."
                                                                aria-label="수집 실패로 이전 크롤 값을 표시 중"
                                                            >
                                                                ⚠ 이전 데이터 사용
                                                            </span>
                                                        )}
                                                        {diff !== null && diff !== 0 && (
                                                            <span style={{
                                                                fontSize: '0.75rem',
                                                                marginLeft: '4px',
                                                                color: diff > 0 ? '#10b981' : '#ef4444',
                                                                fontWeight: 600,
                                                            }}>
                                                                {diff > 0 ? `+${diff}` : diff}
                                                            </span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td style={{ textAlign: 'center', fontWeight: 600 }}>
                                                <span>{total}</span>
                                                {totalDiff !== null && totalDiff !== 0 && (
                                                    <span style={{
                                                        fontSize: '0.75rem',
                                                        marginLeft: '4px',
                                                        color: totalDiff > 0 ? '#10b981' : '#ef4444',
                                                    }}>
                                                        {totalDiff > 0 ? `+${totalDiff}` : totalDiff}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* 경고 목록 */}
                    {data.crawlHistory.some(e => e.alerts.length > 0) && (
                        <div className={styles.cityDetail} style={{ marginTop: '16px' }}>
                            <h3 style={{ marginBottom: '8px' }}>⚠️ 최근 경고</h3>
                            <table className={styles.cityTable}>
                                <thead>
                                    <tr><th>시간</th><th>내용</th></tr>
                                </thead>
                                <tbody>
                                    {data.crawlHistory
                                        .filter(e => e.alerts.length > 0)
                                        .slice(-5)
                                        .reverse()
                                        .flatMap((e) =>
                                            e.alerts.map((a, j) => (
                                                <tr key={`${e.timestamp}-${j}`}>
                                                    {j === 0 ? (
                                                        <td rowSpan={e.alerts.length} style={{ whiteSpace: 'nowrap', verticalAlign: 'top', fontSize: '0.85rem' }}>
                                                            {formatKST(e.timestamp).replace(/\d{4}\. /, '')}
                                                        </td>
                                                    ) : null}
                                                    <td style={{
                                                        color: a.startsWith('⚠️ 시간 정보:') ? '#fbbf24' : '#ef4444',
                                                        fontSize: '0.85rem',
                                                    }}>
                                                        {a}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            )}

            {/* 네이버 비교가 상태 — 로컬 크롤이 멈추면 추천 품질이 조용히 나빠지므로 눈에 띄게 둔다 */}
            <div id="collection-naver">
            {data.naverStatus && (() => {
                const { lastCrawledAt, freshEntries, totalEntries } = data.naverStatus;
                const stale = !lastCrawledAt || freshEntries === 0;
                return (
                    <div className={stale ? `${styles.naverStatus} ${styles.naverStatusStale}` : styles.naverStatus}>
                        <strong>네이버 가격 확인</strong>
                        {lastCrawledAt ? (
                            <span>
                                마지막 갱신 {formatKST(lastCrawledAt)} ({timeAgo(lastCrawledAt)}) ·
                                {' '}최근 24시간 내 사용 가능 {freshEntries.toLocaleString()}건 / 전체 {totalEntries.toLocaleString()}건
                            </span>
                        ) : (
                            <span>갱신 기록이 없습니다.</span>
                        )}
                        {stale && <em>24시간 넘게 지난 가격은 추천 판단에 쓰지 않습니다. 자동 확인이 실행되는지 살펴보세요.</em>}
                    </div>
                );
            })()}

            {data.naverCrawlHistory && data.naverCrawlHistory.length > 0 && (
                <section className={styles.section}>
                    <h2>네이버 가격 확인 기록</h2>
                    <p className={styles.sectionHelp}>
                        <strong>이번 회차 확인 대상</strong>은 가격 확인 시점이 지난 노선,
                        {' '}<strong>실제로 조회</strong>는 이번 실행에서 네이버를 열어본 노선입니다.
                        최대치 때문에 처리하지 못한 항목은 <strong>다음 회차로 넘김</strong>에 남습니다. 기록은 60일간 보관합니다.
                    </p>
                    <div className={styles.cityDetail} style={{ maxHeight: '520px', overflow: 'auto' }}>
                        <table className={styles.cityTable} style={{ minWidth: '820px' }}>
                            <thead>
                                <tr>
                                    <th>실행 시간</th>
                                    <th>이번 회차 확인 대상</th>
                                    <th>실제로 조회</th>
                                    <th>처음 확인한 노선</th>
                                    <th>다음 회차로 넘김</th>
                                    <th>가장 오래 밀림</th>
                                    <th>확인 결과</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...data.naverCrawlHistory].slice(-60).reverse().map(entry => {
                                    const oldestDeferred = entry.deferred === 0
                                        ? '없음'
                                        : entry.deferredNeverChecked > 0
                                            ? `한 번도 미확인 ${entry.deferredNeverChecked.toLocaleString()}개`
                                            : entry.oldestDeferredHours === null
                                                ? '확인 불가'
                                                : entry.oldestDeferredHours >= 24
                                                    ? `${(entry.oldestDeferredHours / 24).toFixed(1)}일`
                                                    : `${Math.round(entry.oldestDeferredHours)}시간`;
                                    const runner = entry.runner === 'local' ? 'PC' : entry.runner === 'github' ? 'GitHub' : '수동';
                                    const coverage = entry.sourceFilter === 'all'
                                        ? '전체 여행사'
                                        : SOURCE_NAMES[entry.sourceFilter] || entry.sourceFilter;
                                    return (
                                        <tr key={entry.id}>
                                            <td style={{ whiteSpace: 'nowrap' }}>
                                                {formatKST(entry.timestamp).replace(/\d{4}\. /, '')}
                                                <span style={{ display: 'block', color: '#64748b', fontSize: '0.72rem' }}>
                                                    {runner} · {coverage}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>{entry.needed.toLocaleString()}개</td>
                                            <td style={{ textAlign: 'center' }}>{entry.attempted.toLocaleString()}개</td>
                                            <td style={{ textAlign: 'center' }}>
                                                {entry.newRoutes.toLocaleString()}개
                                                {entry.newRoutesAttempted < entry.newRoutes && (
                                                    <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.72rem' }}>
                                                        {entry.newRoutesAttempted.toLocaleString()}개 확인
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'center', color: entry.deferred > 0 ? '#fbbf24' : '#94a3b8' }}>
                                                {entry.deferred.toLocaleString()}개
                                            </td>
                                            <td style={{ textAlign: 'center' }}>{oldestDeferred}</td>
                                            <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                <span style={{ color: '#34d399' }}>{entry.success.toLocaleString()} 성공</span>
                                                {' · '}
                                                <span style={{ color: entry.misses > 0 ? '#f87171' : '#94a3b8' }}>{entry.misses.toLocaleString()} 실패</span>
                                                {entry.misses > 0 && [entry.noResult, entry.routeErrors, entry.transientErrors, entry.blocked]
                                                    .some(value => value !== undefined) && (
                                                    <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.72rem' }}>
                                                        결과 없음 {(entry.noResult || 0).toLocaleString()}
                                                        {' · '}노선 오류 {(entry.routeErrors || 0).toLocaleString()}
                                                        {' · '}일시 오류 {(entry.transientErrors || 0).toLocaleString()}
                                                        {' · '}접근 제한 {(entry.blocked || 0).toLocaleString()}
                                                    </span>
                                                )}
                                                {(entry.healthChecks || 0) > 0 && (
                                                    <span style={{ display: 'block', color: '#60a5fa', fontSize: '0.72rem' }}>
                                                        정상 대조 조회 {entry.healthChecks?.toLocaleString()}회
                                                    </span>
                                                )}
                                                {entry.abortedEarly && (
                                                    <span style={{ display: 'block', color: '#fb923c', fontSize: '0.72rem' }}>일찍 중단됨</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
            </div>
            </>)}

            {tab === 'flights' && (<>
            {/* 요약 카드 */}
            <section className={styles.section} id="flight-visibility">
            <div className={styles.sectionHeading}>
                <div>
                    <h2>현재 노출 현황</h2>
                    <p>지금 저장된 항공권이 화면에 보이기까지 몇 개가 남는지 보여줍니다.</p>
                </div>
                <span className={styles.nowBadge}>지금</span>
            </div>
            <div className={styles.summaryCards}>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>여행사에서 가져온 표</span>
                    <span className={styles.summaryValue}>{(flightFilterSummary?.collected ?? data.totalFlights).toLocaleString()}</span>
                    <span className={styles.summaryHint}>중복·만료·가격 기준을 적용하기 전</span>
                </div>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>사이트에 보이는 표</span>
                    <span className={styles.summaryValue}>{flightFilterSummary ? flightFilterSummary.visible.toLocaleString() : '—'}</span>
                    <span className={styles.summaryHint}>날짜·지역 필터를 모두 해제했을 때</span>
                </div>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>기준에 따라 제외한 표</span>
                    <span className={styles.summaryValue}>{flightFilterSummary ? flightFilterSummary.excluded.toLocaleString() : '—'}</span>
                    <span className={styles.summaryHint}>중복·가격·신고·지난 일정 기준 적용</span>
                </div>
            </div>

            {flightFilterSummary && (
                <section className={styles.visibilityBreakdown}>
                    <div>
                        <strong>왜 {flightFilterSummary.excluded.toLocaleString()}건이 화면에서 빠졌나요?</strong>
                        <p>수집에는 성공했지만 사용자에게 같은 표를 반복해서 보여주지 않거나, 특가로 보기 어려운 표를 제외한 결과입니다.</p>
                    </div>
                    <div className={styles.visibilityReasons}>
                        {exclusionReasons.length > 0 ? exclusionReasons.map(reason => (
                            <span key={reason.label}>
                                {reason.label} <b>{reason.count.toLocaleString()}건</b>
                            </span>
                        )) : <span>현재 제외된 항공권이 없습니다.</span>}
                    </div>
                </section>
            )}
            </section>

            <section className={styles.section} id="flight-quality">
                <div className={styles.sectionHeading}>
                    <div>
                        <h2>정보가 빠진 항공권</h2>
                        <p>사이트에 보이는 표 중 어떤 정보가 부족한지 확인합니다. 숫자를 누적 합산하면 안 됩니다. 한 표에서 여러 정보가 함께 빠질 수 있습니다.</p>
                    </div>
                    <span className={styles.nowBadge}>지금</span>
                </div>
                {flightFilterSummary ? (
                    <div className={styles.summaryCards}>
                        <div className={styles.summaryCard}>
                            <span className={styles.summaryLabel}>출발·귀국 시간 부족</span>
                            <span className={styles.summaryValue}>{flightFilterSummary.quality.missingTimes.toLocaleString()}</span>
                            <span className={styles.summaryHint}>가는 편 또는 오는 편 시간이 비어 있음</span>
                        </div>
                        <div className={styles.summaryCard}>
                            <span className={styles.summaryLabel}>남은 좌석 정보 없음</span>
                            <span className={styles.summaryValue}>{flightFilterSummary.quality.missingSeats.toLocaleString()}</span>
                        </div>
                        <div className={styles.summaryCard}>
                            <span className={styles.summaryLabel}>예약 링크 없음</span>
                            <span className={styles.summaryValue}>{flightFilterSummary.quality.missingBookingLink.toLocaleString()}</span>
                        </div>
                        <div className={styles.summaryCard}>
                            <span className={styles.summaryLabel}>왕복 공항 4개 미확인</span>
                            <span className={styles.summaryValue}>{flightFilterSummary.quality.missingExactAirports.toLocaleString()}</span>
                            <span className={styles.summaryHint}>도시가 아닌 실제 출발·도착 공항 조합 기준</span>
                        </div>
                        <div className={styles.summaryCard}>
                            <span className={styles.summaryLabel}>최근 네이버 가격 있음</span>
                            <span className={styles.summaryValue}>{flightFilterSummary.quality.freshNaverComparison.toLocaleString()}</span>
                            <span className={styles.summaryHint}>최근 24시간 안에 같은 일정·공항으로 확인</span>
                        </div>
                    </div>
                ) : <div className={styles.dealReviewEmpty}>항공권 정보 상태를 불러오는 중입니다.</div>}
            </section>

            {/* 현재 사이트에 실제로 보이는 항공권의 구성 */}
            <section className={styles.section} id="flight-mix">
                <h2>현재 노출 항공권 구성</h2>
                <p className={styles.sectionHelp}>수집 원본이 아니라 모든 제외 기준을 통과해 사용자 화면에 보이는 표만 셉니다.</p>
                <h3 className={styles.userSubTitle}>여행사별</h3>
                {(() => {
                    // conic-gradient 계산
                    const visibleBySource = flightFilterSummary?.visibleBySource || {};
                    const visibleTotal = flightFilterSummary?.visible || 0;
                    let cumPct = 0;
                    const gradientParts = allSources.map(source => {
                        const pct = visibleTotal > 0 ? ((visibleBySource[source] || 0) / visibleTotal) * 100 : 0;
                        const start = cumPct;
                        cumPct += pct;
                        return `${SOURCE_COLORS[source] || '#6b7280'} ${start}% ${cumPct}%`;
                    });
                    const gradient = `conic-gradient(${gradientParts.join(', ')})`;

                    return (
                        <div style={{ display: 'flex', gap: '32px', alignItems: 'center', flexWrap: 'wrap' }}>
                            {/* 도넛 차트 */}
                            <div style={{
                                width: '200px',
                                height: '200px',
                                borderRadius: '50%',
                                background: gradient,
                                position: 'relative',
                                flexShrink: 0,
                                margin: '0 auto',
                            }}>
                                <div style={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: '110px',
                                    height: '110px',
                                    borderRadius: '50%',
                                    background: '#1a1a2e',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <span style={{ fontSize: '1.4rem', fontWeight: 700 }}>{visibleTotal.toLocaleString()}</span>
                                    <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>사이트 노출</span>
                                </div>
                            </div>

                            {/* 범례 테이블 */}
                            <div className={styles.cityDetail} style={{ flex: 1, minWidth: '280px' }}>
                                <table className={styles.cityTable}>
                                    <thead>
                                    <tr><th>여행사</th><th>보이는 표</th><th>비율</th></tr>
                                    </thead>
                                    <tbody>
                                        {allSources.map(source => {
                                            const count = visibleBySource[source] || 0;
                                            const pct = visibleTotal > 0 ? Math.round((count / visibleTotal) * 100) : 0;
                                            return (
                                                <tr key={source}>
                                                    <td>
                                                        <span style={{
                                                            display: 'inline-block',
                                                            width: '10px',
                                                            height: '10px',
                                                            borderRadius: '50%',
                                                            background: SOURCE_COLORS[source] || '#6b7280',
                                                            marginRight: '8px',
                                                            verticalAlign: 'middle',
                                                        }} />
                                                        {SOURCE_NAMES[source] || source}
                                                    </td>
                                                    <td>{count.toLocaleString()}건</td>
                                                    <td>{pct}%</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })()}
            </section>

            {/* 사이트에 보이는 표의 지역 구성 */}
            <section className={styles.section}>
                <h2>지역별 항공권 수</h2>
                <div className={styles.cityDetail}>
                    <table className={styles.cityTable}>
                        <thead>
                            <tr>
                                <th>지역</th>
                                <th>사이트에 보이는 표</th>
                                <th>전체에서 차지하는 비율</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedRegions.map(([region, count]) => (
                                    <tr key={region}>
                                        <td><strong>{region}</strong></td>
                                        <td>{count}건</td>
                                        <td>{flightFilterSummary?.visible ? Math.round((count / flightFilterSummary.visible) * 100) : 0}%</td>
                                    </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* 현재 공급이 많은 도착 도시 */}
            <section className={styles.section}>
                <h2>항공권이 많이 나온 도착 도시</h2>
                <p className={styles.sectionHelp}>사용자가 많이 찾았다는 뜻이 아니라, 현재 사이트에 표가 많이 올라온 도시입니다.</p>
                <div className={styles.cityDetail}>
                    <table className={styles.cityTable}>
                        <thead>
                            <tr><th>도시</th><th>항공편</th><th>비율</th></tr>
                        </thead>
                        <tbody>
                            {sortedCities.slice(0, 15).map(([city, count]) => (
                                <tr key={city}>
                                    <td>{city}</td>
                                    <td>{count}건</td>
                                <td>{flightFilterSummary?.visible ? Math.round((count / flightFilterSummary.visible) * 100) : 0}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* 출발 도시별 */}
            <section className={styles.section}>
                <h2>출발 도시별 항공권 수</h2>
                <div className={styles.cityDetail}>
                    <table className={styles.cityTable}>
                        <thead>
                            <tr><th>출발 도시</th><th>항공편</th><th>비율</th></tr>
                        </thead>
                        <tbody>
                            {sortedDepCities.map(([city, count]) => (
                                <tr key={city}>
                                    <td>{city}</td>
                                    <td>{count}건</td>
                                <td>{flightFilterSummary?.visible ? Math.round((count / flightFilterSummary.visible) * 100) : 0}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* 항공사별 */}
            <section className={styles.section}>
                <h2>항공사별 항공권 수</h2>
                <div className={styles.cityDetail}>
                    <table className={styles.cityTable}>
                        <thead>
                            <tr><th>항공사</th><th>항공편</th><th>비율</th></tr>
                        </thead>
                        <tbody>
                            {sortedAirlines.slice(0, 15).map(([airline, count]) => (
                                <tr key={airline}>
                                    <td>{airline}</td>
                                    <td>{count}건</td>
                                <td>{flightFilterSummary?.visible ? Math.round((count / flightFilterSummary.visible) * 100) : 0}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            </>)}

            {tab === 'threads' && (<>
                <div className={styles.tabIntro}>
                    <div>
                        <span className={styles.eyebrow}>THREADS</span>
                        <h2>어떤 글이 사람을 데려왔는지 봅니다</h2>
                        <p>글의 조회·반응은 Threads에서, 사이트 방문·상세·예약 페이지 이동은 GA4에서 가져옵니다.</p>
                    </div>
                </div>

                <section className={styles.section} id="threads-summary">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>최근 Threads 성과</h2>
                            <p>Threads 글은 최근 30개, 사이트 행동은 최근 30일을 집계합니다.</p>
                        </div>
                        <button type="button" className={styles.analyticsToggle} onClick={() => fetchData(key)}>새로고침</button>
                    </div>
                    {threadsInsightsError ? (
                        <div className={styles.dealReviewEmpty}>{threadsInsightsError}</div>
                    ) : !threadsInsights?.available ? (
                        <div className={styles.dealReviewEmpty}>{threadsInsights?.message || 'Threads 인사이트를 불러오는 중입니다.'}</div>
                    ) : (() => {
                        const totals = threadsInsights.posts.reduce((sum, post) => ({
                            views: sum.views + post.metrics.views,
                            interactions: sum.interactions + post.metrics.likes + post.metrics.replies
                                + post.metrics.reposts + post.metrics.quotes + post.metrics.shares,
                        }), { views: 0, interactions: 0 });
                        const site = threadsInsights.attribution.totals;
                        return (
                            <>
                                <div className={styles.signalGridFour}>
                                    <div className={styles.signalCard}>
                                        <span>글 조회</span>
                                        <strong>{totals.views.toLocaleString()}회</strong>
                                        <small>최근 글 {threadsInsights.posts.length.toLocaleString()}개 합계</small>
                                    </div>
                                    <div className={styles.signalCard}>
                                        <span>반응</span>
                                        <strong>{totals.interactions.toLocaleString()}회</strong>
                                        <small>좋아요·답글·재게시·인용·공유</small>
                                    </div>
                                    <div className={styles.signalCard}>
                                        <span>사이트 방문</span>
                                        <strong>{site.users.toLocaleString()}명</strong>
                                        <small>출처 확인 {threadsInsights.attribution.verifiedTotals.users.toLocaleString()}명 · 링크 코드 자동 보완</small>
                                    </div>
                                    <div className={styles.signalCard}>
                                        <span>예약 페이지 이동</span>
                                        <strong>{site.bookingUsers.toLocaleString()}명</strong>
                                        <small>{site.bookingClicks.toLocaleString()}회 이동</small>
                                    </div>
                                </div>
                                {!threadsInsights.attribution.available && (
                                    <div className={styles.dataGap}>{threadsInsights.attribution.message}</div>
                                )}
                            </>
                        );
                    })()}
                </section>

                <section className={styles.section} id="threads-posts">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>글별 인사이트</h2>
                            <p>게시한 <code>/s/</code> 링크를 글 본문에서 찾아 방문·예약 이동을 자동으로 연결합니다.</p>
                        </div>
                    </div>
                    {threadsInsights?.available && threadsInsights.posts.length > 0 ? (
                        <div className={styles.threadsPostList}>
                            {threadsInsights.posts.map(post => {
                                const site = post.attribution;
                                return (
                                    <article className={styles.threadsPostCard} key={post.id}>
                                        <div className={styles.threadsPostHead}>
                                            <time dateTime={post.timestamp}>{post.timestamp ? formatKST(post.timestamp) : '게시 시각 없음'}</time>
                                            {post.permalink && <a href={post.permalink} target="_blank" rel="noopener noreferrer">Threads에서 보기 →</a>}
                                        </div>
                                        <p className={styles.threadsPostText}>{post.text || '(본문 없음)'}</p>
                                        <dl className={styles.threadsMetricGrid}>
                                            <div><dt>조회</dt><dd>{post.metrics.views.toLocaleString()}</dd></div>
                                            <div><dt>좋아요</dt><dd>{post.metrics.likes.toLocaleString()}</dd></div>
                                            <div><dt>답글</dt><dd>{post.metrics.replies.toLocaleString()}</dd></div>
                                            <div><dt>재게시</dt><dd>{post.metrics.reposts.toLocaleString()}</dd></div>
                                            <div><dt>인용</dt><dd>{post.metrics.quotes.toLocaleString()}</dd></div>
                                            <div><dt>공유</dt><dd>{post.metrics.shares.toLocaleString()}</dd></div>
                                            <div><dt>반응률</dt><dd>{post.engagementRate === null ? '—' : `${post.engagementRate}%`}</dd></div>
                                        </dl>
                                        <div className={styles.threadsSiteFlow}>
                                            {site ? (
                                                <>
                                                    <div><span>사이트 방문</span><strong>{site.users.toLocaleString()}명</strong><small>{site.sessions.toLocaleString()}회</small></div>
                                                    <span aria-hidden="true">→</span>
                                                    <div><span>상세 열람</span><strong>{site.detailUsers.toLocaleString()}명</strong><small>{site.detailOpens.toLocaleString()}회</small></div>
                                                    <span aria-hidden="true">→</span>
                                                    <div><span>예약 이동</span><strong>{site.bookingUsers.toLocaleString()}명</strong><small>{site.bookingClicks.toLocaleString()}회</small></div>
                                                </>
                                            ) : post.trackingContent ? (
                                                <p>추적 링크는 확인됐지만 최근 30일 사이트 방문은 아직 없습니다.</p>
                                            ) : (
                                                <p>이 글에는 추적 가능한 티키티킷 링크가 없어 사이트 행동을 글별로 나눌 수 없습니다.</p>
                                            )}
                                        </div>
                                        {post.attributionShared && (
                                            <small className={styles.threadsTrackingHint}>같은 공유 링크가 여러 Threads 글에 있어 이 숫자는 해당 글들에 함께 표시됩니다.</small>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    ) : !threadsInsightsError && (
                        <div className={styles.dealReviewEmpty}>불러온 Threads 글이 없습니다.</div>
                    )}
                </section>

                <section className={styles.section} id="threads-attribution">
                    <h2>Threads 링크별 사이트 이동</h2>
                    <p className={styles.sectionHelp}>Threads 출처를 우선 사용하고, 출처가 사라진 클릭은 글 속 공유 링크 코드로 자동 보완합니다. 같은 링크를 다른 채널에도 보냈다면 일부가 함께 잡힐 수 있습니다.</p>
                    {threadsInsights?.available && threadsInsights.attribution.rows.length > 0 ? (
                        <div className={styles.cityDetail}>
                            <table className={styles.cityTable}>
                                <thead><tr><th>추적 링크</th><th>방문</th><th>상세</th><th>예약 이동</th></tr></thead>
                                <tbody>
                                    {threadsInsights.attribution.rows.map(row => (
                                        <tr key={row.content}>
                                            <td>{row.content === '(not set)' ? '글 구분 없음' : row.content}</td>
                                            <td>{row.users.toLocaleString()}명 · {row.sessions.toLocaleString()}회</td>
                                            <td>{row.detailUsers.toLocaleString()}명 · {row.detailOpens.toLocaleString()}회</td>
                                            <td>{row.bookingUsers.toLocaleString()}명 · {row.bookingClicks.toLocaleString()}회</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className={styles.dealReviewEmpty}>Threads 추적 링크로 들어온 방문이 아직 없습니다.</div>
                    )}
                </section>
            </>)}

            {tab === 'visitors' && (<>
                <section className={styles.section} id="visitor-flow">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>방문 흐름 요약</h2>
                            <p>방문 → 상세 열람 → 예약 페이지 이동을 사람 수로 비교합니다.</p>
                        </div>
                    </div>
                    {gaStatsError ? (
                        <div className={styles.dealReviewEmpty}>{gaStatsError}</div>
                    ) : !gaStats?.available ? (
                        <div className={styles.dealReviewEmpty}>{gaStats?.message || '방문 통계를 불러오는 중입니다.'}</div>
                    ) : gaStats.activityPeriods ? (
                        <BehaviorSnapshot activity={gaStats.activityPeriods} />
                    ) : (
                        <div className={styles.dealReviewEmpty}>방문 행동을 계산하는 중입니다.</div>
                    )}
                </section>

                {gaStats?.available && (
                    <>
                        <section className={styles.section} id="visitor-trend">
                            <div className={styles.sectionHeading}>
                                <div>
                                    <h2>최근 30일 방문자 추이</h2>
                                    <p>오늘 현재까지 포함한 30일입니다. 각 막대 위에 그날 방문한 사람 수를 표시합니다.</p>
                                </div>
                            </div>
                            <div className={`${styles.signalGridFour} ${styles.trendSignals}`}>
                                <div className={styles.signalCard}>
                                    <span>최근 7일 방문자</span>
                                    <strong>{gaStats.periods.recent7.users.toLocaleString()}명</strong>
                                    <small>{comparisonText(gaStats.periods.recent7.users, gaStats.periods.previous7.users)}</small>
                                </div>
                                <div className={styles.signalCard}>
                                    <span>최근 30일 방문자</span>
                                    <strong>{gaStats.periods.current.users.toLocaleString()}명</strong>
                                    <small>{comparisonText(gaStats.periods.current.users, gaStats.periods.previous.users)}</small>
                                </div>
                                <div className={styles.signalCard}>
                                    <span>다시 온 사람 비율</span>
                                    <strong>{gaStats.returning.current.rate !== null ? `${gaStats.returning.current.rate}%` : '—'}</strong>
                                    <small>
                                        최근 30일 {gaStats.returning.current.returningUsers.toLocaleString()}명
                                        {gaStats.returning.previous.rate !== null ? ` · 직전 ${gaStats.returning.previous.rate}%` : ''}
                                    </small>
                                </div>
                                <div className={(gaStats.dateFilter.emptyRate || 0) >= 20 ? `${styles.signalCard} ${styles.signalCardWarn}` : styles.signalCard}>
                                    <span>날짜 선택 후 결과 없음</span>
                                    <strong>{gaStats.dateFilter.emptyRate !== null ? `${gaStats.dateFilter.emptyRate}%` : '—'}</strong>
                                    <small>{gaStats.dateFilter.picks.toLocaleString()}번 선택 중 {gaStats.dateFilter.emptyPicks.toLocaleString()}번</small>
                                </div>
                            </div>
                            <VisitorTrendChart trend={gaStats.trend} />
                        </section>

                        <section className={styles.section} id="visitor-hours">
                            <div className={styles.sectionHeading}>
                                <div>
                                    <h2>접속이 몰리는 시간</h2>
                                    <p>최근 7일과 최근 {gaStats.days}일의 피크 시간을 3시간 구간으로 비교합니다.</p>
                                </div>
                            </div>
                            {gaStats.hourlySessions ? (
                                <HourlySessionsComparison data={gaStats.hourlySessions} days={gaStats.days} />
                            ) : (
                                <div className={styles.dealReviewEmpty}>시간대별 접속을 아직 불러오지 못했습니다.</div>
                            )}
                        </section>

                        <section className={styles.section} id="visitor-segments">
                            <div className={styles.sectionHeading}>
                                <div>
                                    <h2>처음 온 사람과 다시 온 사람</h2>
                                    <p>최근 30일 동안 두 집단이 상세·예약·공유·알림 중 어디까지 갔는지 비교합니다.</p>
                                </div>
                            </div>
                            {gaStats.monitoring.behaviorAvailable ? (
                                <div className={styles.segmentGrid}>
                                    {([
                                        ['처음 온 사람', gaStats.monitoring.newUsers],
                                        ['다시 온 사람', gaStats.monitoring.returningUsers],
                                    ] as const).map(([label, segment]) => (
                                        <article key={label} className={styles.segmentCard}>
                                            <header><span>{label}</span><strong>{segment.users.toLocaleString()}명</strong></header>
                                            <dl>
                                                <div><dt>상세 열람</dt><dd>{segment.detailOpen.toLocaleString()}명 <small>{segment.detailOpenRate !== null ? `${segment.detailOpenRate}%` : '—'}</small></dd></div>
                                                <div><dt>예약 이동</dt><dd>{segment.bookingClick.toLocaleString()}명 <small>{segment.bookingClickRate !== null ? `${segment.bookingClickRate}%` : '—'}</small></dd></div>
                                                <div><dt>링크 복사</dt><dd>{segment.share.toLocaleString()}명 <small>{segment.shareRate !== null ? `${segment.shareRate}%` : '—'}</small></dd></div>
                                                <div><dt>알림 등록</dt><dd>{segment.alertSetup.toLocaleString()}명</dd></div>
                                            </dl>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <div className={styles.dealReviewEmpty}>신규·재방문 행동 구분을 위한 통계 설정이 아직 필요합니다.</div>
                            )}
                        </section>

                        <section className={styles.section} id="visitor-acquisition">
                            <div className={styles.sectionHeading}>
                                <div>
                                    <h2>어디서 와서 무엇을 눌렀나</h2>
                                    <p>긴 원본 표 대신 상위 5개만 보여드립니다.</p>
                                </div>
                            </div>
                            <div className={styles.analysisGrid}>
                                <div className={styles.analysisPanel}>
                                    <h3>들어온 경로</h3>
                                    <RankList items={(gaStats.channels || []).slice(0, 5).map(item => ({ label: item.label, value: `${item.users.toLocaleString()}명`, note: item.note ? `${item.note} · 방문 ${item.sessions.toLocaleString()}회` : `방문 ${item.sessions.toLocaleString()}회` }))} empty="유입 경로가 아직 없어요." />
                                </div>
                                <div className={styles.analysisPanel}>
                                    <h3>홍보글·캠페인</h3>
                                    <RankList items={(gaStats.campaigns || []).slice(0, 5).map(item => ({ label: item.label, value: `${item.users.toLocaleString()}명`, note: item.bookingClicks === null ? undefined : `예약 이동 ${item.bookingClicks.toLocaleString()}회` }))} empty="추적 링크로 들어온 방문이 아직 없어요." />
                                </div>
                                <div className={styles.analysisPanel}>
                                    <h3>예약 이동이 많은 노선</h3>
                                    <RankList items={(gaStats.bookingByRoute || []).slice(0, 5).map(item => ({ label: item.label, value: `${item.count.toLocaleString()}회` }))} empty="아직 예약 이동이 없어요." />
                                </div>
                                <div className={styles.analysisPanel}>
                                    <h3>예약 이동이 많은 여행사</h3>
                                    <RankList items={(gaStats.bookingByAgency || []).slice(0, 5).map(item => ({ label: SOURCE_NAMES[item.label] || item.label, value: `${item.count.toLocaleString()}회` }))} empty="아직 예약 이동이 없어요." />
                                </div>
                                <div className={styles.analysisPanel}>
                                    <h3>알림 등록을 시작한 위치</h3>
                                    <RankList items={(gaStats.alertByEntry || []).slice(0, 5).map(item => ({ label: item.label, value: `${item.count.toLocaleString()}회` }))} empty="알림 등록 위치가 아직 기록되지 않았어요." />
                                </div>
                                {(gaStats.referrals || []).length > 0 && (
                                    <div className={`${styles.analysisPanel} ${styles.analysisPanelWide}`}>
                                        <h3>외부 사이트에서 들어온 방문</h3>
                                        <RankList items={(gaStats.referrals || []).slice(0, 8).map(item => ({ label: item.label, value: `${item.users.toLocaleString()}명`, note: `방문 ${item.sessions.toLocaleString()}회` }))} />
                                    </div>
                                )}
                            </div>
                            {gaStats.warnings.length > 0 && (
                                <div className={styles.dataGap}>{gaStats.warnings.join(' · ')}</div>
                            )}
                            <div className={styles.openDisclosure}>
                                <h3>통계 설정과 내 방문 제외</h3>
                                <div className={styles.openDisclosureBody}>
                                    <p>실제 구매 완료와 매출은 여행사 제휴 정산 화면에서 따로 확인해야 합니다.</p>
                                    <a href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer">Google Analytics 열기 →</a>
                                    <button
                                        type="button"
                                        className={styles.analyticsToggle}
                                        onClick={() => {
                                            const next = !analyticsExcluded;
                                            setAnalyticsExcluded(next);
                                            setAnalyticsExcludedState(next);
                                        }}
                                    >
                                        {analyticsExcluded ? '이 브라우저 방문을 다시 포함하기' : '이 브라우저 방문 제외하기'}
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section className={styles.section} id="visitor-dates">
                            <div className={styles.sectionHeading}>
                                <div>
                                    <h2>사람들이 언제 떠나려 했나</h2>
                                    <p>검색 수요와 현재 항공권 공급이 어긋나는 구간을 찾는 데 쓰는 정보입니다.</p>
                                </div>
                            </div>
                            <div className={styles.donutGrid}>
                                <DonutBreakdown title="출발까지 남은 기간" items={gaStats.dateFilter.leadTime} />
                                <DonutBreakdown title="고른 여행 기간" items={gaStats.dateFilter.range} />
                                <DonutBreakdown title="날짜를 고른 방식" items={gaStats.dateFilter.method} />
                                <DonutBreakdown title="누른 빠른 선택" items={gaStats.dateFilter.presets} />
                            </div>
                            <p className={styles.dataFootnote}>2026년 8월 19일 이후 수집된 날짜 선택만 반영합니다.</p>
                        </section>
                    </>
                )}
            </>)}

            {tab === 'visitors' && (<div className={styles.legacyHidden} aria-hidden="true">
            <div className={styles.tabIntro}>
                <div>
                    <span className={styles.eyebrow}>마케팅</span>
                    <h2>사람들이 어디서 와서 예약 화면까지 갔는지 봅니다</h2>
                    <p>먼저 전체 흐름을 보고, 유입 경로와 어떤 항공권을 눌렀는지 차례로 내려가세요.</p>
                </div>
            </div>
            <SectionNav items={[
                { href: '#marketing-funnel', label: '방문→예약 흐름' },
                { href: '#marketing-interest', label: '무엇을 봤나' },
                { href: '#marketing-acquisition', label: '어디서 왔나' },
                { href: '#marketing-features', label: '어디서 눌렀나' },
                { href: '#marketing-dates', label: '날짜 필터' },
                { href: '#marketing-settings', label: '통계 설정' },
            ]} />
            {/* GA4 방문·행동 통계 — 여기서 보이면 GA4 사이트로 나갈 일이 줄어든다 */}
            <section className={styles.section} id="marketing-funnel">
                <h2>방문부터 여행사 예약 페이지 이동까지</h2>
                <p className={styles.sectionHelp}>
                    오늘은 현재까지 들어온 잠정 수치입니다. 최근 7일과 30일은 어제까지 완전히 끝난 날짜만 계산합니다.
                    예약 페이지 이동은 버튼을 눌러 여행사로 넘어간 행동이며 실제 결제 완료와는 다릅니다.
                </p>
                {gaStatsError ? (
                    <div className={styles.dealReviewEmpty}>{gaStatsError}</div>
                ) : !gaStats?.available ? (
                    <div className={styles.dealReviewEmpty}>
                        {gaStats?.message || '방문 통계를 불러오는 중입니다.'}
                    </div>
                ) : (
                    <>
                        {gaPeriodRows.length > 0 ? <PeriodTable rows={gaPeriodRows} /> : (
                            <div className={styles.dealReviewEmpty}>기간별 행동 통계를 준비하는 중입니다.</div>
                        )}
                        <div className={styles.userStatGrid}>
                            <div className={styles.userStat}>
                                <span>다시 온 사람의 비율</span>
                                <strong>{gaStats.returning.current.rate !== null ? `${gaStats.returning.current.rate}%` : '—'}</strong>
                                <small>최근 30일에 다시 방문한 사람 {gaStats.returning.current.returningUsers.toLocaleString()}명</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>방문 횟수</span>
                                <strong>{gaStats.totals.sessions.toLocaleString()}회</strong>
                                <small>최근 30일 · 페이지가 열린 횟수 {gaStats.totals.pageViews.toLocaleString()}회</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>한 사람당 방문 횟수</span>
                                <strong>{gaStats.monitoring.sessionsPerUser !== null ? `${gaStats.monitoring.sessionsPerUser}회` : '—'}</strong>
                                <small>최근 30일 평균</small>
                            </div>
                        </div>

                        <h3 className={styles.userSubTitle}>오늘 포함 최근 {gaStats.days}일 방문자 추이</h3>
                        {(() => {
                            const max = Math.max(...gaStats.trend.map(point => point.users), 1);
                            return (
                                <div className={styles.trendChart}>
                                    {gaStats.trend.map(point => (
                                        <div
                                            key={point.date}
                                            className={styles.trendCol}
                                            title={`${point.date} · 방문자 ${point.users}명 · 페이지 열림 ${point.pageViews}회`}
                                        >
                                            <div
                                                className={styles.trendBar}
                                                style={{ height: `${Math.max(2, (point.users / max) * 100)}%` }}
                                            />
                                            <span className={styles.trendCount}>{point.users || ''}</span>
                                            <span className={styles.trendDate}>{point.date.slice(5).replace('-', '/')}</span>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

                        <h3 className={styles.userSubTitle}>신규 방문자와 재방문자의 행동</h3>
                        {gaStats.monitoring.behaviorAvailable ? (
                            <div className={styles.cityDetail}>
                                <table className={styles.cityTable}>
                                    <thead>
                                        <tr><th>구분</th><th>사용자</th><th>상세 열람</th><th>예약 클릭</th><th>공유</th></tr>
                                    </thead>
                                    <tbody>
                                        {([
                                            ['신규 방문자', gaStats.monitoring.newUsers],
                                            ['재방문자', gaStats.monitoring.returningUsers],
                                        ] as const).map(([label, item]) => (
                                            <tr key={label}>
                                                <td>{label}</td>
                                                <td>{item.users.toLocaleString()}명</td>
                                                <td>{item.detailOpen.toLocaleString()}명{item.detailOpenRate !== null ? ` (${item.detailOpenRate}%)` : ''}</td>
                                                <td>{item.bookingClick.toLocaleString()}명{item.bookingClickRate !== null ? ` (${item.bookingClickRate}%)` : ''}</td>
                                                <td>{item.share.toLocaleString()}명{item.shareRate !== null ? ` (${item.shareRate}%)` : ''}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className={styles.dealReviewEmpty}>신규·재방문 행동 비교를 아직 불러오지 못했습니다.</div>
                        )}

                        <h3 className={styles.userSubTitle}>최근 {gaStats.days}일 주요 행동</h3>
                        <div className={styles.cityDetail}>
                            <table className={styles.cityTable}>
                                <thead>
                                    <tr><th>행동</th><th>횟수</th><th>사람</th><th>방문자 대비</th></tr>
                                </thead>
                                <tbody>
                                    {gaStats.events.length === 0 ? (
                                        <tr><td colSpan={4}>아직 집계된 행동이 없습니다.</td></tr>
                                    ) : gaStats.events.map(entry => (
                                        <tr key={entry.name}>
                                            <td><strong>{entry.label}</strong></td>
                                            <td>{entry.count.toLocaleString()}회</td>
                                            <td>{entry.users.toLocaleString()}명</td>
                                            <td>
                                                {gaStats.totals.users > 0
                                                    ? `${Math.round((entry.users / gaStats.totals.users) * 100)}%`
                                                    : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className={styles.gaColumns}>
                            <div id="marketing-interest">
                                <h3 className={styles.userSubTitle}>어느 여행사 예약 페이지로 갔나</h3>
                                {gaStats.bookingByAgency === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.bookingByAgency.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>아직 예약 클릭이 없습니다.</div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>여행사</th><th>클릭</th></tr></thead>
                                            <tbody>
                                                {gaStats.bookingByAgency.map(item => (
                                                    <tr key={item.label}>
                                                        <td>{SOURCE_NAMES[item.label] || item.label}</td>
                                                        <td>{item.count.toLocaleString()}회</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div id="marketing-acquisition">
                                <h3 className={styles.userSubTitle}>어디서 들어왔나 — 큰 분류</h3>
                                {gaStats.channels === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.channels.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>집계된 유입이 없습니다.</div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>경로</th><th>방문</th><th>사람</th></tr></thead>
                                            <tbody>
                                                {gaStats.channels.map(item => (
                                                    <tr key={item.label}>
                                                        <td>{item.label}</td>
                                                        <td>{item.sessions.toLocaleString()}회</td>
                                                        <td>{item.users.toLocaleString()}명</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className={styles.userSubTitle}>어느 외부 사이트에서 왔나</h3>
                                {gaStats.referrals === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.referrals.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>출처가 확인된 외부 링크 방문이 없습니다.</div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>사이트</th><th>방문</th><th>사람</th></tr></thead>
                                            <tbody>
                                                {gaStats.referrals.map(item => (
                                                    <tr key={item.source}>
                                                        <td>{item.label}</td>
                                                        <td>{item.sessions.toLocaleString()}회</td>
                                                        <td>{item.users.toLocaleString()}명</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                <p className={styles.gaHint}>
                                    게시판이 출처를 숨기지 않은 방문만 표시됩니다. 앞으로 홍보 링크에 UTM을 붙이면 아래 콘텐츠 표에서 예약 클릭까지 정확히 구분됩니다.
                                </p>
                            </div>

                            <div>
                                <h3 className={styles.userSubTitle}>어느 홍보글에서 왔나</h3>
                                {gaStats.campaigns === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.campaigns.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>추적 링크로 들어온 방문이 아직 없습니다.</div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>콘텐츠</th><th>방문</th><th>사람</th><th>예약 클릭</th></tr></thead>
                                            <tbody>
                                                {gaStats.campaigns.map(item => (
                                                    <tr key={`${item.name}-${item.source}`}>
                                                        <td>{item.label}</td>
                                                        <td>{item.sessions.toLocaleString()}회</td>
                                                        <td>{item.users.toLocaleString()}명</td>
                                                        <td>{item.bookingClicks === null ? '확인 불가' : `${item.bookingClicks.toLocaleString()}회`}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className={styles.userSubTitle}>예약 페이지 이동이 많은 노선</h3>
                                {gaStats.bookingByRoute === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.bookingByRoute.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>아직 예약 클릭이 없습니다.</div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>노선</th><th>클릭</th></tr></thead>
                                            <tbody>
                                                {gaStats.bookingByRoute.map(item => (
                                                    <tr key={item.label}>
                                                        <td>{item.label}</td>
                                                        <td>{item.count.toLocaleString()}회</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div id="marketing-features">
                                <h3 className={styles.userSubTitle}>항공권 상세를 어디에서 열었나</h3>
                                {gaStats.detailByEntry === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.detailByEntry.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>
                                        아직 집계 전입니다. <code>detail_open</code>은 2026-08-14부터 수집합니다.
                                    </div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                    <thead><tr><th>위치</th><th>열람</th></tr></thead>
                                            <tbody>
                                                {gaStats.detailByEntry.map(item => (
                                                    <tr key={item.label}>
                                                        <td>{item.label}</td>
                                                        <td>{item.count.toLocaleString()}회</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className={styles.userSubTitle}>알림 등록을 어디에서 시작했나</h3>
                                {gaStats.alertByEntry === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.alertByEntry.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>
                                        아직 집계 전입니다. <code>entry_point</code> 측정기준은 등록 이후 데이터부터 쌓입니다.
                                    </div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                    <thead><tr><th>위치</th><th>등록</th></tr></thead>
                                            <tbody>
                                                {gaStats.alertByEntry.map(item => (
                                                    <tr key={item.label}>
                                                        <td>{item.label}</td>
                                                        <td>{item.count.toLocaleString()}회</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 날짜 필터는 방문자가 가장 많이 쓰는 조작이라 따로 떼어 본다 */}
                        <h3 className={styles.userSubTitle} id="marketing-dates" style={{ marginTop: '24px' }}>
                            날짜 필터 — 사람들이 언제 떠나려 하나
                        </h3>
                        <p className={styles.sectionHelp}>
                            날짜를 고른 {gaStats.dateFilter.picks.toLocaleString()}회 중{' '}
                            {gaStats.dateFilter.emptyPicks.toLocaleString()}회는 표가 하나도 없었습니다
                            {gaStats.dateFilter.emptyRate !== null && ` (${gaStats.dateFilter.emptyRate}%)`}.
                            아래 표는 2026-08-19에 측정기준을 등록해 그 이후 데이터만 쌓입니다.
                        </p>
                        <div className={styles.userGrid}>
                            {([
                                { title: '출발까지 남은 기간', data: gaStats.dateFilter.leadTime, head: '기간' },
                                { title: '고른 기간 길이', data: gaStats.dateFilter.range, head: '길이' },
                                { title: '날짜를 고른 방식', data: gaStats.dateFilter.method, head: '방식' },
                                { title: '누른 빠른 선택 칩', data: gaStats.dateFilter.presets, head: '칩' },
                            ] as const).map(section => (
                                <div key={section.title}>
                                    <h3 className={styles.userSubTitle}>{section.title}</h3>
                                    {section.data === null ? (
                                        <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                    ) : section.data.length === 0 ? (
                                        <div className={styles.dealReviewEmpty}>아직 집계된 데이터가 없습니다.</div>
                                    ) : (
                                        <div className={styles.cityDetail}>
                                            <table className={styles.cityTable}>
                                                <thead><tr><th>{section.head}</th><th>선택</th></tr></thead>
                                                <tbody>
                                                    {section.data.map(item => (
                                                        <tr key={item.label}>
                                                            <td>{item.label}</td>
                                                            <td>{item.count.toLocaleString()}회</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {gaStats.otherEvents.length > 0 && (
                            <p className={styles.sectionHelp} style={{ marginTop: '16px' }}>
                                그 밖의 이벤트: {gaStats.otherEvents.map(entry => `${entry.name} ${entry.count.toLocaleString()}회`).join(' · ')}
                            </p>
                        )}

                        {gaStats.warnings.length > 0 && (
                            <div className={styles.dealReviewEmpty} style={{ marginTop: '16px' }}>
                                {gaStats.warnings.map(warning => <div key={warning}>⚠️ {warning}</div>)}
                            </div>
                        )}
                    </>
                )}
            </section>

            <section className={styles.section} id="marketing-settings">
                <h2>통계 설정</h2>
                <div className={styles.card}>
                    <p style={{ margin: 0, lineHeight: 1.7 }}>
                        이 화면은 Google Analytics 데이터를 쉬운 말로 바꿔 보여줍니다. 실제 구매 완료와 수익은 여행사 제휴 정산 화면에서 따로 확인해야 합니다.
                    </p>
                    <a href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '10px', color: '#7c3aed', fontWeight: 700 }}>
                        Google Analytics 열기 →
                    </a>
                    <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid #334155' }}>
                        <p style={{ margin: '0 0 10px', color: analyticsExcluded ? '#86efac' : '#fbbf24', fontWeight: 700 }}>
                            내 방문 통계: {analyticsExcluded ? '제외 중' : '포함 중'}
                        </p>
                        <p style={{ margin: '0 0 12px', color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.6 }}>
                            이 브라우저에서 발생하는 방문과 예약 클릭을 GA4에서 제외합니다. 다른 기기나 브라우저는 각각 설정해야 합니다.
                        </p>
                        <button
                            type="button"
                            className={styles.analyticsToggle}
                            onClick={() => {
                                const next = !analyticsExcluded;
                                setAnalyticsExcluded(next);
                                setAnalyticsExcludedState(next);
                            }}
                        >
                            {analyticsExcluded ? '내 방문 다시 포함하기' : '내 방문 제외하기'}
                        </button>
                    </div>
                </div>
            </section>
            </div>)}

            {tab === 'members' && (<>
                <div className={styles.tabIntro}>
                    <div>
                        <span className={styles.eyebrow}>회원</span>
                        <h2>로그인한 사용자가 무엇을 저장했는지 봅니다</h2>
                        <p>새 계정은 기간별로, 로그인·찜·최근 본 표·저장한 검색은 현재 남아 있는 수로 구분합니다.</p>
                    </div>
                </div>
                <SectionNav items={[
                    { href: '#members-new', label: '새 계정' },
                    { href: '#members-current', label: '현재 이용 현황' },
                ]} />
                <section className={styles.section} id="members-new">
                    <h2>새로 만든 계정</h2>
                    {userStatsError ? (
                        <div className={styles.dealReviewEmpty}>{userStatsError}</div>
                    ) : !userStats?.available ? (
                        <div className={styles.dealReviewEmpty}>{userStats?.message || '회원 통계를 불러오는 중입니다.'}</div>
                    ) : !userStats.summary.accountAvailable ? (
                        <div className={styles.dealReviewEmpty}>회원 정보를 불러오지 못했습니다.</div>
                    ) : (
                        <PeriodTable rows={[
                            {
                                label: '새 계정',
                                today: `${userStats.summary.accountsToday.toLocaleString()}개`,
                                recent7: `${userStats.summary.accountsLast7Days.toLocaleString()}개`,
                                recent30: `${userStats.summary.accountsLast30Days.toLocaleString()}개`,
                                note: '이메일 인증을 마치고 만들어진 계정입니다.',
                            },
                        ]} />
                    )}
                </section>
                <section className={styles.section} id="members-current">
                    <div className={styles.sectionHeading}>
                        <div>
                            <h2>현재 이용 현황</h2>
                            <p>기간 합계가 아니라 데이터베이스에 지금 남아 있는 수입니다.</p>
                        </div>
                        <span className={styles.nowBadge}>지금</span>
                    </div>
                    {userStats?.available && userStats.summary.accountAvailable ? (
                        <div className={styles.userStatGrid}>
                            <div className={styles.userStat}>
                                <span>전체 계정</span>
                                <strong>{userStats.summary.accounts.toLocaleString()}개</strong>
                            </div>
                            <div className={styles.userStat}>
                                <span>아직 만료되지 않은 로그인</span>
                                <strong>{userStats.summary.activeSessions.toLocaleString()}건</strong>
                                <small>한 사람이 여러 기기에서 로그인하면 여러 건으로 셉니다.</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>찜한 항공권</span>
                                <strong>{userStats.summary.favorites.toLocaleString()}개</strong>
                            </div>
                            <div className={styles.userStat}>
                                <span>최근 본 항공권 기록</span>
                                <strong>{userStats.summary.recentFlights.toLocaleString()}개</strong>
                                <small>최근 30일 조회수가 아니라 계정에 남아 있는 기록입니다.</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>저장한 검색 조건</span>
                                <strong>{userStats.summary.savedSearches.toLocaleString()}개</strong>
                            </div>
                        </div>
                    ) : (
                        <div className={styles.dealReviewEmpty}>
                            {userStatsError || (userStats && !userStats.available
                                ? userStats.message
                                : '회원 현황을 불러오는 중입니다.')}
                        </div>
                    )}
                </section>
            </>)}

            {tab === 'alerts' && (<>
            <div className={styles.tabIntro}>
                <div>
                    <span className={styles.eyebrow}>알림</span>
                    <h2>누가 어떤 표를 기다리고, 지금 보낼 만한 표가 있는지 봅니다</h2>
                    <p>알림 조건 수와 기기 수는 서로 다릅니다. 가격 조건을 맞춘 뒤 품질 기준까지 통과해야 실제 발송 후보가 됩니다.</p>
                </div>
            </div>
            <SectionNav items={[
                { href: '#alerts-current', label: '현재 알림' },
                { href: '#alerts-new', label: '새 알림' },
                { href: '#alerts-demand', label: '기다리는 노선' },
                { href: '#alerts-candidates', label: '발송 후보' },
            ]} />
            {/* 유저 통계 — 크롤링 현황과 별개로 "사람들이 무엇을 기다리는가"를 본다 */}
            <section className={styles.section} id="alerts-current">
                <h2>현재 알림 현황</h2>
                <p className={styles.sectionHelp}>
                    알림은 계정과 별개라 <strong>활성 알림을 하나 이상 가진 브라우저(기기) 수</strong>로 집계하며,
                    같은 사람이 폰과 PC에서 각각 켜면 2로 잡힙니다.
                    알림이 실제로 도착했는지와 열어봤는지는 아직 기록하지 않습니다.
                </p>
                {userStatsError ? (
                    <div className={styles.dealReviewEmpty}>{userStatsError}</div>
                ) : !userStats?.available ? (
                    <div className={styles.dealReviewEmpty}>
                        {userStats?.message || '유저 통계를 불러오는 중입니다.'}
                    </div>
                ) : (
                    <>
                        <div className={styles.userStatGrid}>
                            <div className={styles.userStat}>
                                <span>활성 알림이 있는 기기</span>
                                <strong>{userStats.summary.subscribers.toLocaleString()}</strong>
                                <small>지금까지 총 {userStats.summary.everSubscribed.toLocaleString()}대 (끈 기기 포함)</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>전체 활성 알림</span>
                                <strong>{userStats.summary.activeAlerts.toLocaleString()}</strong>
                                <small>기기당 평균 {userStats.summary.alertsPerSubscriber}개</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>한 번 이상 발송된 알림 조건</span>
                                <strong>{userStats.summary.notified.toLocaleString()}</strong>
                                <small>
                                    아직 한 번도 발송되지 않은 조건 {userStats.summary.neverNotified.toLocaleString()}개
                                </small>
                            </div>
                            <div className={styles.userStat}>
                                <span>노선을 정한 알림</span>
                                <strong>{userStats.summary.routeAlerts.toLocaleString()}개</strong>
                            </div>
                            <div className={styles.userStat}>
                                <span>목적지를 열어둔 특가 알림</span>
                                <strong>{userStats.summary.dealAlerts.toLocaleString()}개</strong>
                                <small>출발지·지역·예산만 정한 알림</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>끈 알림</span>
                                <strong>{userStats.summary.cancelledAlerts.toLocaleString()}</strong>
                                <small>
                                    전체의 {userStats.summary.activeAlerts + userStats.summary.cancelledAlerts > 0
                                        ? `${Math.round(userStats.summary.cancelledAlerts / (userStats.summary.activeAlerts + userStats.summary.cancelledAlerts) * 100)}%`
                                        : '0%'}
                                </small>
                            </div>
                        </div>

                        <h3 className={styles.userSubTitle} id="alerts-new">새로 만든 알림</h3>
                        <PeriodTable rows={[
                            {
                                label: '새 알림 조건',
                                today: `${userStats.summary.registrationsToday.toLocaleString()}개`,
                                recent7: `${userStats.summary.registrationsLast7Days.toLocaleString()}개`,
                                recent30: `${userStats.summary.registrationsLast30Days.toLocaleString()}개`,
                                note: '나중에 끈 알림도 처음 등록한 시점에는 새 알림으로 셉니다.',
                            },
                        ]} />
                        <h3 className={styles.userSubTitle}>최근 30일 일별 등록</h3>
                        {(() => {
                            const max = Math.max(...userStats.trend.map(t => t.count), 1);
                            return (
                                <div className={styles.trendChart}>
                                    {userStats.trend.map(point => (
                                        <div key={point.date} className={styles.trendCol} title={`${point.date} · ${point.count}건`}>
                                            <div
                                                className={styles.trendBar}
                                                style={{ height: `${Math.max(2, (point.count / max) * 100)}%` }}
                                            />
                                            <span className={styles.trendCount}>{point.count || ''}</span>
                                            <span className={styles.trendDate}>{point.date.slice(5).replace('-', '/')}</span>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

                        {/* 사용자가 기다리는 노선 — 크롤링 확대 우선순위와 직결 */}
                        <h3 className={styles.userSubTitle} id="alerts-demand">사용자가 기다리는 노선</h3>
                        {userStats.topRoutes.length === 0 ? (
                            <div className={styles.dealReviewEmpty}>등록된 노선 알림이 없습니다.</div>
                        ) : (
                            <div className={styles.cityDetail} style={{ overflowX: 'auto' }}>
                                <table className={styles.cityTable} style={{ minWidth: '460px' }}>
                                    <thead>
                                        <tr>
                                            <th>노선</th><th>알림</th><th>기기</th>
                                            <th>평균 목표가</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {userStats.topRoutes.map(route => (
                                            <tr key={route.route}>
                                                <td><strong>{route.route}</strong></td>
                                                <td>{route.count}건</td>
                                                <td>{route.devices}대</td>
                                                <td>{route.avgTarget !== null ? formatPrice(route.avgTarget) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {userStats.topRegions.length > 0 && (
                            <>
                                <h3 className={styles.userSubTitle}>목적지를 정하지 않은 특가 알림</h3>
                                <div className={styles.cityDetail}>
                                    <table className={styles.cityTable}>
                                        <thead>
                                            <tr><th>조건</th><th>알림</th><th>기기</th><th>평균 목표가</th></tr>
                                        </thead>
                                        <tbody>
                                            {userStats.topRegions.map(region => (
                                                <tr key={region.label}>
                                                    <td>{region.label}</td>
                                                    <td>{region.count}건</td>
                                                    <td>{region.devices}대</td>
                                                    <td>{region.avgTarget !== null ? formatPrice(region.avgTarget) : '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </>
                )}
            </section>

            <section className={styles.section} id="alerts-candidates">
                <div className={styles.dealReviewHeader}>
                    <div>
                        <h2>특가 알림 발송 전 확인</h2>
                        <p>
                            먼저 출발지·지역·예산에 맞는 표를 찾고, 그중 가격 근거와 신선도까지 좋은 표만 발송 후보로 남깁니다.
                            현재는 테스트 단계라 실제 알림은 보내지 않습니다.
                        </p>
                    </div>
                    <span className={styles.dryRunBadge}>테스트 중 · 실제 발송 없음</span>
                </div>

                {dealAlertReviewError ? (
                    <div className={styles.dealReviewEmpty}>{dealAlertReviewError}</div>
                ) : !dealAlertReview?.available ? (
                    <div className={styles.dealReviewEmpty}>
                        {dealAlertReview?.message || '조건형 알림 정보를 불러오는 중입니다.'}
                    </div>
                ) : (
                    <>
                        <div className={styles.dealReviewSummary}>
                            <div><span>목적지를 열어둔 알림</span><strong>{dealAlertReview.subscriptions}개</strong></div>
                            <div><span>발송 품질 기준</span><strong>{dealAlertReview.scoreThreshold}점 이상</strong></div>
                            <div><span>실제로 보낼 만한 표</span><strong>{dealAlertReview.qualifiedCandidates}개</strong></div>
                            <div><span>마지막 계산</span><strong>{formatKST(dealAlertReview.generatedAt).replace(/\d{4}\. /, '')}</strong></div>
                        </div>

                        {dealAlertReview.reviews.length === 0 ? (
                            <div className={styles.dealReviewEmpty}>
                                아직 등록된 조건형 특가 알림이 없습니다. 사이트에서 베타 조건을 등록하면 이곳에 후보가 나타납니다.
                            </div>
                        ) : (
                            <div className={styles.dealReviewList}>
                                {dealAlertReview.reviews.map(review => (
                                    <article key={review.condition.id} className={styles.dealReviewCard}>
                                        <div className={styles.dealReviewCondition}>
                                            <div>
                                                <strong>
                                                    {review.condition.departureCity} 출발 · {review.condition.region === 'all' ? '아무데나' : review.condition.region}
                                                </strong>
                                                <span>{formatPrice(review.condition.maxPrice)} 이하</span>
                                            </div>
                                            <span>
                                                {review.qualifiedCount > 0
                                                    ? `품질 기준 통과 ${review.qualifiedCount}개`
                                                    : '지금은 보낼 특가 없음'}
                                            </span>
                                        </div>

                                        {review.candidates.length > 0 ? (
                                            <div className={styles.dealCandidateList}>
                                                {review.candidates.map(candidate => (
                                                    <a
                                                        key={candidate.flightId}
                                                        href={`/share/${encodeURIComponent(candidate.flightId)}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className={styles.dealCandidate}
                                                    >
                                                        <div>
                                                            <strong>{candidate.departureCity} → {candidate.arrivalCity}</strong>
                                                            <span>{candidate.departureDate} ~ {candidate.returnDate} · {candidate.airline}</span>
                                                            <small>{candidate.reasons.join(' · ')}</small>
                                                        </div>
                                                        <div>
                                                            <em>품질 점수 {candidate.score}점</em>
                                                            <strong>{formatPrice(candidate.effectivePrice)}</strong>
                                                            <span>{SOURCE_NAMES[candidate.source] || candidate.source}{candidate.feeNote ? ` · ${candidate.feeNote}` : ''}</span>
                                                        </div>
                                                    </a>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className={styles.dealReviewEmpty}>지금 항공권 중에는 이 조건으로 보낼 만한 특가가 없습니다.</div>
                                        )}

                                        {Object.values(review.rejectionCounts).some(count => count > 0) && (
                                            <div className={styles.dealRejections}>
                                                <span className={styles.dealRejectionsLabel}>제외된 항공권과 이유:</span>
                                                {Object.entries(review.rejectionCounts)
                                                    .filter(([, count]) => count > 0)
                                                    .map(([reason, count]) => (
                                                        <span key={reason}>{DEAL_REJECTION_LABELS[reason] || reason} {count}건</span>
                                                    ))}
                                            </div>
                                        )}
                                    </article>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </section>
            </>)}

        </div>
    );
}
