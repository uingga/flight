import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ga4Config, runReport, runBatchReports } from '@/lib/ga4';
import { loadRetention } from '@/lib/ga-retention';

export const maxDuration = 120;
export async function GET(request: NextRequest) {
    const expected = process.env.ADMIN_KEY;
    const supplied = request.headers.get('x-admin-key') || '';
    if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(supplied)
        || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const headers = { 'Cache-Control': 'private, no-store' };
    const config = ga4Config();
    if (!config) return NextResponse.json({ available: false, message: 'GA4 연결 설정이 필요합니다.' }, { headers });
    try {
        const report = await runReport(config, {
            dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }], metrics: [{ name: 'totalUsers' }],
        });
        const timeZone = report.metadata?.timeZone;
        // Never silently substitute KST for an unknown GA property time zone.
        if (!timeZone) throw new Error('Missing property time zone');
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const part = (name: string) => parts.find(value => value.type === name)?.value;
        const today = `${part('year')}-${part('month')}-${part('day')}`;
        const data = await loadRetention(config.propertyId, today, timeZone, requests => runBatchReports(config, requests));
        return NextResponse.json({ available: true, ...data }, { headers });
    } catch {
        // Do not turn API failure, thresholding or inconsistent counts into 0%.
        return NextResponse.json({ available: false, message: '재방문율을 확인하지 못했습니다. 데이터 누락·처리 지연 또는 조회 제한일 수 있습니다.' }, { headers });
    }
}
