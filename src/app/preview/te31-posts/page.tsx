import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import AdminTe31Posts from '@/components/AdminTe31Posts';
import { flightOrderStorageMode } from '@/lib/server/flight-order-store';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'TE31 비교 검증', robots: { index: false, follow: false } };
export default function Preview({ searchParams }: { searchParams: { state?: string } }) {
    const host = headers().get('host')?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host || '') || process.env.VERCEL || flightOrderStorageMode() !== 'preview' || !process.env.ADMIN_KEY) notFound();
    const campaigns = [
        { name: 'tikitikit_te31_icn-260909', source: 'te31', users: 3, sessions: 4, detailOpenUsers: 2, bookingClickUsers: 0, bookingClicks: 0 },
        { name: 'tikitikit_te31_pus-260908', source: 'te31', users: 3, sessions: 4, detailOpenUsers: 2, bookingClickUsers: 0, bookingClicks: 0 },
        { name: 'tikitikit_te31_pqc1438', source: 'te31', users: 7, sessions: 9, detailOpenUsers: null, bookingClickUsers: null, bookingClicks: null },
        { name: 'tikitikit_te31', source: 'te31', users: 2, sessions: 2, detailOpenUsers: 1, bookingClickUsers: 1, bookingClicks: 1 },
    ];
    return <main style={{ maxWidth: 1250, margin: '0 auto', padding: 20 }}><h1>TE31 검증용 · 사이트 수치는 가상 데이터</h1><AdminTe31Posts campaigns={searchParams.state === 'empty' ? [] : campaigns} available={searchParams.state !== 'unavailable'} days={30} /></main>;
}
