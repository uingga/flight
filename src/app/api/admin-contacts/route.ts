import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/server/account-auth';
import { supabaseRest } from '@/lib/server/supabase-rest';

export const dynamic = 'force-dynamic';
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const authorized = (request: NextRequest) => Boolean(process.env.ADMIN_KEY && request.headers.get('x-admin-key') === process.env.ADMIN_KEY);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function GET(request: NextRequest) {
    if (!authorized(request)) return response({ error: 'Unauthorized' }, 401);
    try {
        const id = request.nextUrl.searchParams.get('id');
        if (id && !uuid(id)) return response({ error: '잘못된 문의 번호입니다.' }, 400);
        const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return response({ error: '잘못된 페이지입니다.' }, 400);
        const rows = await supabaseRest(id
            ? `contact_inquiries?select=*&id=eq.${id}`
            : `contact_inquiries?select=id,category,status,created_at&order=created_at.desc,id.desc&limit=30&offset=${offset}`);
        return response({ rows });
    } catch { return response({ error: '문의함을 불러오지 못했어요. 저장소 설정을 확인해주세요.' }, 503); }
}

export async function PATCH(request: NextRequest) {
    if (!authorized(request)) return response({ error: 'Unauthorized' }, 401);
    if (!isSameOriginRequest(request)) return response({ error: '잘못된 요청입니다.' }, 403);
    try {
        const raw = await request.text();
        if (raw.length > 512) return response({ error: '요청이 너무 큽니다.' }, 413);
        const { id, status } = JSON.parse(raw);
        if (!uuid(id) || !['new', 'in_progress', 'resolved'].includes(status)) return response({ error: '잘못된 요청입니다.' }, 400);
        const rows = await supabaseRest<unknown[]>(`contact_inquiries?id=eq.${id}&status=neq.resolved`, {
            method: 'PATCH', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ status, updated_at: new Date().toISOString(),
                ...(status === 'resolved' ? { name: '', email: null, message: '', attachment: null } : {}) }),
        });
        if (!rows.length) return response({ error: '이미 처리 완료되었거나 없는 문의입니다.' }, 409);
        return response({ success: true });
    } catch { return response({ error: '처리 상태를 저장하지 못했어요.' }, 503); }
}
