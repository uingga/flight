import { createHmac, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import type { Flight } from '@/types/flight';
import {
    AUTO_HIDE_DAILY_SOURCE_LIMIT,
    AUTO_HIDE_DURATION_MS,
    type FlightReportVote,
    summarizeFlightReportVotes,
} from '@/lib/flight-report-policy';

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

interface StoredHide {
    flight_id: string;
    source: Flight['source'];
    latest_report_id: number;
    status: 'active' | 'manual' | 'released' | 'expired' | 'resolved';
    report_count: number;
    price_changed_count: number;
    unavailable_count: number;
    hidden_at: string;
    expires_at: string | null;
    released_at: string | null;
    updated_at: string;
}

interface HideDecision {
    autoHidden: boolean;
    reportCount: number;
    priceChangedCount: number;
    unavailableCount: number;
    expiresAt?: string;
    dailyLimitReached?: boolean;
}

const REPORT_RATE_WINDOW_MS = 10 * 60 * 1000;
const REPORT_LIMIT = 5;
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPORTER_COOKIE = 'tikitikit_reporter_id';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

function reporterIdentity(request: NextRequest) {
    const savedToken = request.cookies.get(REPORTER_COOKIE)?.value;
    const deviceToken = savedToken && /^[a-f0-9]{32}$/.test(savedToken)
        ? savedToken
        : randomBytes(16).toString('hex');
    const networkHash = keyedHash(`network:${clientIp(request)}`).slice(0, 64);
    const deviceHash = keyedHash(`device:${deviceToken}`).slice(0, 64);
    return {
        deviceToken,
        networkHash,
        deviceHash,
        reporterHash: keyedHash(`reporter:${networkHash}:${deviceHash}`).slice(0, 64),
    };
}

function reportResponse(
    body: Record<string, unknown>,
    deviceToken: string,
    status = 200,
) {
    const response = NextResponse.json(body, { status });
    response.cookies.set(REPORTER_COOKIE, deviceToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 365 * 24 * 60 * 60,
        path: '/',
    });
    return response;
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

async function recentReportCount(networkHash: string, cutoffIso: string): Promise<number> {
    const query = [
        'select=id',
        `network_hash=eq.${networkHash}`,
        `created_at=gte.${encodeURIComponent(cutoffIso)}`,
    ].join('&');
    const response = await supabaseRequest(`flight_reports?${query}`, {
        method: 'HEAD',
        headers: { Prefer: 'count=exact' },
    });
    if (!response.ok) throw new Error(`Flight report count failed: ${response.status}`);
    return Number(response.headers.get('content-range')?.split('/')[1] || 0);
}

async function loadHide(flightId: string): Promise<StoredHide | null> {
    const response = await supabaseRequest(
        `flight_report_hides?select=*&flight_id=eq.${encodeURIComponent(flightId)}&limit=1`,
    );
    if (!response.ok) throw new Error(`Flight hide lookup failed: ${response.status}`);
    return (await response.json() as StoredHide[])[0] || null;
}

function hideIsActive(hide: StoredHide | null, now = Date.now()): boolean {
    if (!hide) return false;
    if (hide.status === 'manual') return true;
    return hide.status === 'active'
        && Boolean(hide.expires_at)
        && new Date(hide.expires_at as string).getTime() > now;
}

async function expireStaleHide(hide: StoredHide | null, nowIso: string): Promise<StoredHide | null> {
    if (!hide || hide.status !== 'active' || !hide.expires_at || hide.expires_at > nowIso) return hide;
    const response = await supabaseRequest(`flight_report_hides?flight_id=eq.${encodeURIComponent(hide.flight_id)}&status=eq.active`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
            status: 'expired',
            released_at: nowIso,
            release_reason: '24시간 임시 숨김 만료',
            updated_at: nowIso,
        }),
    });
    if (!response.ok) throw new Error(`Expired flight hide release failed: ${response.status}`);
    return (await response.json() as StoredHide[])[0] || { ...hide, status: 'expired', released_at: nowIso };
}

