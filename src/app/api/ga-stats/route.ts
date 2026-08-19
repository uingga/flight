import { NextRequest, NextResponse } from 'next/server';
import { ga4Config, runReport, eventNameFilter, dim, num, type Ga4Config, type ReportResponse } from '@/lib/ga4';

const ADMIN_KEY = process.env.ADMIN_KEY || 'tikit2026';
const DEFAULT_DAYS = 14;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** 어드민에서 의미 있는 이벤트만 골라 한국어 이름을 붙인다. */
const EVENT_LABELS: Record<string, string> = {
    booking_click: '예약 클릭',
    detail_open: '항공권 상세 열기',
    alert_setup: '가격 알림 등록',
    deal_alert_setup: '조건형 알림 등록',
    // 2026-08-14에 중단. 그전까지 카드 본문 클릭은 아무 동작도 하지 않았으므로 헛클릭 지표였다
    card_click: '카드 빈 곳 클릭 (8/14 이전, 반응 없던 클릭)',
    compare_click: '네이버 가격비교 열기',
    compare_outbound_click: '네이버로 이동',
    hotel_compare_click: '호텔 비교 클릭',
    share_flight: '공유',
    filter_change: '필터 변경',
    date_filter: '날짜 필터',
    date_filter_empty: '날짜 필터 — 결과 0건',
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
    'Unassigned': '분류 안 됨',
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
        warnings.push(`${label}은(는) 불러오지 못했습니다. GA4 맞춤 측정기준 등록 여부를 확인해주세요.`);
        return null;
    }
}

async function buildStats(config: Ga4Config, days: number) {
    const dateRanges = [{ startDate: `${days - 1}daysAgo`, endDate: 'today' }];
    const warnings: string[] = [];

    // 핵심 2개는 실패하면 그대로 에러 — 표준 측정기준만 쓰므로 실패 = 설정 문제
    const [trendReport, eventReport] = await Promise.all([
        runReport(config, {
            dateRanges,
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'sessions' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
            metricAggregations: ['TOTAL'],
            keepEmptyRows: true,
            limit: days,
        }),
        runReport(config, {
            dateRanges,
            dimensions: [{ name: 'eventName' }],
            metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: 50,
        }),
    ]);

    const [agencyReport, routeReport, entryReport, detailEntryReport, channelReport, campaignTrafficReport, campaignBookingReport, leadTimeReport, rangeReport, dateMethodReport, presetReport] = await Promise.all([
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
    ]);

    // YYYYMMDD → YYYY-MM-DD
    const trend = (trendReport.rows || []).map(row => {
        const raw = dim(row);
        return {
            date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
            users: num(row, 0),
            pageViews: num(row, 1),
            sessions: num(row, 2),
        };
    });

    const totalRow = trendReport.totals?.[0];
    const totals = {
        users: num(totalRow, 0),
        pageViews: num(totalRow, 1),
        sessions: num(totalRow, 2),
    };

    const events = (eventReport.rows || [])
        .map(row => ({
            name: dim(row),
            label: EVENT_LABELS[dim(row)] || dim(row),
            count: num(row, 0),
            users: num(row, 1),
            known: dim(row) in EVENT_LABELS,
        }))
        .filter(entry => entry.known || entry.count > 0);

    const bookingClick = events.find(entry => entry.name === 'booking_click');
    const detailOpen = events.find(entry => entry.name === 'detail_open');
    const alertSetup = events.find(entry => entry.name === 'alert_setup');
    const rate = (value: number) => (totals.users > 0 ? Number(((value / totals.users) * 100).toFixed(1)) : null);

    const list = (report: ReportResponse | null, labels?: Record<string, string>, fallbackLabel = '(값 없음)') =>
        report === null ? null : (report.rows || []).map(row => ({
            label: labels?.[dim(row)] || dim(row) || fallbackLabel,
            count: num(row, 0),
        }));

    const campaignLabel = (name: string) => {
        const drop = name.match(/^tikitikit_drop_(\d+)$/);
        return drop ? `티키티킷 드롭 ${Number(drop[1])}` : name;
    };
    const contentSourceLabel = (source: string) => ({
        naver_blog: '네이버 블로그',
        travel_community: '여행 커뮤니티',
    }[source] || source);
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

    const dateFilterEmpty = events.find(entry => entry.name === 'date_filter_empty');
    const dateFilter = events.find(entry => entry.name === 'date_filter');

    return {
        available: true,
        generatedAt: new Date().toISOString(),
        days,
        totals,
        trend,
        events: events.filter(entry => entry.known),
        otherEvents: events.filter(entry => !entry.known && !['page_view', 'session_start', 'first_visit', 'user_engagement', 'scroll', 'affiliate_click'].includes(entry.name)),
        conversion: {
            detailOpenUsers: detailOpen?.users ?? 0,
            detailOpenRate: rate(detailOpen?.users ?? 0),
            bookingClickUsers: bookingClick?.users ?? 0,
            bookingClickRate: rate(bookingClick?.users ?? 0),
            // 퍼널에서 제일 중요한 구간 — 상세를 연 사람 중 몇 %가 실제 예약으로 넘어갔는지
            detailToBookingRate: detailOpen?.users
                ? Number((((bookingClick?.users ?? 0) / detailOpen.users) * 100).toFixed(1))
                : null,
            alertSetupUsers: alertSetup?.users ?? 0,
            alertSetupRate: rate(alertSetup?.users ?? 0),
        },
        bookingByAgency: list(agencyReport),
        bookingByRoute: list(routeReport),
        alertByEntry: list(entryReport, ENTRY_LABELS),
        detailByEntry: list(detailEntryReport, ENTRY_LABELS),
        channels: channelReport === null ? null : (channelReport.rows || []).map(row => ({
            label: CHANNEL_LABELS[dim(row)] || dim(row) || '분류 안 됨',
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
            method: list(dateMethodReport, { calendar: '달력에서 직접', preset: '빠른 선택 칩' }),
            presets: list(presetReport, { nearest_date: '가장 가까운 출발일' }),
        },
        warnings,
    };
}

export async function GET(request: NextRequest) {
    if (request.nextUrl.searchParams.get('key') !== ADMIN_KEY) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = ga4Config();
    if (!config) {
        return NextResponse.json({
            available: false,
            message: 'GA4 환경변수(GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY)가 없어 방문 통계를 불러올 수 없습니다.',
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
