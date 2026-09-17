import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import AdminCollectionHistory from '@/components/AdminCollectionHistory';
import type { CrawlHistoryEntry } from '@/lib/admin-collection-history';

export const dynamic = 'force-dynamic';
export const metadata = { title: '수집 실행 기록 미리보기', robots: { index: false, follow: false } };
export default function Preview({ searchParams }: { searchParams: { state?: string } }) {
    if (process.env.VERCEL || !['127.0.0.1', 'localhost'].includes(headers().get('host')?.split(':')[0] || '')) notFound();
    const flight = { id: 'example', route: '부산 → 미야코지마', airline: '진에어', price: 199000, departureDate: '2026-10-20', returnDate: '2026-10-24' };
    const history: CrawlHistoryEntry[] = searchParams.state === 'empty' ? [] : [
        { timestamp: '2026-09-17T10:35:00+09:00', sites: { ybtour: { scraped: 135, total: 42, added: 3, removed: 1, addedFlights: [flight], removedFlights: [{ ...flight, id: 'removed', price: 229000 }] }, hanatour: { scraped: 210, total: 80, added: 5, removed: 5 }, modetour: { total: 20, preserved: true, detail: '응답 오류로 이전 정상 표를 유지했습니다.' }, ttang: { total: 25, skipped: true, skipReason: 'schedule' } }, alerts: ['모두투어 응답 오류'] },
        { timestamp: '2026-09-17T07:25:00+09:00', sites: { myrealtrip: { scraped: 160, total: 98, added: 4, removed: 2, addedFlights: [flight] } }, alerts: [] },
        { timestamp: '2026-09-16T16:45:00+09:00', sites: { ybtour: { total: 40 } }, alerts: [] },
    ];
    return <main style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px', color: '#243246' }}><h1>수집 실행 기록</h1><p>화면 검토용 예시입니다. 운영 수치가 아닙니다.</p>
        <AdminCollectionHistory history={history} naver={searchParams.state === 'empty' ? [] : [{ id: 'example-naver', timestamp: '2026-09-17T11:40:00+09:00', runner: 'local', sourceFilter: 'all', maxFlights: 200, needed: 180, attempted: 80, success: 72, misses: 8, deferred: 100, deferredNeverChecked: 20, oldestDeferredHours: 48, newRoutes: 30, newRoutesAttempted: 20, abortedEarly: false, noResult: 8 }]} />
    </main>;
}
