import { NextRequest, NextResponse } from 'next/server';
import { ga4Config, runReport, eventNameFilter, dim, num, type Ga4Config, type ReportResponse } from '@/lib/ga4';

// 저장소가 공개라 코드에 박아 둔 기본값은 그대로 공개 열쇠가 된다.
// 환경변수가 없으면 조용히 열리는 대신 인증을 전부 거부한다.
const ADMIN_KEY = process.env.ADMIN_KEY;
const DEFAULT_DAYS = 30;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** 어드민에서 의미 있는 이벤트만 골라 한국어 이름을 붙인다. */
const EVENT_LABELS: Record<string, string> = {
    booking_click: '예약 클릭',
    detail_open: '항공권 상세 열기',
    alert_setup: '가격 알림 등록',
    deal_alert_setup: '조건형 알림 등록',
    blog_flight_link_open: '블로그 항공권 링크 열기',
    blog_alert_link_open: '블로그 특가 알림 링크 열기',
    // 2026-08-14에 중단. 그전까지 카드 본문 클릭은 아무 동작도 하지 않았으므로 헛클릭 지표였다
    card_click: '카드 빈 곳 클릭 (8/14 이전, 반응 없던 클릭)',
    compare_click: '네이버 가격비교 열기',
    compare_outbound_click: '네이버로 이동',
    hotel_compare_click: '호텔 비교 클릭',
    share_flight: '공유',
    filter_change: '필터 변경',
    date_filter: '날짜 필터',
    date_filter_empty: '날짜 필터 — 결과 0건',
    account_open: '내 여행 열기',
    login_code_requested: '로그인 인증번호 요청',
    account_login: '로그인 완료',
    saved_search_create: '검색 조건 저장',
    saved_search_apply: '저장한 검색 다시 보기',
    account_logout: '로그아웃',
    account_delete: '계정 삭제',
};

/** detail_open / alert_setup의 `entry_point` 값 — 어느 화면에서 시작했는지 */
const ENTRY_LABELS: Record<string, string> = {
    card_body: '카드 본문',
    book_button: '카드의 예약 버튼',
    discovery_bar: '여행지 발견 바',
    shared_link: '공유 링크',
    today_pick: '오늘의 표',
};

const CHANNEL_LABELS: Record<string, string> = {
    'Organic Search': '검색',
    'Direct': '직접 방문',
    'Referral': '외부 링크',
    'Organic Social': 'SNS',
    'Paid Search': '검색 광고',
    'Email': '이메일',
    'Unassigned': '출처 확인 불가',
};

const UNSET_DIMENSION_VALUES = new Set(['', '(not set)', '(값 없음)', '(none)']);
const isUnsetDimension = (value: string) => UNSET_DIMENSION_VALUES.has(value.trim().toLowerCase());

const inferChannelFromSource = (sourceValue: string, mediumValue: string): string | null => {
    const source = sourceValue.trim().toLowerCase();
    const medium = mediumValue.trim().toLowerCase();
    if (source === '(direct)' && (medium === '(none)' || medium === '(not set)')) return '직접 방문';
    if (['google', 'naver', 'bing', 'daum'].some(value => source.includes(value))) return '검색';
    if (['instagram', 'threads', 'facebook', 'twitter', 'x.com', 't.co'].some(value => source.includes(value))) return 'SNS';
    if (isUnsetDimension(source)) return null;
    if (isUnsetDimension(medium)) return '기타 유입';
    if (medium.includes('organic')) return '검색';
    if (medium === 'referral') return '외부 링크';
    if (medium.includes('social')) return 'SNS';
    if (['cpc', 'ppc', 'paidsearch', 'paid_search'].includes(medium)) return '검색 광고';
    if (medium === 'email') return '이메일';
    return '기타 유입';
};

interface CachedPayload { at: number; days: number; body: unknown }
let cache: CachedPayload | null = null;

async function optional(
    label: string,
    warnings: string[],
    task: () => Promise<ReportResponse>,
): Promise<ReportResponse | null> {
    try {
        return await task();
    } catch (error) {
        // 맞춤 측정기준이 아직 등록되지 않았으면 이 리포트만 실패한다 — 전체를 죽이지 않는다
        console.error(`GA4 optional report failed (${label}):`, error);
        warnings.push(`${label}은(는) 불러오지 못했습니다. 방문 통계의 세부 항목 설정을 확인해주세요.`);
        return null;
    }
}

