import { NextRequest, NextResponse } from 'next/server';
import {
    createSessionToken,
    getRequestFingerprint,
    hashAuthValue,
    isSameOriginRequest,
    normalizeEmail,
    setSessionCookie,
    type AccountUser,
} from '@/lib/server/account-auth';
import { supabaseRest } from '@/lib/server/supabase-rest';

export const dynamic = 'force-dynamic';

type VerifyResult = 'verified' | 'wrong' | 'expired';

const VERIFY_RATE_LIMITS = [
    { scope: 'auth_verify_ip_15m', windowSeconds: 15 * 60, limit: 30 },
    { scope: 'auth_verify_ip_day', windowSeconds: 24 * 60 * 60, limit: 100 },
] as const;

function json(body: Record<string, unknown>, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store, private' },
    });
}

async function takeRateLimit(scope: string, keyHash: string, windowSeconds: number, limit: number) {
    return supabaseRest<boolean>('rpc/tikitikit_take_rate_limit', {
        method: 'POST',
        body: JSON.stringify({
            p_scope: scope,
            p_key_hash: keyHash,
            p_window_seconds: windowSeconds,
            p_limit: limit,
        }),
    });
}

async function readInput(request: NextRequest) {
    const declaredSize = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(declaredSize) && declaredSize > 4_096) return { tooLarge: true } as const;
    const reader = request.body?.getReader();
    if (!reader) return { invalid: true } as const;
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let raw = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        if (bytesRead > 4_096) {
            await reader.cancel();
            return { tooLarge: true } as const;
        }
        raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    try {
        return { input: JSON.parse(raw) as { email?: unknown; code?: unknown; requestId?: unknown } } as const;
    } catch {
        return { invalid: true } as const;
    }
}

export async function POST(request: NextRequest) {
    if (!isSameOriginRequest(request)) return json({ error: '잘못된 요청이에요.' }, 403);
    const parsed = await readInput(request);
    if ('tooLarge' in parsed) return json({ error: '요청이 너무 커요.' }, 413);
    if ('invalid' in parsed) return json({ error: '인증번호를 확인해 주세요.' }, 400);
    const { input } = parsed;

    const email = normalizeEmail(input.email);
    const code = typeof input.code === 'string' ? input.code.replace(/\D/g, '') : '';
    const requestId = typeof input.requestId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)
        ? input.requestId
        : '';
    if (!email || code.length !== 6 || !requestId) return json({ error: '인증번호를 확인해 주세요.' }, 400);

    const emailHash = hashAuthValue('email', email);
    const now = new Date().toISOString();
    try {
        const requestHash = getRequestFingerprint(request);
        const requestIdHash = hashAuthValue('verify-request', requestId);
        const rateChecks = await Promise.all([
            ...VERIFY_RATE_LIMITS.map(rule => takeRateLimit(rule.scope, requestHash, rule.windowSeconds, rule.limit)),
            takeRateLimit('auth_verify_request_15m', requestIdHash, 15 * 60, 6),
        ]);
        if (rateChecks.some(allowed => !allowed)) {
            return json({ error: '인증번호 확인 요청이 많아요. 잠시 뒤 다시 시도해 주세요.' }, 429);
        }

        const expected = hashAuthValue('login-code', `${requestId}:${email}:${code}`);
        const verifyResult = await supabaseRest<VerifyResult>('rpc/tikitikit_verify_auth_code', {
            method: 'POST',
            body: JSON.stringify({
                p_code_id: requestId,
                p_email_hash: emailHash,
                p_expected_code_hash: expected,
            }),
        });
        if (verifyResult === 'wrong') return json({ error: '인증번호가 맞지 않아요.' }, 400);
        if (verifyResult !== 'verified') return json({ error: '인증번호가 만료됐어요. 새 번호를 받아 주세요.' }, 400);

        const users = await supabaseRest<AccountUser[]>(
            'tikitikit_users?on_conflict=email_normalized',
            {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
                body: JSON.stringify({
                    email,
                    email_normalized: email,
                    last_login_at: now,
                    updated_at: now,
                }),
            },
        );
        const user = users[0];
        if (!user) throw new Error('User upsert returned no row');

        const token = createSessionToken();
        await supabaseRest('tikitikit_auth_sessions', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
                user_id: user.id,
                token_hash: hashAuthValue('session', token),
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            }),
        });

        // 한 계정에 활성 세션은 최근 5개까지만 유지한다.
        const oldSessions = await supabaseRest<Array<{ id: string }>>(
            `tikitikit_auth_sessions?select=id&user_id=eq.${encodeURIComponent(user.id)}&expires_at=gt.${encodeURIComponent(now)}&order=created_at.desc&offset=5&limit=50`,
        );
        await Promise.all(oldSessions.map(session => supabaseRest(
            `tikitikit_auth_sessions?id=eq.${encodeURIComponent(session.id)}`,
            { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
        )));

        const response = json({ ok: true, user: { email: user.email } });
        setSessionCookie(response, token);
        return response;
    } catch (error) {
        console.error('로그인 인증 실패:', error instanceof Error ? error.message : 'unknown');
        return json({ error: '로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, 500);
    }
}
