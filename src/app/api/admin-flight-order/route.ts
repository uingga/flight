import { NextRequest, NextResponse } from 'next/server';
import { GET as getFlights } from '../flights/route';
import { automaticRecommendationList, parsePlacements } from '@/lib/manual-flight-order';
import { FlightOrderConflict, flightOrderStorageMode, readFlightOrder, saveFlightOrder } from '@/lib/server/flight-order-store';
import type { Flight } from '@/types/flight';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function authorized(request: NextRequest) {
    return Boolean(process.env.ADMIN_KEY && request.headers.get('x-admin-key') === process.env.ADMIN_KEY);
}
function sameSite(request: NextRequest) {
    try {
        const origin = new URL(request.headers.get('origin') || '');
        return ['http:', 'https:'].includes(origin.protocol) && origin.host === request.headers.get('host');
    } catch { return false; }
}
async function currentCandidates(request: NextRequest) {
    const response = await getFlights(new NextRequest(new URL('/api/flights?sortBy=price&sortOrder=asc', request.url)));
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error('Flights unavailable');
    return { flights: data.flights as Flight[], data };
}
export async function GET(request: NextRequest) {
    if (!authorized(request)) return json({ error: '관리자 인증이 필요합니다.' }, 401);
    try {
        const mode = flightOrderStorageMode();
        if (mode === 'disabled') return json({ error: '항공권 순서 저장소가 아직 활성화되지 않았습니다.' }, 503);
        const [order, { flights, data }] = await Promise.all([readFlightOrder(), currentCandidates(request)]);
        return json({
            order, mode, todayPickId: data.todayPickId, lastUpdated: data.lastUpdated,
            flights: automaticRecommendationList(flights, data.interparkPrices, data.priceHistory, data.todayPickId),
        });
    } catch { return json({ error: '순서와 항공권을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }, 503); }
}
export async function PUT(request: NextRequest) {
    if (!authorized(request)) return json({ error: '관리자 인증이 필요합니다.' }, 401);
    if (!sameSite(request)) return json({ error: '허용되지 않은 요청입니다.' }, 403);
    let body: { revision: number; placements: ReturnType<typeof parsePlacements> };
    try {
        const raw = await request.text();
        if (raw.length > 20000) return json({ error: '요청이 너무 큽니다.' }, 413);
        const parsed = JSON.parse(raw);
        if (!Number.isSafeInteger(parsed.revision) || parsed.revision < 0) throw new Error();
        body = { revision: parsed.revision, placements: parsePlacements(parsed.placements) };
    } catch { return json({ error: '올바른 배치 정보가 필요합니다. 목록을 새로 불러와 주세요.' }, 400); }
    try {
        const previous = await readFlightOrder();
        if (previous.revision !== body.revision) throw new FlightOrderConflict();
        if (body.placements.length) {
            const { flights } = await currentCandidates(request);
            const counts = new Map<string, number>();
            flights.forEach(flight => { if (flight.manualOrderKey) counts.set(flight.manualOrderKey, (counts.get(flight.manualOrderKey) || 0) + 1); });
            const saved = new Set(previous.placements.map(item => item.key));
            if (body.placements.some(item => !saved.has(item.key) && counts.get(item.key) !== 1)) {
                return json({ error: '현재 노출할 수 없는 항공권이 있습니다. 최신 목록을 불러와 다시 확인해 주세요.' }, 422);
            }
        }
        return json({ order: await saveFlightOrder(body.placements, body.revision) });
    } catch (error) {
        if (error instanceof FlightOrderConflict) return json({ error: '다른 화면에서 순서가 변경됐습니다. 최신 목록을 불러온 뒤 다시 편집해 주세요.' }, 409);
        return json({ error: '저장하지 못했습니다. 편집 내용은 유지됩니다. 잠시 뒤 다시 시도해 주세요.' }, 503);
    }
}
