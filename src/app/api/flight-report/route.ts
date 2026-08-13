import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

const REPORT_LABELS = {
    price_changed: '가격이 다름',
    unavailable: '예약 불가',
} as const;

type ReportType = keyof typeof REPORT_LABELS;

const reportAttempts = new Map<string, number[]>();
const REPORT_WINDOW_MS = 10 * 60 * 1000;
const REPORT_LIMIT = 5;

function safeText(value: unknown, maxLength = 200): string {
    return String(value ?? '')
        .slice(0, maxLength)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export async function POST(request: NextRequest) {
    try {
        const origin = request.headers.get('origin');
        const host = request.headers.get('host');
        if (origin && host && new URL(origin).host !== host) {
            return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
        }

        const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
        const clientKey = forwardedFor || request.headers.get('x-real-ip') || 'local';
        const now = Date.now();
        const recentAttempts = (reportAttempts.get(clientKey) || []).filter(
            timestamp => now - timestamp < REPORT_WINDOW_MS
        );
        if (recentAttempts.length >= REPORT_LIMIT) {
            return NextResponse.json({ error: '잠시 후 다시 신고해주세요.' }, { status: 429 });
        }

        const body = await request.json();
        const reportType = body.reportType as ReportType;
        const flight = body.flight || {};

        if (!REPORT_LABELS[reportType] || !flight.id || !flight.source) {
            return NextResponse.json({ error: '잘못된 신고 정보입니다.' }, { status: 400 });
        }

        reportAttempts.set(clientKey, [...recentAttempts, now]);

        const emailUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
        const emailPass = (process.env.GMAIL_APP_PASS || process.env.EMAIL_PASS || '').replace(/\s/g, '');
        if (!emailUser || !emailPass) {
            return NextResponse.json({ error: '서버 설정 오류입니다.' }, { status: 500 });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: emailUser, pass: emailPass },
        });

        const route = `${safeText(flight.departureCity)} → ${safeText(flight.arrivalCity)}`;
        const reportLabel = REPORT_LABELS[reportType];
        const html = `
            <h2>🚨 항공권 정보 신고: ${reportLabel}</h2>
            <table border="0" cellpadding="8" style="border-collapse: collapse; font-size: 14px;">
                <tr><td><strong>항공권 ID</strong></td><td>${safeText(flight.id)}</td></tr>
                <tr><td><strong>여행사</strong></td><td>${safeText(flight.sourceName)}</td></tr>
                <tr><td><strong>노선</strong></td><td>${route}</td></tr>
                <tr><td><strong>일정</strong></td><td>${safeText(flight.departureDate)} ~ ${safeText(flight.arrivalDate)}</td></tr>
                <tr><td><strong>항공사</strong></td><td>${safeText(flight.airline)}</td></tr>
                <tr><td><strong>표시 가격</strong></td><td>${safeText(flight.price)}원</td></tr>
                <tr><td><strong>가격 확인 시각</strong></td><td>${safeText(flight.priceCheckedAt || '미기록')}</td></tr>
                <tr><td><strong>신고 시각</strong></td><td>${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td></tr>
            </table>
        `;

        await transporter.sendMail({
            from: `"티키티킷 항공권 신고" <${emailUser}>`,
            to: 'uingga@gmail.com',
            subject: `[항공권 신고] ${reportLabel} - ${safeText(flight.arrivalCity, 40)} (${safeText(flight.sourceName, 40)})`,
            html,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('항공권 신고 전송 실패:', error);
        return NextResponse.json({ error: '신고 접수에 실패했습니다.' }, { status: 500 });
    }
}
