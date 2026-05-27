import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const EVENTS_FILE = path.join(process.cwd(), 'data', 'analytics-events.json');

interface AnalyticsEvent {
    type: string;
    source?: string;
    route?: string;
    price?: number;
    provider?: string;
    method?: string;
    timestamp: string;
}

function loadEvents(): AnalyticsEvent[] {
    try {
        if (fs.existsSync(EVENTS_FILE)) {
            return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8'));
        }
    } catch { }
    return [];
}

function saveEvents(events: AnalyticsEvent[]) {
    const dir = path.dirname(EVENTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 최근 30일만 유지 (파일 크기 관리)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const filtered = events.filter(e => new Date(e.timestamp) > cutoff);
    fs.writeFileSync(EVENTS_FILE, JSON.stringify(filtered, null, 2));
}

// POST: 이벤트 기록
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { type, source, route, price, provider, method } = body;

        if (!type) {
            return NextResponse.json({ error: 'type required' }, { status: 400 });
        }

        const event: AnalyticsEvent = {
            type,
            ...(source && { source }),
            ...(route && { route }),
            ...(price && { price }),
            ...(provider && { provider }),
            ...(method && { method }),
            timestamp: new Date().toISOString(),
        };

        const events = loadEvents();
        events.push(event);
        saveEvents(events);

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: 'failed' }, { status: 500 });
    }
}

// GET: 통계 조회
export async function GET(request: NextRequest) {
    const authKey = request.nextUrl.searchParams.get('key');
    if (authKey !== (process.env.ADMIN_KEY || 'tikit2026')) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const events = loadEvents();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const todayEvents = events.filter(e => e.timestamp.startsWith(todayStr));
    const weekEvents = events.filter(e => new Date(e.timestamp) > weekAgo);

    // 이벤트 타입별 집계
    const countByType = (evts: AnalyticsEvent[]) => {
        const counts: Record<string, number> = {};
        evts.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
        return counts;
    };

    // 예약 클릭: 여행사별
    const bookingBySource = (evts: AnalyticsEvent[]) => {
        const counts: Record<string, number> = {};
        evts.filter(e => e.type === 'booking_click').forEach(e => {
            const src = e.source || 'unknown';
            counts[src] = (counts[src] || 0) + 1;
        });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]);
    };

    // 예약 클릭: 노선별
    const bookingByRoute = (evts: AnalyticsEvent[]) => {
        const counts: Record<string, number> = {};
        evts.filter(e => e.type === 'booking_click').forEach(e => {
            const route = e.route || 'unknown';
            counts[route] = (counts[route] || 0) + 1;
        });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    };

    // 일별 이벤트 추이 (최근 7일)
    const dailyTrend: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        dailyTrend[dateStr] = events.filter(e => e.timestamp.startsWith(dateStr)).length;
    }

    return NextResponse.json({
        today: {
            total: todayEvents.length,
            byType: countByType(todayEvents),
            bookingBySource: bookingBySource(todayEvents),
            bookingByRoute: bookingByRoute(todayEvents),
        },
        week: {
            total: weekEvents.length,
            byType: countByType(weekEvents),
            bookingBySource: bookingBySource(weekEvents),
            bookingByRoute: bookingByRoute(weekEvents),
        },
        dailyTrend,
        totalEvents: events.length,
    });
}
