import { NextRequest, NextResponse } from 'next/server';
import {
    createSessionToken,
    hashAuthValue,
    isSameOriginRequest,
    normalizeEmail,
    safeEqualHex,
    setSessionCookie,
    type AccountUser,
} from '@/lib/server/account-auth';
import { supabaseRest } from '@/lib/server/supabase-rest';

export const dynamic = 'force-dynamic';

interface CodeRow {
    id: string;
    code_hash: string;
    attempt_count: number;
}

function json(body: Record<string, unknown>, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store, private' },
    });
}

export async function POST(request: NextRequest) {
    if (!isSameOriginRequest(request)) return json({ error: '잘못된 요청이에요.' }, 403);
    if (Number(request.headers.get('content-length') || 0) > 4_096) return json({ error: '요청이 너무 커요.' }, 413);
    let input: { email?: unknown; code?: unknown; requestId?: unknown };
    try { input = await request.json(); } catch { return json({ error: '인증번호를 확인해 주세요.' }, 400); }

    const email = normalizeEmail(input.email);
    const code = typeof input.code === 'string' ? input.code.replace(/\D/g, '') : '';
    const requestId = typeof input.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(input.requestId)
        ? input.requestId
        : '';
    if (!email || code.length !== 6 || !requestId) return json({ error: '인증번호를 확인해 주세요.' }, 400);

    const emailHash = hashAuthValue('email', email);
    const now = new Date().toISOString();
    try {
        const rows = await supabaseRest<CodeRow[]>(
            `tikitikit_auth_codes?select=id,code_hash,attempt_count&id=eq.${requestId}&email_hash=eq.${emailHash}&used_at=is.null&expires_at=gt.${encodeURIComponent(now)}&limit=1`,
        );
        const row = rows[0];
        if (!row || row.attempt_count >= 5) return json({ error: '인증번호가 만료됐어요. 새 번호를 받아 주세요.' }, 400);

        const expected = hashAuthValue('login-code', `${requestId}:${email}:${code}`);
        if (!safeEqualHex(row.code_hash, expected)) {
            await supabaseRest(`tikitikit_auth_codes?id=eq.${requestId}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({ attempt_count: row.attempt_count + 1 }),
            });
            return json({ error: '인증번호가 맞지 않아요.' }, 400);
        }

        const claimed = await supabaseRest<CodeRow[]>(
            `tikitikit_auth_codes?id=eq.${requestId}&used_at=is.null`,
            {
                method: 'PATCH',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({ used_at: now }),
            },
        );
        if (claimed.length !== 1) return json({ error: '이미 사용한 인증번호예요.' }, 400);

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
