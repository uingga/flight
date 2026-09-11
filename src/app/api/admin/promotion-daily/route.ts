import { NextRequest, NextResponse } from 'next/server';
import { headerAuthorized } from '@/lib/server/promotion-http';
import { SupabasePromotionStore } from '@/lib/server/promotion-store';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
    const headers = { 'Cache-Control': 'private, no-store' };
    if (!headerAuthorized(request.headers, process.env.ADMIN_KEY)) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers });
    const raw = request.nextUrl.searchParams.get('days') || '30';
    if (!/^\d+$/.test(raw) || +raw < 1 || +raw > 90) return NextResponse.json({ error: 'invalid_days' }, { status: 400, headers });
    try { return NextResponse.json(await new SupabasePromotionStore().history(+raw), { headers }); }
    catch { return NextResponse.json({ error: '일별 저장 기록을 불러오지 못했습니다.' }, { status: 503, headers }); }
}
