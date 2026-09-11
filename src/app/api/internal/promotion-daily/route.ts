import { NextRequest, NextResponse } from 'next/server';
import { kstDay } from '@/lib/promotion-daily';
import { headerAuthorized } from '@/lib/server/promotion-http';
import { SupabasePromotionStore } from '@/lib/server/promotion-store';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: NextRequest) {
    const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (!headerAuthorized(request.headers, process.env.PROMOTION_JOB_SECRET)) return json({ error: 'unauthorized' }, 401);
    if (!process.env.GH_PAT) return json({ error: 'dispatch_config_missing' }, 503);
    const store = new SupabasePromotionStore(); const day = kstDay();
    try {
        if (!await store.rpc<boolean>('promotion_claim_dispatch', { p_day: day })) return json({ action: 'skipped', day });
        let ok = false;
        try {
            const response = await fetch('https://api.github.com/repos/uingga/flight/actions/workflows/promotion-daily.yml/dispatches', {
                method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
                headers: { Authorization: `Bearer ${process.env.GH_PAT}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
                body: JSON.stringify({ ref: 'main', inputs: { day } }),
            });
            ok = response.status === 204;
        } finally {
            await store.request(`promotion_daily_dispatches?day=eq.${day}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: ok ? 'dispatched' : 'failed' }) });
        }
        return json({ action: ok ? 'dispatched' : 'failed', day }, ok ? 200 : 502);
    } catch { return json({ error: 'promotion_dispatch_failed' }, 503); }
}
