import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import AdminFlightOrder from '@/components/AdminFlightOrder';
import { flightOrderStorageMode } from '@/lib/server/flight-order-store';

export const dynamic = 'force-dynamic';
export const metadata = { title: '항공권 순서 편집 미리보기', robots: { index: false, follow: false } };

export default function FlightOrderPreview() {
    const host = headers().get('host')?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host || '') || process.env.VERCEL || flightOrderStorageMode() !== 'preview' || !process.env.ADMIN_KEY) notFound();
    return <main style={{ maxWidth: 1000, margin: '0 auto', padding: '16px' }}>
        <a href="/" target="_blank" rel="noopener noreferrer">적용한 추천순을 메인 화면에서 보기 ↗</a>
        <AdminFlightOrder adminKey={process.env.ADMIN_KEY} />
    </main>;
}
