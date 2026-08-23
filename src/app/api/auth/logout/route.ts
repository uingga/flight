import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies, deleteCurrentSession, isSameOriginRequest } from '@/lib/server/account-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    if (!isSameOriginRequest(request)) {
        return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 403 });
    }
    try { await deleteCurrentSession(); } catch (error) {
        console.error('로그아웃 세션 삭제 실패:', error instanceof Error ? error.message : 'unknown');
    }
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store, private' } });
    clearSessionCookies(response);
    return response;
}
