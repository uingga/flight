import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { promotionFixture } from '../../../../scripts/fixtures/promotion-daily';
import UnifiedPromotionPreview from './UnifiedPromotionPreview';
import { PromotionDailyView } from '@/components/AdminPromotionDaily';
export const dynamic = 'force-dynamic';
export default function Preview({ searchParams }: { searchParams: { layout?: string; state?: string } }) {
    const host = headers().get('host')?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host || '') || process.env.VERCEL || !process.env.FLIGHT_ORDER_PREVIEW_DIR || !process.env.ADMIN_KEY) notFound();
    // Keep the prior isolated view for storage/auth regression checks only.
    if (searchParams.layout === 'daily') return <main><p>합성 예시 데이터 · 실시간 통계가 아닙니다.</p><PromotionDailyView data={searchParams.state === 'empty' ? { latest:[], sources:[], runs:[] } : promotionFixture()} /></main>;
    return <UnifiedPromotionPreview data={promotionFixture()} />;
}
