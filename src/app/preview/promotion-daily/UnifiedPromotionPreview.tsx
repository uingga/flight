'use client';
import { useState } from 'react';
import AdminThreadsPosts from '@/components/AdminThreadsPosts';
import AdminTe31Posts from '@/components/AdminTe31Posts';
import { PromotionHistoryProvider, PromotionHistoryStatus } from '@/components/PromotionHistory';
import { type DailyHistory, observedMetrics } from '@/lib/promotion-daily';
import styles from '../../admin/admin.module.css';

export default function UnifiedPromotionPreview({ data }: { data: DailyHistory }) {
    const [channel, setChannel] = useState('threads');
    const posts = [
        { id: 'fixture', text: '주말 하루를 더 붙이면, 여행이 됩니다.\n금요일에 출발해 월요일에 돌아오는 일정으로 짧은 여행을 준비해 보세요.\n항공권을 비교하고 나에게 맞는 출발 시간을 골라볼 수 있어요. (합성 예시)', timestamp: '2026-09-11T00:00:00Z', permalink: '', metrics: { views: 120, likes: 2, replies: 1, reposts: 0, quotes: 0, shares: 0 }, engagementRate: 2.5, trackingContent: 'fixture', attributionShared: false, attribution: { users: 9, sessions: 10, detailUsers: 3, detailOpens: 4, bookingUsers: 1, bookingClicks: 1 } },
        { id: 'no-history', text: '낯선 도시에서 보내는 며칠\n익숙한 여행지 대신 새로운 골목과 풍경을 만나는 여행. (합성 예시)', timestamp: '2026-09-10T00:00:00Z', permalink: '', metrics: { views: 60, likes: 1, replies: 0, reposts: 0, quotes: 0, shares: 0 }, engagementRate: 1.7, trackingContent: null, attributionShared: false, attribution: null },
    ];
    const demo = { ...data, sources: [...data.sources] };
    for (const [day, views, users] of [['2026-09-10', 100, 2], ['2026-09-11', 120, 3]] as const) {
        const at = day + 'T01:00:00Z';
        for (const platform of ['threads', 'te31']) {
            const id = platform === 'threads' ? 'fixture' : '5248';
            demo.sources.push({ day, source: platform, payload: { source: platform, outcome: 'success', reason: 'fixture', observedAt: at, posts: [{ id, platform, title: '합성 예시', url: '', metrics: observedMetrics({ views, likes: 2, replies: 1, comments: 1 }, day, at) }] } });
            demo.sources.push({ day, source: 'ga4', payload: { source: 'ga4', outcome: 'success', reason: 'fixture', observedAt: at, posts: [{ id: platform + ':' + id, platform, title: '합성 예시', url: '', metrics: observedMetrics({ users, detailUsers: 1, bookingUsers: 0 }, day, at) }] } });
        }
    }
    return <main style={{ maxWidth:1120, margin:'0 auto', padding:16 }}>
        <p>합성 예시 데이터 · 실시간 통계가 아닙니다.</p>
        <PromotionHistoryProvider initialData={demo}>
            <section className={styles.section}><div className={styles.sectionHeading}><h2>홍보 성과</h2><div><button className={styles.analyticsToggle} aria-pressed={channel === 'threads'} onClick={() => setChannel('threads')}>Threads</button> <button className={styles.analyticsToggle} aria-pressed={channel === 'te31'} onClick={() => setChannel('te31')}>TE31</button></div></div></section>
            {channel === 'threads' ? <>
                <div className={styles.tabIntro}><div><span className={styles.eyebrow}>THREADS</span><h2>어떤 글이 사람을 데려왔는지 봅니다</h2><p>글의 조회·반응은 Threads에서, 사이트 방문·상세·예약 페이지 이동은 GA4에서 가져옵니다.</p></div></div>
                <section className={styles.section}><div className={styles.sectionHeading}><h2>최근 Threads 성과</h2></div><div className={styles.signalGridFour}>{[['글 조회','180회'],['반응','4회'],['링크별 방문 인원 합계','9명'],['링크별 예약 이동 인원 합계','1명']].map(([label,value]) => <div className={styles.signalCard} key={label}><span>{label}</span><strong>{value}</strong><small>합성 예시</small></div>)}</div></section>
                <section className={styles.section}><div className={styles.sectionHeading}><h2>글별 인사이트</h2></div><AdminThreadsPosts posts={posts} attributionAvailable generatedAt="2026-09-11T01:00:00Z" /></section>
            </> : <section className={styles.section}><h2>TE31 글별 성과</h2><AdminTe31Posts dailyMode campaigns={[]} available days={30} /></section>}
            <PromotionHistoryStatus />
        </PromotionHistoryProvider>
    </main>;
}
