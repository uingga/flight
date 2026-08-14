import { NextRequest, NextResponse } from 'next/server';
import { ga4Config, runReport, eventNameFilter, dim, num, type Ga4Config, type ReportResponse } from '@/lib/ga4';

const ADMIN_KEY = process.env.ADMIN_KEY || 'tikit2026';
const DEFAULT_DAYS = 14;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** 어드민에서 의미 있는 이벤트만 골라 한국어 이름을 붙인다. */
const EVENT_LABELS: Record<string, string> = {
    booking_click: '예약 클릭',
    affiliate_click: '제휴 클릭',
    alert_setup: '가격 알림 등록',
    deal_alert_setup: '조건형 알림 등록',
    card_click: '항공권 카드 클릭',
    compare_click: '가격 비교 클릭',
    share_flight: '공유',
    filter_change: '필터 변경',
    date_filter: '날짜 필터',
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

    const [agencyReport, routeReport, entryReport, channelReport] = await Promise.all([
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
        optional('유입 경로', warnings, () => runReport(config, {
            dateRanges,
            dimensions: [{ name: 'sessionDefaultChannelGroup' }],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 12,
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
    const alertSetup = events.find(entry => entry.name === 'alert_setup');
    const rate = (value: number) => (totals.users > 0 ? Number(((value / totals.users) * 100).toFixed(1)) : null);

    const list = (report: ReportResponse | null, fallbackLabel = '(값 없음)') =>
        report === null ? null : (report.rows || []).map(row => ({
            label: dim(row) || fallbackLabel,
            count: num(row, 0),
        }));

    return {
        available: true,
        generatedAt: new Date().toISOString(),
        days,
        totals,
        trend,
        events: events.filter(entry => entry.known),
        otherEvents: events.filter(entry => !entry.known && !['page_view', 'session_start', 'first_visit', 'user_engagement', 'scroll'].includes(entry.name)),
        conversion: {
            bookingClickUsers: bookingClick?.users ?? 0,
            bookingClickRate: rate(bookingClick?.users ?? 0),
            alertSetupUsers: alertSetup?.users ?? 0,
            alertSetupRate: rate(alertSetup?.users ?? 0),
        },
        bookingByAgency: list(agencyReport),
        bookingByRoute: list(routeReport),
        alertByEntry: list(entryReport),
        channels: channelReport === null ? null : (channelReport.rows || []).map(row => ({
            label: CHANNEL_LABELS[dim(row)] || dim(row) || '분류 안 됨',
            sessions: num(row, 0),
            users: num(row, 1),
        })),
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
