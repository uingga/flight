import { NextRequest, NextResponse } from 'next/server';

const ADMIN_KEY = process.env.ADMIN_KEY;

interface FlightReportHideRow {
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
}

function config() {
    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return { url, key };
}

function authorized(request: NextRequest, bodyKey?: unknown) {
    const supplied = request.nextUrl.searchParams.get('key') || String(bodyKey || '');
    return Boolean(ADMIN_KEY && supplied === ADMIN_KEY);
}

function sameSiteRequest(request: NextRequest): boolean {
    const host = request.headers.get('host');
    const source = request.headers.get('origin') || request.headers.get('referer');
    if (!host || !source) return false;
    try {
        return new URL(source).host === host;
    } catch {
        return false;
    }
}

async function supabaseRequest(restPath: string, init: RequestInit = {}) {
    const settings = config();
    if (!settings) throw new Error('Supabase configuration is missing');
    return fetch(`${settings.url}/rest/v1/${restPath}`, {
        ...init,
        headers: {
            apikey: settings.key,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
        cache: 'no-store',
    });
}

function hideIsActive(hide: FlightReportHideRow, now = Date.now()) {
    if (hide.status === 'manual') return true;
    return hide.status === 'active'
        && Boolean(hide.expires_at)
        && new Date(hide.expires_at as string).getTime() > now;
}

function koreaDayStart(daysAgo = 0): number {
    const koreaNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return new Date(Date.UTC(
        koreaNow.getUTCFullYear(),
        koreaNow.getUTCMonth(),
        koreaNow.getUTCDate() - daysAgo,
    ) - 9 * 60 * 60 * 1000).getTime();
}

export async function GET(request: NextRequest) {
    if (!authorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!config()) {
        return NextResponse.json({
            available: false,
            message: 'Supabase 설정이 없어 신고 현황을 불러올 수 없습니다.',
            reports: [],
            hides: [],
            events: [],
        });
    }

    try {
        const [reportsResponse, hidesResponse, eventsResponse] = await Promise.all([
            supabaseRequest([
                'flight_reports?select=id,flight_id,source,report_type,status,departure_city,arrival_city,departure_date,arrival_date,airline,displayed_price,created_at,result',
                'order=created_at.desc',
                'limit=500',
            ].join('&')),
            supabaseRequest('flight_report_hides?select=*&order=updated_at.desc&limit=60'),
            supabaseRequest([
                'flight_report_events?select=id,report_id,flight_id,source,event_type,details,created_at',
                'order=created_at.desc',
                'limit=100',
            ].join('&')),
        ]);
        if (!reportsResponse.ok || !hidesResponse.ok || !eventsResponse.ok) {
            throw new Error(`Supabase response ${reportsResponse.status}/${hidesResponse.status}/${eventsResponse.status}`);
        }

        const allReports = await reportsResponse.json() as Array<{ created_at: string; [key: string]: unknown }>;
        const hides = await hidesResponse.json() as FlightReportHideRow[];
        const events = await eventsResponse.json();
        const activeHides = hides.filter(hide => hideIsActive(hide));
        const reportsBetween = (daysAgo: number, beforeToday = false) => allReports.filter(report => {
            const createdAt = new Date(report.created_at).getTime();
            return Number.isFinite(createdAt)
                && createdAt >= koreaDayStart(daysAgo)
                && (!beforeToday || createdAt < koreaDayStart(0));
        }).length;

        return NextResponse.json({
            available: true,
            generatedAt: new Date().toISOString(),
            summary: {
                recentReports: allReports.length,
                reportsToday: reportsBetween(0),
                reportsLast7Days: reportsBetween(7, true),
                reportsLast30Days: reportsBetween(30, true),
                activeHides: activeHides.length,
                needsReview: hides.filter(hide => hide.status === 'active' && hideIsActive(hide)).length,
            },
            reports: allReports.slice(0, 60),
            hides,
            events,
        });
    } catch (error) {
        console.error('관리자 신고 현황 조회 실패:', error);
        return NextResponse.json({ error: '신고 현황을 불러오지 못했습니다.' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        if (!sameSiteRequest(request)) {
            return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
        }
        const body = await request.json();
        if (!authorized(request, body.key)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const flightId = String(body.flightId || '');
        const action = String(body.action || '');
        if (!flightId || !['keep_hidden', 'release'].includes(action)) {
            return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
        }

        const nowIso = new Date().toISOString();
        const update = action === 'keep_hidden'
            ? {
                status: 'manual',
                expires_at: null,
                released_at: null,
                release_reason: '관리자가 계속 숨김',
                updated_at: nowIso,
            }
            : {
                status: 'released',
                released_at: nowIso,
                release_reason: '관리자가 다시 표시',
                updated_at: nowIso,
            };
        const response = await supabaseRequest(`flight_report_hides?flight_id=eq.${encodeURIComponent(flightId)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(update),
        });
        if (!response.ok) throw new Error(`Flight hide update failed: ${response.status}`);
        const rows = await response.json() as FlightReportHideRow[];
        if (rows.length === 0) {
            return NextResponse.json({ error: '숨김 기록을 찾지 못했습니다.' }, { status: 404 });
        }
        return NextResponse.json({ success: true, hide: rows[0] });
    } catch (error) {
        console.error('관리자 신고 처리 실패:', error);
        return NextResponse.json({ error: '신고 상태를 변경하지 못했습니다.' }, { status: 500 });
    }
}
