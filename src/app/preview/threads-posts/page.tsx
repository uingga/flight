import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import AdminThreadsPosts from '@/components/AdminThreadsPosts';
import { flightOrderStorageMode } from '@/lib/server/flight-order-store';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Threads 비교 미리보기', robots: { index: false, follow: false } };
export default function Preview({ searchParams }: { searchParams: { state?: string } }) {
    const host = headers().get('host')?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host || '') || process.env.VERCEL || flightOrderStorageMode() !== 'preview' || !process.env.ADMIN_KEY) notFound();
    const posts = Array.from({ length: 12 }, (_, index) => ({ id: `demo-${index}`, text: `${['오사카 왕복 표를 찾았어요.', '이번 주말, 부산에서 출발하는 후쿠오카 항공권.', '방콕으로 떠날 날짜를 골라봤어요.'][index % 3]}\n본문을 펼치면 일정과 소개 내용을 끝까지 확인할 수 있습니다.\n이 문장은 화면 검증을 위한 예시입니다.`, timestamp: `2026-09-${String(8 - Math.floor(index / 2)).padStart(2, '0')}T${index % 2 ? '09' : '12'}:00:00+09:00`, permalink: '', metrics: { views: (index + 1) * 123, likes: index * 3, replies: index, reposts: 2, quotes: 0, shares: 1 }, engagementRate: index === 3 ? null : 2.8, trackingContent: index === 2 ? null : 'demo-link', attributionShared: index === 4 || index === 5, attribution: index === 2 || index === 3 ? null : { users: index + 2, sessions: index + 4, detailUsers: index + 1, detailOpens: index + 3, bookingUsers: index, bookingClicks: index * 2 } }));
    return <main style={{ maxWidth: 1250, margin: '0 auto', padding: 24 }}><p style={{ color: '#9b3449', fontSize: 13 }}>검증용 예시 데이터 · 운영 통계가 아닙니다</p><h1 style={{ fontSize: 23 }}>Threads 글별 성과</h1><AdminThreadsPosts posts={posts} attributionAvailable={searchParams.state !== 'unavailable'} /></main>;
}
