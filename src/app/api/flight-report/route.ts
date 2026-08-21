import { createHmac } from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import type { Flight } from '@/types/flight';

const REPORT_LABELS = {
    price_changed: '가격이 다름',
    unavailable: '예약 불가',
} as const;

type ReportType = keyof typeof REPORT_LABELS;

interface StoredReport {
    id: number;
    status: string;
    report_count: number;
    last_reported_at: string;
}

const REPORT_RATE_WINDOW_MS = 10 * 60 * 1000;
const REPORT_LIMIT = 5;

function config() {
    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase configuration is missing');
    return { url, key };
}

function safeText(value: unknown, maxLength = 200): string {
    return String(value ?? '')
        .slice(0, maxLength)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function sourceName(source: Flight['source']): string {
    const names: Record<Flight['source'], string> = {
        ybtour: '노랑풍선',
        modetour: '모두투어',
        hanatour: '하나투어',
        onlinetour: '온라인투어',
        ttang: '땡처리닷컴',
        myrealtrip: '마이리얼트립',
    };
    return names[source];
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

function clientIp(request: NextRequest): string {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'local';
}

function keyedHash(value: string): string {
    return createHmac('sha256', config().key).update(value).digest('hex');
}

function loadAuthoritativeFlight(id: string, source: string): Flight | null {
    const cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as { flights?: Flight[] };
    return cache.flights?.find(flight => flight.id === id && flight.source === source) || null;
}

async function supabaseRequest(restPath: string, init: RequestInit = {}) {
    const { url, key } = config();
    return fetch(`${url}/rest/v1/${restPath}`, {
        ...init,
        headers: {
            apikey: key,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
        cache: 'no-store',
    });
}

async function recentReportCount(reporterHash: string, cutoffIso: string): Promise<number> {
    const query = [
        'select=id',
        `reporter_hash=eq.${reporterHash}`,
        `created_at=gte.${encodeURIComponent(cutoffIso)}`,
    ].join('&');
    const response = await supabaseRequest(`flight_reports?${query}`, {
        method: 'HEAD',
        headers: { Prefer: 'count=exact' },
    });
    if (!response.ok) throw new Error(`Flight report count failed: ${response.status}`);
    return Number(response.headers.get('content-range')?.split('/')[1] || 0);
}

async function sendReportEmail(
    reportType: ReportType,
    flight: Flight,
    reportId: number,
): Promise<void> {
    const emailUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
    const emailPass = (process.env.GMAIL_APP_PASS || process.env.EMAIL_PASS || '').replace(/\s/g, '');
    if (!emailUser || !emailPass) return;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: emailUser, pass: emailPass },
    });
    const route = `${safeText(flight.departure.city)} → ${safeText(flight.arrival.city)}`;
    const reportLabel = REPORT_LABELS[reportType];
    const html = `
        <h2>🚨 항공권 정보 신고: ${reportLabel}</h2>
        <table border="0" cellpadding="8" style="border-collapse: collapse; font-size: 14px;">
            <tr><td><strong>신고 번호</strong></td><td>${reportId}</td></tr>
            <tr><td><strong>항공권 ID</strong></td><td>${safeText(flight.id)}</td></tr>
            <tr><td><strong>여행사</strong></td><td>${safeText(sourceName(flight.source))}</td></tr>
            <tr><td><strong>노선</strong></td><td>${route}</td></tr>
            <tr><td><strong>일정</strong></td><td>${safeText(flight.departure.date)} ~ ${safeText(flight.arrival.date)}</td></tr>
            <tr><td><strong>항공사</strong></td><td>${safeText(flight.airline)}</td></tr>
            <tr><td><strong>표시 가격</strong></td><td>${safeText(flight.price)}원</td></tr>
            <tr><td><strong>가격 확인 시각</strong></td><td>${safeText(flight.priceCheckedAt || '미기록')}</td></tr>
            <tr><td><strong>신고 시각</strong></td><td>${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td></tr>
        </table>
        <p>자동 재확인 작업이 최대 15분 안에 이 신고를 처리하기 시작합니다.</p>
    `;

    await transporter.sendMail({
        from: `"티키티킷 항공권 신고" <${emailUser}>`,
        to: 'uingga@gmail.com',
        subject: `[항공권 신고 #${reportId}] ${reportLabel} - ${safeText(flight.arrival.city, 40)} (${safeText(sourceName(flight.source), 40)})`,
        html,
    });
}