async function maybeAutoHide(flight: Flight, latestReportId: number): Promise<HideDecision> {
    const now = new Date();
    const nowIso = now.toISOString();
    let existingHide = await expireStaleHide(await loadHide(flight.id), nowIso);
    if (hideIsActive(existingHide, now.getTime())) {
        return {
            autoHidden: true,
            reportCount: existingHide!.report_count,
            priceChangedCount: existingHide!.price_changed_count,
            unavailableCount: existingHide!.unavailable_count,
            expiresAt: existingHide!.expires_at || undefined,
        };
    }

    const releasedAt = existingHide?.released_at || existingHide?.updated_at;
    const defaultCutoff = new Date(now.getTime() - REPORT_WINDOW_MS);
    const voteCutoff = releasedAt && new Date(releasedAt) > defaultCutoff
        ? new Date(releasedAt)
        : defaultCutoff;
    const votesResponse = await supabaseRequest([
        'flight_reports?select=reporter_hash,network_hash,device_hash,report_type',
        `flight_id=eq.${encodeURIComponent(flight.id)}`,
        `created_at=gte.${encodeURIComponent(voteCutoff.toISOString())}`,
        'order=created_at.asc',
    ].join('&'));
    if (!votesResponse.ok) throw new Error(`Flight report consensus lookup failed: ${votesResponse.status}`);
    const summary = summarizeFlightReportVotes(await votesResponse.json() as FlightReportVote[]);

    const decision: HideDecision = {
        autoHidden: false,
        reportCount: summary.distinctDevices,
        priceChangedCount: summary.priceChanged,
        unavailableCount: summary.unavailable,
    };
    if (!summary.shouldAutoHide) return decision;

    const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
    const dayCutoff = new Date(
        Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - KST_OFFSET_MS,
    ).toISOString();
    const dailyResponse = await supabaseRequest([
        'flight_report_hides?select=flight_id',
        `source=eq.${flight.source}`,
        `hidden_at=gte.${encodeURIComponent(dayCutoff)}`,
    ].join('&'), {
        method: 'HEAD',
        headers: { Prefer: 'count=exact' },
    });
    if (!dailyResponse.ok) throw new Error(`Daily flight hide count failed: ${dailyResponse.status}`);
    const dailyCount = Number(dailyResponse.headers.get('content-range')?.split('/')[1] || 0);
    if (dailyCount >= AUTO_HIDE_DAILY_SOURCE_LIMIT && !existingHide) {
        return { ...decision, dailyLimitReached: true };
    }

    const expiresAt = new Date(now.getTime() + AUTO_HIDE_DURATION_MS).toISOString();
    const saveResponse = await supabaseRequest('flight_report_hides?on_conflict=flight_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
            flight_id: flight.id,
            source: flight.source,
            latest_report_id: latestReportId,
            status: 'active',
            report_count: summary.distinctDevices,
            price_changed_count: summary.priceChanged,
            unavailable_count: summary.unavailable,
            hidden_at: nowIso,
            expires_at: expiresAt,
            released_at: null,
            release_reason: null,
            updated_at: nowIso,
        }),
    });
    if (!saveResponse.ok) throw new Error(`Temporary flight hide failed: ${saveResponse.status}`);
    existingHide = (await saveResponse.json() as StoredHide[])[0] || null;
    return {
        ...decision,
        autoHidden: true,
        expiresAt: existingHide?.expires_at || expiresAt,
    };
}

async function sendReportEmail(
    reportType: ReportType,
    flight: Flight,
    reportId: number,
    decision: HideDecision,
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
        <p><strong>최근 서로 다른 신고:</strong> ${decision.reportCount}건
            (가격이 다름 ${decision.priceChangedCount} · 예약 불가 ${decision.unavailableCount})</p>
        ${decision.autoHidden
        ? '<p style="color:#b45309"><strong>이 항공권은 확인하는 동안 목록에서 24시간 임시 숨김 처리했습니다.</strong></p>'
        : decision.dailyLimitReached
            ? '<p style="color:#b91c1c"><strong>여행사별 하루 자동 숨김 한도에 도달해 관리자 확인이 필요합니다.</strong></p>'
            : '<p>신고는 기록됐으며, 같은 항공권에 서로 다른 신고 3건이 모이면 추가 크롤 없이 임시 숨김 처리합니다.</p>'}
    `;

    await transporter.sendMail({
        from: `"티키티킷 항공권 신고" <${emailUser}>`,
        to: 'uingga@gmail.com',
        subject: `${decision.autoHidden ? '[항공권 임시 숨김]' : decision.dailyLimitReached ? '[자동 숨김 보류]' : `[항공권 신고 #${reportId}]`} ${reportLabel} - ${safeText(flight.arrival.city, 40)} (${safeText(sourceName(flight.source), 40)})`,
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

        const identity = reporterIdentity(request);
        const { reporterHash, networkHash, deviceHash, deviceToken } = identity;
        // DB의 고유키로 같은 접속자의 같은 항공권은 UTC 날짜당 한 행만 생성한다.
        // 브라우저는 성공 시점부터 24시간 동안 버튼을 숨겨 날짜 경계의 재전송도 막는다.
        const utcDay = new Date().toISOString().slice(0, 10);
        const dedupeKey = keyedHash(`report:${reporterHash}:${flight.id}:${utcDay}`).slice(0, 64);

        // 같은 항공권 반복 클릭은 일반 신고 한도보다 먼저 확인한다. 이미 저장된 한 건을
        // 그대로 돌려주므로 이메일·10분 한도를 추가로 소비하지 않는다.
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
            const activeHide = hideIsActive(await loadHide(flight.id));
            return reportResponse({
                success: true,
                duplicate: true,
                recheckQueued: false,
                autoHidden: activeHide,
                reportId: duplicateReport.id,
            }, deviceToken);
        }

        const cutoffIso = new Date(Date.now() - REPORT_RATE_WINDOW_MS).toISOString();
        if (await recentReportCount(networkHash, cutoffIso) >= REPORT_LIMIT) {
            return reportResponse({ error: '잠시 후 다시 신고해주세요.' }, deviceToken, 429);
        }

        const payload = {
            reporter_hash: reporterHash,
            network_hash: networkHash,
            device_hash: deviceHash,
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
            const activeHide = hideIsActive(await loadHide(flight.id));
            return reportResponse({
                success: true,
                duplicate: true,
                recheckQueued: false,
                autoHidden: activeHide,
                reportId: existing?.id,
            }, deviceToken);
        }

        const report = inserted[0];
        const hideDecision = await maybeAutoHide(flight, report.id);
        try {
            await sendReportEmail(reportType, flight, report.id, hideDecision);
        } catch (emailError) {
            // DB 기록과 숨김 판단은 이미 끝났으므로 이메일 장애만으로 신고를 실패 처리하지 않는다.
            console.error('항공권 신고 이메일 전송 실패:', emailError);
        }

        return reportResponse({
            success: true,
            duplicate: false,
            recheckQueued: false,
            autoHidden: hideDecision.autoHidden,
            hideExpiresAt: hideDecision.expiresAt,
            reportId: report.id,
        }, deviceToken);
    } catch (error) {
        console.error('항공권 신고 처리 실패:', error);
        return NextResponse.json({ error: '신고 접수에 실패했습니다.' }, { status: 500 });
    }
}
