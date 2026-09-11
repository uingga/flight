import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { PromotionDailyView } from '@/components/AdminPromotionDaily';
import AdminTe31Posts from '@/components/AdminTe31Posts';
import { promotionFixture } from '../../../../scripts/fixtures/promotion-daily';
export const dynamic = 'force-dynamic';
export default function Preview({ searchParams }: { searchParams: { state?: string } }) {
    const host = headers().get('host')?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host || '') || process.env.VERCEL || !process.env.FLIGHT_ORDER_PREVIEW_DIR || !process.env.ADMIN_KEY) notFound();
    return <main style={{ maxWidth: 1200, padding: 16, margin: '0 auto' }}><h1 style={{ fontSize: 22 }}>일별 성과 화면 검증</h1><p>합성 예시 데이터 · 실시간 통계가 아닙니다.</p>
        <PromotionDailyView data={searchParams.state === 'empty' ? { latest: [], runs: [], sources: [] } : promotionFixture()} />
        <AdminTe31Posts dailyMode campaigns={[]} available days={30} />
    </main>;
}
