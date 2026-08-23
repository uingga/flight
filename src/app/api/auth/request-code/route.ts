import { randomInt, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import {
    getRequestFingerprint,
    hashAuthValue,
    isSameOriginRequest,
    normalizeEmail,
} from '@/lib/server/account-auth';
import { hasSupabaseServerConfig, supabaseRest } from '@/lib/server/supabase-rest';

export const dynamic = 'force-dynamic';

type CountRow = { id: string };

function json(body: Record<string, unknown>, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store, private' },
    });
}

function escapeHtml(value: string) {
    return value.replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[char] || char));
}

export async function POST(request: NextRequest) {
    if (!isSameOriginRequest(request)) return json({ error: '잘못된 요청이에요.' }, 403);
    if (Number(request.headers.get('content-length') || 0) > 4_096) return json({ error: '요청이 너무 커요.' }, 413);
    if (!hasSupabaseServerConfig()) return json({ error: '로그인 저장소를 준비 중이에요.' }, 503);

    const emailUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
    const emailPass = (process.env.GMAIL_APP_PASS || process.env.EMAIL_PASS || '').replace(/\s/g, '');
    if (!emailUser || !emailPass) return json({ error: '이메일 로그인을 준비 중이에요.' }, 503);

    let input: unknown;
    try { input = await request.json(); } catch { return json({ error: '이메일을 확인해 주세요.' }, 400); }
    const email = normalizeEmail((input as { email?: unknown })?.email);
    if (!email) return json({ error: '올바른 이메일 주소를 입력해 주세요.' }, 400);

    const now = Date.now();
    const emailHash = hashAuthValue('email', email);
    const requestHash = getRequestFingerprint(request);
    const fifteenMinutesAgo = new Date(now - 15 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    try {
        // 만료된 인증 흔적과 세션을 새 요청 때 정리해 보유 기간을 제한한다.
        const cleanupBefore = new Date(now - 24 * 60 * 60 * 1000).toISOString();
        await Promise.all([
            supabaseRest(`tikitikit_auth_codes?expires_at=lt.${encodeURIComponent(cleanupBefore)}`, {
                method: 'DELETE', headers: { Prefer: 'return=minimal' },
            }),
            supabaseRest(`tikitikit_auth_sessions?expires_at=lt.${encodeURIComponent(new Date(now).toISOString())}`, {
                method: 'DELETE', headers: { Prefer: 'return=minimal' },
            }),
        ]);
        const [recentEmail, dailyEmail, recentRequest] = await Promise.all([
            supabaseRest<CountRow[]>(`tikitikit_auth_codes?select=id&email_hash=eq.${emailHash}&created_at=gte.${encodeURIComponent(fifteenMinutesAgo)}&limit=4`),
            supabaseRest<CountRow[]>(`tikitikit_auth_codes?select=id&email_hash=eq.${emailHash}&created_at=gte.${encodeURIComponent(oneDayAgo)}&limit=11`),
            supabaseRest<CountRow[]>(`tikitikit_auth_codes?select=id&request_hash=eq.${requestHash}&created_at=gte.${encodeURIComponent(fifteenMinutesAgo)}&limit=11`),
        ]);
        if (recentEmail.length >= 3 || dailyEmail.length >= 10 || recentRequest.length >= 10) {
            return json({ error: '인증번호 요청이 많아요. 잠시 뒤 다시 시도해 주세요.' }, 429);
        }

        const id = randomUUID();
        const code = String(randomInt(100000, 1_000_000));
        const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();
        await supabaseRest('tikitikit_auth_codes', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
                id,
                email_hash: emailHash,
                request_hash: requestHash,
                code_hash: hashAuthValue('login-code', `${id}:${email}:${code}`),
                expires_at: expiresAt,
            }),
        });

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: emailUser, pass: emailPass },
        });
        await transporter.sendMail({
            from: `티키티킷 <${emailUser}>`,
            to: email,
            subject: `[티키티킷] 로그인 인증번호 ${code}`,
            text: `티키티킷 로그인 인증번호는 ${code}입니다. 10분 안에 입력해 주세요. 본인이 요청하지 않았다면 이 메일을 무시해 주세요.`,
            html: `
                <div style="font-family:Arial,'Apple SD Gothic Neo',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#171717">
                    <p style="font-size:22px;font-weight:800;margin:0 0 20px">티키티킷 로그인</p>
                    <p style="font-size:15px;line-height:1.7;margin:0 0 18px">${escapeHtml(email)} 계정으로 로그인하려면 아래 번호를 입력해 주세요.</p>
                    <p style="font-size:34px;font-weight:800;letter-spacing:8px;margin:0 0 18px;color:#e6437a">${code}</p>
                    <p style="font-size:13px;line-height:1.6;color:#737373;margin:0">10분 동안 사용할 수 있어요. 본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>
                </div>`,
        });

        return json({ ok: true, requestId: id, expiresInSeconds: 600 });
    } catch (error) {
        console.error('로그인 인증번호 발급 실패:', error instanceof Error ? error.message : 'unknown');
        return json({ error: '인증번호를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, 500);
    }
}
