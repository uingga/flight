import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import todayPick from '../../../data/today-pick.json';
import { loadActiveFlights } from '@/lib/flight-static';
import { currentDropDestination } from '@/lib/current-drop-destination';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
    title: '오늘의 TIKIT DROP',
    robots: { index: false, follow: true },
};

export default function DropPage() {
    const destination = currentDropDestination(todayPick, loadActiveFlights());
    if (destination) redirect(destination);
    return <main style={{ maxWidth: 640, margin: '80px auto', padding: '0 24px', lineHeight: 1.7 }}>
        <Link href="/">← 항공권 목록</Link>
        <h1>오늘의 TIKIT DROP</h1>
        <p>지금 확인할 수 있는 DROP이 없습니다.</p>
        <p>선정된 항공권이 없거나 판매 목록에서 사라졌습니다. 새 DROP이 준비되면 여기서 확인할 수 있어요.</p>
        <Link href="/">지금 나온 항공권 보기 →</Link>
    </main>;
}