async function buildStats(config: Ga4Config, days: number) {
    // 7일·30일 수치는 아직 덜 쌓인 오늘을 빼고 어제까지의 완결된 날짜만 쓴다.
    // 오늘은 별도 열의 잠정 수치와 일별 추이의 마지막 막대에서 보여준다.
    const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }];
    const trendDateRanges = [{ startDate: `${days - 1}daysAgo`, endDate: 'today' }];
    const previousDateRanges = [{ startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` }];
    const recent7DateRanges = [{ startDate: '7daysAgo', endDate: 'yesterday' }];
    const previous7DateRanges = [{ startDate: '14daysAgo', endDate: '8daysAgo' }];
    const todayDateRanges = [{ startDate: 'today', endDate: 'today' }];
    const warnings: string[] = [];

    const summaryRequest = (range: Array<{ startDate: string; endDate: string }>) => runReport(config, {
        dateRanges: range,
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'sessions' }],
    });

    const eventRequest = (range: Array<{ startDate: string; endDate: string }>) => runReport(config, {
        dateRanges: range,
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 50,
    });

    // 일반 가격 알림과 여행지를 열어둔 특가 알림을 둘 다 성공한 사람 수.
    // 이벤트별 사용자를 단순히 더하면 같은 사람이 중복될 수 있어 OR 필터로 한 번에 세다.
    const alertIntentRequest = (range: Array<{ startDate: string; endDate: string }>) => runReport(config, {
        dateRanges: range,
        metrics: [{ name: 'totalUsers' }],
        dimensionFilter: {
            orGroup: {
                expressions: ['alert_setup', 'deal_alert_setup'].map(eventName => eventNameFilter(eventName)),
            },
        },
    });

    const returningRequest = (range: Array<{ startDate: string; endDate: string }>) => runReport(config, {
        dateRanges: range,
        dimensions: [{ name: 'newVsReturning' }],
        metrics: [{ name: 'activeUsers' }],
    });

    // 핵심 2개는 실패하면 그대로 에러 — 표준 측정기준만 쓰므로 실패 = 설정 문제
    const [
        trendReport,
        eventReport,
        recent7EventReport,
        todayEventReport,
        currentAlertIntentReport,
        recent7AlertIntentReport,
        todayAlertIntentReport,
        currentReport,
        previousReport,
        recent7Report,
        previous7Report,
        todayReport,
        returningReport,
        previousReturningReport,
        todayReturningReport,
    ] = await Promise.all([
        runReport(config, {
            dateRanges: trendDateRanges,
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'sessions' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
            metricAggregations: ['TOTAL'],
            keepEmptyRows: true,
            limit: days,
        }),
        eventRequest(dateRanges),
        eventRequest(recent7DateRanges),
        eventRequest(todayDateRanges),
        alertIntentRequest(dateRanges),
        alertIntentRequest(recent7DateRanges),
        alertIntentRequest(todayDateRanges),
        summaryRequest(dateRanges),
        summaryRequest(previousDateRanges),
        summaryRequest(recent7DateRanges),
        summaryRequest(previous7DateRanges),
        summaryRequest(todayDateRanges),
        returningRequest(dateRanges),
        returningRequest(previousDateRanges),
        returningRequest(todayDateRanges),
    ]);

    const [agencyReport, routeReport, entryReport, detailEntryReport, channelReport, unassignedChannelReport, referralReport, campaignTrafficReport, campaignBookingReport, leadTimeReport, rangeReport, dateMethodReport, presetReport, repeatBehaviorReport, todayRouteReport, todayAcquisitionReport] = await Promise.all([
        optional('여행사별 예약 클릭', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'customEvent:travel_agency' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: eventNameFilter('booking_click'),
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: 20,
        })),
        optional('노선별 예약 클릭', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'customEvent:route' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: eventNameFilter('booking_click'),
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: 15,
        })),
        optional('알림 등록 진입점', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'customEvent:entry_point' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: eventNameFilter('alert_setup'),
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: 15,
        })),
        optional('상세 열기 진입점', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'customEvent:entry_point' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: eventNameFilter('detail_open'),
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: 15,
        })),
        optional('유입 경로', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'sessionDefaultChannelGroup' }],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 12,
        })),
        optional('출처 확인 불가 원인', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'sessionSource' }, { name: 'sessionMedium' }],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
            dimensionFilter: {
                filter: {
                    fieldName: 'sessionDefaultChannelGroup',
                    stringFilter: { value: 'Unassigned', matchType: 'EXACT', caseSensitive: false },
                },
            },
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 50,
        })),
        optional('외부 유입 사이트', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'sessionSource' }],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
            dimensionFilter: {
                filter: {
                    fieldName: 'sessionMedium',
                    stringFilter: { value: 'referral', matchType: 'EXACT', caseSensitive: false },
                },
            },
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 30,
        })),
        optional('콘텐츠별 유입', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'sessionCampaignName' }, { name: 'sessionSource' }],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 50,
        })),
        optional('콘텐츠별 예약 클릭', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'sessionCampaignName' }, { name: 'sessionSource' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: eventNameFilter('booking_click'),
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: 50,
        })),
        // 날짜 필터를 쓴 사람들이 언제 떠나려는지 — 2026-08-19에 측정기준을 등록해 그 이후 데이터만 있다
        optional('출발까지 남은 일수', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'customEvent:days_from_now' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: eventNameFilter('date_filter'),
            limit: 200,
        })),
        optional('선택한 기간 길이', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'customEvent:range_days' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: eventNameFilter('date_filter'),
            limit: 200,
        })),
        optional('날짜 선택 방식', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'customEvent:filter_method' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: eventNameFilter('date_filter'),
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: 10,
        })),
        optional('누른 날짜 칩', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'customEvent:preset_label' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: eventNameFilter('date_filter'),
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: 15,
        })),
        optional('신규·재방문 행동 비교', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'newVsReturning' }, { name: 'eventName' }],
            metrics: [{ name: 'totalUsers' }],
            dimensionFilter: {
                orGroup: {
                    expressions: ['detail_open', 'booking_click', 'share_flight', 'alert_setup']
                        .map(eventName => eventNameFilter(eventName)),
                },
            },
            limit: 20,
        })),
        optional('오늘 많이 본 노선', warnings, () => runReport(config, {
            dateRanges: todayDateRanges,
            dimensions: [{ name: 'customEvent:route' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: eventNameFilter('detail_open'),
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: 8,
        })),
        optional('오늘 유입 경로', warnings, () => runReport(config, {
            dateRanges: todayDateRanges,
            dimensions: [
                { name: 'sessionDefaultChannelGroup' },
                { name: 'sessionSource' },
                { name: 'sessionMedium' },
            ],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 50,
        })),
    ]);

    // GA4는 방문이 0인 날짜를 종종 행 자체에서 빼므로, 그래프가 오늘까지 정확히 30칸이 되도록 채운다.
    const trendByDate = new Map((trendReport.rows || []).map(row => {
        const raw = dim(row);
        const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        return [date, {
            date,
            users: num(row, 0),
            pageViews: num(row, 1),
            sessions: num(row, 2),
        }] as const;
    }));
    const kstNow = new Date(Date.now() + (9 * 60 * 60 * 1000));
    const trendEndUtc = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());
    const trend = Array.from({ length: days }, (_, index) => {
        const date = new Date(trendEndUtc - ((days - 1 - index) * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
        return trendByDate.get(date) || { date, users: 0, pageViews: 0, sessions: 0 };
    });

    const summary = (report: ReportResponse) => ({
        users: num(report.rows?.[0], 0),
        pageViews: num(report.rows?.[0], 1),
        sessions: num(report.rows?.[0], 2),
    });
    const totals = summary(currentReport);

    const returning = (report: ReportResponse) => {
        const rows = report.rows || [];
        const newUsers = rows.find(row => dim(row).toLowerCase() === 'new');
        const returningUsers = rows.find(row => dim(row).toLowerCase() === 'returning');
        const newCount = num(newUsers, 0);
        const returningCount = num(returningUsers, 0);
        const classified = newCount + returningCount;
        return {
            newUsers: newCount,
            returningUsers: returningCount,
            rate: classified > 0 ? Number(((returningCount / classified) * 100).toFixed(1)) : null,
        };
    };

    const parseEvents = (report: ReportResponse) => (report.rows || [])
        .map(row => ({
            name: dim(row),
            label: EVENT_LABELS[dim(row)] || dim(row),
            count: num(row, 0),
            users: num(row, 1),
            known: dim(row) in EVENT_LABELS,
        }))
        .filter(entry => entry.known || entry.count > 0);

    const events = parseEvents(eventReport);

    const activity = (
        report: ReportResponse,
        periodSummary: ReturnType<typeof summary>,
        alertIntentReport: ReportResponse,
    ) => {
        const periodEvents = parseEvents(report);
        const usersOf = (name: string) => periodEvents.find(entry => entry.name === name)?.users ?? 0;
        const detailOpenUsers = usersOf('detail_open');
        const bookingClickUsers = usersOf('booking_click');
        const routeAlertSetupUsers = usersOf('alert_setup');
        const dealAlertSetupUsers = usersOf('deal_alert_setup');
        const alertSetupUsers = num(alertIntentReport.rows?.[0], 0);
        const shareUsers = usersOf('share_flight');
        const visitorRate = (value: number) => periodSummary.users > 0
            ? Number(((value / periodSummary.users) * 100).toFixed(1))
            : null;
        return {
            visitors: periodSummary.users,
            detailOpenUsers,
            bookingClickUsers,
            alertSetupUsers,
            routeAlertSetupUsers,
            dealAlertSetupUsers,
            shareUsers,
            detailOpenRate: visitorRate(detailOpenUsers),
            bookingClickRate: visitorRate(bookingClickUsers),
            alertSetupRate: visitorRate(alertSetupUsers),
            detailToBookingRate: detailOpenUsers > 0
                ? Number(((bookingClickUsers / detailOpenUsers) * 100).toFixed(1))
                : null,
        };
    };

    const bookingClick = events.find(entry => entry.name === 'booking_click');
    const detailOpen = events.find(entry => entry.name === 'detail_open');
    const alertSetup = events.find(entry => entry.name === 'alert_setup');
    const rate = (value: number) => (totals.users > 0 ? Number(((value / totals.users) * 100).toFixed(1)) : null);

    const repeatGroups = {
        new: { users: returning(returningReport).newUsers, detailOpen: 0, bookingClick: 0, share: 0, alertSetup: 0 },
        returning: { users: returning(returningReport).returningUsers, detailOpen: 0, bookingClick: 0, share: 0, alertSetup: 0 },
    };
    (repeatBehaviorReport?.rows || []).forEach(row => {
        const group = dim(row).toLowerCase() as keyof typeof repeatGroups;
        if (!(group in repeatGroups)) return;
        const eventName = dim(row, 1);
        const key = ({
            detail_open: 'detailOpen',
            booking_click: 'bookingClick',
            share_flight: 'share',
            alert_setup: 'alertSetup',
        } as const)[eventName];
        if (key) repeatGroups[group][key] = num(row, 0);
    });
    const behavior = (group: typeof repeatGroups.new) => ({
        ...group,
        detailOpenRate: group.users > 0 ? Number(((group.detailOpen / group.users) * 100).toFixed(1)) : null,
        bookingClickRate: group.users > 0 ? Number(((group.bookingClick / group.users) * 100).toFixed(1)) : null,
        shareRate: group.users > 0 ? Number(((group.share / group.users) * 100).toFixed(1)) : null,
    });

    const list = (report: ReportResponse | null, labels?: Record<string, string>, fallbackLabel = '(값 없음)') =>
        report === null ? null : (report.rows || []).map(row => ({
            label: labels?.[dim(row)] || dim(row) || fallbackLabel,
            count: num(row, 0),
        }));

    const campaignLabel = (name: string) => {
        if (name === 'tikitikit_user_share') return '사용자 공유 항공권';
        const drop = name.match(/^tikitikit_drop_(\d+)$/);
        return drop ? `티키티킷 드롭 ${Number(drop[1])}` : name;
    };
    const contentSourceLabel = (source: string) => ({
        naver_blog: '네이버 블로그',
        travel_community: '여행 커뮤니티',
        te31: 'TE31',
        user_share: '사용자 공유',
    }[source] || source);
    const referralSourceLabel = (source: string) => {
        const normalized = source.toLowerCase().replace(/^www\./, '');
        if (normalized === 'te31.com') return 'TE31';
        return source || '(출처 없음)';
    };
    const todayChannels = (() => {
        if (todayAcquisitionReport === null) return null;
        const grouped = new Map<string, { label: string; sessions: number; users: number }>();
        (todayAcquisitionReport.rows || []).forEach(row => {
            const rawChannel = dim(row);
            const label = rawChannel === 'Unassigned' || isUnsetDimension(rawChannel)
                ? inferChannelFromSource(dim(row, 1), dim(row, 2)) || '출처 확인 불가'
                : CHANNEL_LABELS[rawChannel] || rawChannel;
            const previous = grouped.get(label);
            grouped.set(label, {
                label,
                sessions: (previous?.sessions || 0) + num(row, 0),
                users: (previous?.users || 0) + num(row, 1),
            });
        });
        return Array.from(grouped.values()).sort((a, b) => b.sessions - a.sessions);
    })();
    const todayReferrals = todayAcquisitionReport === null ? null : (todayAcquisitionReport.rows || [])
        .filter(row => dim(row, 2).toLowerCase() === 'referral' && !isUnsetDimension(dim(row, 1)))
        .map(row => ({
            source: dim(row, 1),
            label: referralSourceLabel(dim(row, 1)),
            sessions: num(row, 0),
            users: num(row, 1),
        }))
        .sort((a, b) => b.sessions - a.sessions);
    const campaignBookings = new Map(
        (campaignBookingReport?.rows || []).map(row => [`${dim(row)}|${dim(row, 1)}`, num(row, 0)]),
    );
    const campaigns = campaignTrafficReport === null ? null : (campaignTrafficReport.rows || [])
        .map(row => {
            const name = dim(row);
            const source = dim(row, 1);
            return {
                name,
                source,
                label: `${campaignLabel(name)} · ${contentSourceLabel(source)}`,
                sessions: num(row, 0),
                users: num(row, 1),
                bookingClicks: campaignBookingReport === null ? null : (campaignBookings.get(`${name}|${source}`) || 0),
            };
        })
        .filter(item => item.name.startsWith('tikitikit_'));

    // 며칠 뒤 출발인지를 그대로 나열하면 90줄이 되므로 읽을 수 있는 구간으로 묶는다.
    // `(not set)` 같은 비수치 값은 버린다 — 측정기준 등록 전 데이터가 이렇게 들어온다.
    const bucketize = (
        report: ReportResponse | null,
        buckets: Array<{ label: string; max: number }>,
    ) => {
        if (report === null) return null;
        const totals = new Map(buckets.map(b => [b.label, 0]));
        let counted = 0;
        (report.rows || []).forEach(row => {
            const value = Number(dim(row));
            if (!Number.isFinite(value)) return;
            const bucket = buckets.find(b => value <= b.max) || buckets[buckets.length - 1];
            totals.set(bucket.label, (totals.get(bucket.label) || 0) + num(row, 0));
            counted += num(row, 0);
        });
        if (counted === 0) return [];
        return buckets.map(b => ({ label: b.label, count: totals.get(b.label) || 0 }));
    };

    const measured = (items: Array<{ label: string; count: number }> | null) =>
        items === null ? null : items.filter(item => !isUnsetDimension(item.label));

    const channels = (() => {
        if (channelReport === null) return null;
        const grouped = new Map<string, { label: string; sessions: number; users: number; note?: string }>();
        const add = (label: string, sessions: number, users: number, note?: string) => {
            const previous = grouped.get(label);
            grouped.set(label, {
                label,
                sessions: (previous?.sessions || 0) + sessions,
                users: (previous?.users || 0) + users,
                note: previous?.note || note,
            });
        };

        let rawUnassignedSessions = 0;
        let rawUnassignedUsers = 0;
        (channelReport.rows || []).forEach(row => {
            const rawChannel = dim(row);
            if (rawChannel === 'Unassigned' || isUnsetDimension(rawChannel)) {
                rawUnassignedSessions += num(row, 0);
                rawUnassignedUsers += num(row, 1);
                return;
            }
            add(CHANNEL_LABELS[rawChannel] || rawChannel, num(row, 0), num(row, 1));
        });

        if (rawUnassignedSessions > 0) {
            if (unassignedChannelReport === null || !(unassignedChannelReport.rows || []).length) {
                add('출처 확인 불가', rawUnassignedSessions, rawUnassignedUsers, '브라우저·앱에서 출처 정보가 전달되지 않음');
            } else {
                const inferredBuckets = new Map<string, { sessions: number; note?: string }>();
                (unassignedChannelReport.rows || []).forEach(row => {
                    const label = inferChannelFromSource(dim(row, 1), dim(row, 2)) || '출처 확인 불가';
                    const previous = inferredBuckets.get(label);
                    inferredBuckets.set(label, {
                        sessions: (previous?.sessions || 0) + num(row, 0),
                        note: label === '출처 확인 불가' ? '브라우저·앱에서 출처 정보가 전달되지 않음' : undefined,
                    });
                });
                const buckets = Array.from(inferredBuckets.entries());
                const detailSessions = buckets.reduce((sum, [, bucket]) => sum + bucket.sessions, 0);
                let remainingSessions = rawUnassignedSessions;
                let remainingUsers = rawUnassignedUsers;
                buckets.forEach(([label, bucket], index) => {
                    const isLast = index === buckets.length - 1;
                    const ratio = detailSessions > 0 ? bucket.sessions / detailSessions : 0;
                    const sessions = isLast ? remainingSessions : Math.min(remainingSessions, Math.round(rawUnassignedSessions * ratio));
                    const users = isLast ? remainingUsers : Math.min(remainingUsers, Math.round(rawUnassignedUsers * ratio));
                    add(label, sessions, users, bucket.note);
                    remainingSessions -= sessions;
                    remainingUsers -= users;
                });
                if (buckets.length === 0) {
                    add('출처 확인 불가', rawUnassignedSessions, rawUnassignedUsers, '브라우저·앱에서 출처 정보가 전달되지 않음');
                }
            }
        }

        return Array.from(grouped.values()).sort((a, b) => b.sessions - a.sessions);
    })();

    const dateFilterEmpty = events.find(entry => entry.name === 'date_filter_empty');
    const dateFilter = events.find(entry => entry.name === 'date_filter');

    return {
        available: true,
        generatedAt: new Date().toISOString(),
        days,
        totals,
        periods: {
            today: summary(todayReport),
            recent7: summary(recent7Report),
            previous7: summary(previous7Report),
            current: totals,
            previous: summary(previousReport),
        },
        activityPeriods: {
            today: activity(todayEventReport, summary(todayReport), todayAlertIntentReport),
            recent7: activity(recent7EventReport, summary(recent7Report), recent7AlertIntentReport),
            current: activity(eventReport, totals, currentAlertIntentReport),
        },
        todayOverview: {
            audience: returning(todayReturningReport),
            savedSearchUsers: parseEvents(todayEventReport)
                .find(entry => entry.name === 'saved_search_create')?.users ?? 0,
            topRoutes: measured(list(todayRouteReport)),
            channels: todayChannels,
            referrals: todayReferrals,
        },
        returning: {
            current: returning(returningReport),
            previous: returning(previousReturningReport),
        },
        monitoring: {
            recent7Share: totals.users > 0
                ? Number(((summary(recent7Report).users / totals.users) * 100).toFixed(1))
                : null,
            sessionsPerUser: totals.users > 0
                ? Number((totals.sessions / totals.users).toFixed(2))
                : null,
            behaviorAvailable: repeatBehaviorReport !== null,
            newUsers: behavior(repeatGroups.new),
            returningUsers: behavior(repeatGroups.returning),
        },
        trend,
        events: events.filter(entry => entry.known),
        otherEvents: events.filter(entry => !entry.known && !['page_view', 'session_start', 'first_visit', 'user_engagement', 'scroll', 'affiliate_click'].includes(entry.name)),
        conversion: {
            detailOpenUsers: detailOpen?.users ?? 0,
            detailOpenRate: rate(detailOpen?.users ?? 0),
            bookingClickUsers: bookingClick?.users ?? 0,
            // 전체 성과의 핵심 지표 — 방문자 중 몇 %가 여행사 예약 페이지로 이동했는지
            bookingClickRate: rate(bookingClick?.users ?? 0),
            // 상세 화면의 설득력을 보는 보조 지표
            detailToBookingRate: detailOpen?.users
                ? Number((((bookingClick?.users ?? 0) / detailOpen.users) * 100).toFixed(1))
                : null,
            alertSetupUsers: alertSetup?.users ?? 0,
            alertSetupRate: rate(alertSetup?.users ?? 0),
        },
        bookingByAgency: measured(list(agencyReport)),
        bookingByRoute: measured(list(routeReport)),
        alertByEntry: measured(list(entryReport, ENTRY_LABELS)),
        detailByEntry: measured(list(detailEntryReport, ENTRY_LABELS)),
        channels,
        referrals: referralReport === null ? null : (referralReport.rows || []).map(row => ({
            source: dim(row),
            label: referralSourceLabel(dim(row)),
            sessions: num(row, 0),
            users: num(row, 1),
        })),
        campaigns,
        dateFilter: {
            picks: dateFilter?.count ?? 0,
            emptyPicks: dateFilterEmpty?.count ?? 0,
            // 고른 날짜에 표가 하나도 없던 비율 — 달력 표시가 잘 먹는지 보는 지표
            emptyRate: dateFilter?.count
                ? Number((((dateFilterEmpty?.count ?? 0) / dateFilter.count) * 100).toFixed(1))
                : null,
            leadTime: bucketize(leadTimeReport, [
                { label: '3일 이내', max: 3 },
                { label: '4~7일', max: 7 },
                { label: '1~2주', max: 14 },
                { label: '2주~1달', max: 30 },
                { label: '1달 이후', max: Infinity },
            ]),
            range: bucketize(rangeReport, [
                { label: '하루', max: 1 },
                { label: '2~3일', max: 3 },
                { label: '4~7일', max: 7 },
                { label: '1~2주', max: 14 },
                { label: '2주 이상', max: Infinity },
            ]),
            // 측정기준 등록 전 이벤트는 `(not set)`으로 뭉쳐 오므로 버린다 — 세는 의미가 없다
            method: measured(list(dateMethodReport, { calendar: '달력에서 직접', preset: '빠른 선택 칩' })),
            presets: measured(list(presetReport)),
        },
        warnings,
    };
}

export async function GET(request: NextRequest) {
    if (!ADMIN_KEY || request.nextUrl.searchParams.get('key') !== ADMIN_KEY) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = ga4Config();
    if (!config) {
        return NextResponse.json({
            available: false,
            message: '방문 통계 연결 설정이 없어 정보를 불러올 수 없습니다.',
            generatedAt: new Date().toISOString(),
        });
    }

    // 파라미터가 없으면 Number(null)이 0이 되어 최소값으로 눌리므로 존재 여부를 먼저 본다
    const rawDays = request.nextUrl.searchParams.get('days');
    const requested = Number(rawDays);
    const days = rawDays && Number.isFinite(requested)
        ? Math.min(Math.max(Math.trunc(requested), 2), 90)
        : DEFAULT_DAYS;

    // GA4 무료 할당량을 아끼려고 10분간 재사용한다
    if (cache && cache.days === days && Date.now() - cache.at < CACHE_TTL_MS) {
        return NextResponse.json(cache.body);
    }

    try {
        const body = await buildStats(config, days);
        cache = { at: Date.now(), days, body };
        return NextResponse.json(body);
    } catch (error) {
        console.error('GA4 stats failed:', error);
        const message = error instanceof Error ? error.message : '방문 통계를 불러오지 못했습니다.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