export async function POST(request: NextRequest) {
    try {
        if (!sameSiteRequest(request)) {
            return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
        }

        const body = await request.json();
        const reportType = body.reportType as ReportType;
        const requestedFlight = body.flight || {};
        if (!REPORT_LABELS[reportType] || !requestedFlight.id || !requestedFlight.source) {
            return NextResponse.json({ error: '잘못된 신고 정보입니다.' }, { status: 400 });
        }

        // 브라우저가 보낸 가격·노선은 믿지 않고 git에 배포된 캐시 원본으로 교체한다.
        const flight = loadAuthoritativeFlight(String(requestedFlight.id), String(requestedFlight.source));
        if (!flight) {
            return NextResponse.json({ error: '이미 목록에서 사라진 항공권입니다.' }, { status: 404 });
        }

        const reporterHash = keyedHash(`reporter:${clientIp(request)}`).slice(0, 32);
        // DB의 고유키로 같은 접속자의 같은 항공권은 UTC 날짜당 한 행만 생성한다.
        // 브라우저는 성공 시점부터 24시간 동안 버튼을 숨겨 날짜 경계의 재전송도 막는다.
        const utcDay = new Date().toISOString().slice(0, 10);
        const dedupeKey = keyedHash(`report:${reporterHash}:${flight.id}:${utcDay}`).slice(0, 64);

        // 같은 항공권 반복 클릭은 일반 신고 한도보다 먼저 확인한다. 이미 저장된 한 건을
        // 그대로 돌려주므로 이메일·자동 확인 작업·10분 한도를 추가로 소비하지 않는다.
        const duplicateCutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const duplicateResponse = await supabaseRequest(
            [
                'flight_reports?select=id,status,report_count,last_reported_at',
                `reporter_hash=eq.${reporterHash}`,
                `flight_id=eq.${encodeURIComponent(flight.id)}`,
                `last_reported_at=gte.${encodeURIComponent(duplicateCutoffIso)}`,
                'order=last_reported_at.desc',
                'limit=1',
            ].join('&'),
        );
        if (!duplicateResponse.ok) throw new Error(`Duplicate report lookup failed: ${duplicateResponse.status}`);
        const duplicateReport = (await duplicateResponse.json() as StoredReport[])[0];
        if (duplicateReport) {
            return NextResponse.json({
                success: true,
                duplicate: true,
                recheckQueued: duplicateReport.status === 'pending' || duplicateReport.status === 'processing',
                reportId: duplicateReport.id,
            });
        }

        const cutoffIso = new Date(Date.now() - REPORT_RATE_WINDOW_MS).toISOString();
        if (await recentReportCount(reporterHash, cutoffIso) >= REPORT_LIMIT) {
            return NextResponse.json({ error: '잠시 후 다시 신고해주세요.' }, { status: 429 });
        }

        const payload = {
            reporter_hash: reporterHash,
            dedupe_key: dedupeKey,
            flight_id: flight.id,
            source: flight.source,
            report_type: reportType,
            departure_city: flight.departure.city,
            arrival_city: flight.arrival.city,
            departure_date: flight.departure.date,
            arrival_date: flight.arrival.date,
            airline: flight.airline || null,
            displayed_price: flight.price,
            price_checked_at: flight.priceCheckedAt || null,
            payload: {
                departureAirport: flight.departure.airport,
                arrivalAirport: flight.arrival.airport,
                departureTime: flight.departure.time,
                returnTime: flight.arrival.time,
            },
        };

        const saveResponse = await supabaseRequest('flight_reports?on_conflict=dedupe_key', {
            method: 'POST',
            headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
            body: JSON.stringify(payload),
        });
        if (!saveResponse.ok) throw new Error(`Flight report save failed: ${saveResponse.status}`);
        const inserted = await saveResponse.json() as StoredReport[];

        if (inserted.length === 0) {
            const existingResponse = await supabaseRequest(
                `flight_reports?select=id,status,report_count,last_reported_at&dedupe_key=eq.${dedupeKey}&limit=1`,
            );
            if (!existingResponse.ok) throw new Error(`Duplicate report lookup failed: ${existingResponse.status}`);
            const existing = (await existingResponse.json() as StoredReport[])[0];
            return NextResponse.json({
                success: true,
                duplicate: true,
                recheckQueued: existing?.status === 'pending' || existing?.status === 'processing',
                reportId: existing?.id,
            });
        }

        const report = inserted[0];
        try {
            await sendReportEmail(reportType, flight, report.id);
        } catch (emailError) {
            // DB 기록과 자동 확인이 남으므로 이메일 장애만으로 신고를 실패 처리하지 않는다.
            console.error('항공권 신고 이메일 전송 실패:', emailError);
        }

        return NextResponse.json({
            success: true,
            duplicate: false,
            recheckQueued: true,
            reportId: report.id,
        });
    } catch (error) {
        console.error('항공권 신고 처리 실패:', error);
        return NextResponse.json({ error: '신고 접수에 실패했습니다.' }, { status: 500 });
    }
}
