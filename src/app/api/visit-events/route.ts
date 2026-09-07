import { createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { koreaVisitDay, parseVisitPayload } from '@/lib/visit-analytics';
import { hasSupabaseServerConfig, supabaseRest } from '@/lib/server/supabase-rest';

export const dynamic = 'force-dynamic';
const MAX_BYTES = 1024;
const reply = (status: number) => new NextResponse(null, {status,headers:{'Cache-Control':'no-store'}});

async function readPayload(request: NextRequest) {
    if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new Error('size');
    const reader = request.body?.getReader();
    if (!reader) throw new Error('body');
    let size = 0; let text = ''; const decoder = new TextDecoder();
    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('size'); }
        text += decoder.decode(chunk.value,{stream:true});
    }
    return JSON.parse(text + decoder.decode()) as unknown;
}
export async function POST(request: NextRequest) {
    if (process.env.VISIT_ANALYTICS_ENABLED !== 'true' || !hasSupabaseServerConfig()) return reply(503);
    // No deployment previews, third-party submissions, or collector cookies.
    const origin = request.headers.get('origin');
    if (origin !== request.nextUrl.origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply(403);
    if (process.env.NODE_ENV === 'production' && !['tikitikit.kr','www.tikitikit.kr'].includes(request.nextUrl.hostname)) return reply(403);
    if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return reply(204);
    if (/bot|crawler|spider|headless|lighthouse|playwright|puppeteer/i.test(request.headers.get('user-agent') || '')) return reply(204);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply(415);
    let input: unknown;
    try { input = await readPayload(request); } catch { return reply(400); }
    const payload = parseVisitPayload(input,Date.now());
    if (!payload) return reply(400);
    const secret = process.env.VISIT_ANALYTICS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const hash = (value: string) => createHmac('sha256',secret).update(value).digest('hex');
    // An IP-derived DAILY rate key is not a visitor ID and cannot be joined to visit rows.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    try {
        const result = await supabaseRest<string>('rpc/tikitikit_record_visit',{
            method:'POST',signal:AbortSignal.timeout(3000),body:JSON.stringify({
                p_id:payload.visitId,p_visitor_key:hash(`visit-browser:${payload.visitorId}`),
                p_started_at:new Date(payload.startedAt).toISOString(),p_channel:payload.channel,p_action:payload.action,
                p_rate_key:hash(`visit-rate:${koreaVisitDay(Date.now())}:${ip}`),
            }),
        });
        return reply(result === 'recorded' ? 204 : result === 'limited' ? 429 : result === 'conflict' ? 409 : 400);
    } catch {
        // Never log payloads, IPs or database response bodies.
        console.error('Visit analytics storage unavailable');
        return reply(503);
    }
}
