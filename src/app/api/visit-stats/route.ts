import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { koreaVisitDay, type VisitReport } from '@/lib/visit-analytics';
import { hasSupabaseServerConfig, supabaseRest } from '@/lib/server/supabase-rest';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request: NextRequest) {
    const expected = process.env.ADMIN_KEY;
    const provided = request.headers.get('authorization')?.replace(/^Bearer /,'') || '';
    if (!expected || Buffer.byteLength(provided) !== Buffer.byteLength(expected)
        || !timingSafeEqual(Buffer.from(provided),Buffer.from(expected))) return json({error:'Unauthorized'},401);
    if (process.env.VISIT_ANALYTICS_ENABLED !== 'true' || !hasSupabaseServerConfig()) {
        return json({available:false,mode:'shadow',message:'자체 방문 기록은 아직 수집하지 않습니다. 저장소·보관 정리 설정 후 활성화합니다.'});
    }
    const day = request.nextUrl.searchParams.get('day') || koreaVisitDay(Date.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00+09:00`))
        || day > koreaVisitDay(Date.now()) || day < koreaVisitDay(Date.now() - 89 * 86_400_000)
        || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) !== day) return json({error:'Invalid day'},400);
    try {
        const report = await supabaseRest<VisitReport>('rpc/tikitikit_visit_report',{
            method:'POST',signal:AbortSignal.timeout(5000),body:JSON.stringify({p_day:day}),
        });
        if (!report || !Array.isArray(report.channels) || !Number.isInteger(report.sessions)
            || report.channels.reduce((sum,row)=>sum + row.sessions,0) !== report.sessions || !report.reconciled) {
            throw new Error('Visit reconciliation failed');
        }
        return json({...report,available:true,mode:'shadow'});
    } catch {
        return json({available:false,mode:'shadow',message:'자체 방문 기록을 불러오지 못했습니다. 기존 GA4 통계는 그대로 유지됩니다.'},503);
    }
}
