'use client';

import { Fragment, useState } from 'react';
import styles from './AdminThreadsPosts.module.css';

interface Post {
    id: string; text: string; timestamp: string; permalink: string;
    metrics: { views: number; likes: number; replies: number; reposts: number; quotes: number; shares: number };
    engagementRate: number | null; trackingContent: string | null; attributionShared: boolean;
    attribution: { users: number; sessions: number; detailUsers: number; detailOpens: number; bookingUsers: number; bookingClicks: number } | null;
}
type SortKey = 'date' | 'views' | 'reactions' | 'rate' | 'users' | 'details' | 'bookings';
const reactions = (post: Post) => post.metrics.likes + post.metrics.replies + post.metrics.reposts + post.metrics.quotes + post.metrics.shares;
const dateLabel = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '게시 시각 없음';
export default function AdminThreadsPosts({ posts, attributionAvailable }: { posts: Post[]; attributionAvailable: boolean }) {
    const [sort, setSort] = useState<SortKey>('date');
    const [ascending, setAscending] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const value = (post: Post, key: SortKey): number | null => {
        if (key === 'date') return Number.isFinite(Date.parse(post.timestamp)) ? Date.parse(post.timestamp) : null;
        if (key === 'views') return post.metrics.views;
        if (key === 'reactions') return reactions(post);
        if (key === 'rate') return post.engagementRate;
        if (!attributionAvailable || !post.attribution) return null;
        return key === 'users' ? post.attribution.users : key === 'details' ? post.attribution.detailUsers : post.attribution.bookingUsers;
    };
    const sorted = [...posts].sort((a, b) => {
        const av = value(a, sort), bv = value(b, sort);
        if (av === null || bv === null) return av === bv ? a.id.localeCompare(b.id) : av === null ? 1 : -1;
        return (ascending ? av - bv : bv - av) || a.id.localeCompare(b.id);
    });
    const columns: Array<[SortKey, string]> = [['date', '글 · 게시일'], ['views', '조회'], ['reactions', '반응'], ['rate', '반응률'], ['users', '방문'], ['details', '상세'], ['bookings', '예약 이동']];
    const siteCell = (post: Post, users: 'users' | 'detailUsers' | 'bookingUsers', count: 'sessions' | 'detailOpens' | 'bookingClicks') => attributionAvailable && post.attribution
        ? <><strong>{post.attribution[users].toLocaleString()}명</strong><small>{post.attribution[count].toLocaleString()}회</small></> : <span title={!attributionAvailable ? '사이트 통계 조회 불가' : post.trackingContent ? '확인되는 방문 기록 없음' : '글별 추적 링크 없음'}>—</span>;
    return <div className={styles.panel}>
        <div className={styles.help}><span>{posts.length}개 글 · 열 제목을 누르면 정렬</span><span>Threads 누적 반응 / 사이트 최근 30일</span></div>
        <div className={styles.mobileSort}><label>정렬 <select aria-label="정렬" value={sort} onChange={event => { setSort(event.target.value as SortKey); setAscending(false); }}>{columns.map(([key, label]) => <option value={key} key={key}>{key === 'date' ? '게시일' : label}</option>)}</select></label><button type="button" onClick={() => setAscending(value => !value)}>{ascending ? '오름차순 ↑' : '내림차순 ↓'}</button></div>
        <div className={styles.scroll} tabIndex={0} role="region" aria-label="Threads 글별 성과 비교">
            <table className={styles.table}>
                <thead><tr>{columns.map(([key, label]) => <th key={key} scope="col" aria-sort={sort === key ? ascending ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { setSort(key); setAscending(sort === key ? !ascending : false); }}>{label}<span aria-hidden="true">{sort === key ? ascending ? ' ↑' : ' ↓' : ' ↕'}</span></button></th>)}</tr></thead>
                <tbody>{sorted.map(post => <Fragment key={post.id}>
                    <tr>
                        <td><button type="button" className={styles.post} aria-expanded={expanded === post.id} aria-controls={`threads-detail-${post.id}`} onClick={() => setExpanded(expanded === post.id ? null : post.id)}><span className={styles.excerpt}>{post.text || '(본문 없음)'}</span><span className={styles.meta}><time dateTime={post.timestamp}>{dateLabel(post.timestamp)}</time><span>{expanded === post.id ? '접기 −' : '상세 +'}</span></span></button>{post.attributionShared && <small className={styles.shared}>공유 링크 중복</small>}</td>
                        <td data-label="조회">{post.metrics.views.toLocaleString()}</td><td data-label="반응">{reactions(post).toLocaleString()}</td><td data-label="반응률">{post.engagementRate === null ? '—' : `${post.engagementRate}%`}</td>
                        <td data-label="방문">{siteCell(post, 'users', 'sessions')}</td><td data-label="상세">{siteCell(post, 'detailUsers', 'detailOpens')}</td><td data-label="예약 이동">{siteCell(post, 'bookingUsers', 'bookingClicks')}</td>
                    </tr>
                    {expanded === post.id && <tr id={`threads-detail-${post.id}`} className={styles.detail}><td colSpan={7}>
                        <p className={styles.body}>{post.text || '(본문 없음)'}</p>
                        <dl>{([['좋아요', post.metrics.likes], ['답글', post.metrics.replies], ['재게시', post.metrics.reposts], ['인용', post.metrics.quotes], ['공유', post.metrics.shares]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl>
                        {!attributionAvailable ? <p>사이트 통계를 불러오지 못했습니다.</p> : !post.attribution && <p>{post.trackingContent ? '추적 링크는 확인됐지만 최근 30일 확인되는 방문 기록이 없습니다.' : '추적 가능한 링크가 없어 사이트 행동을 글별로 구분할 수 없습니다.'}</p>}
                        {post.attributionShared && <p>같은 링크를 쓴 여러 글에 동일한 사이트 수치가 표시됩니다. 글별 성과로 분리하거나 합산하지 마세요.</p>}
                        {post.permalink && <a href={post.permalink} target="_blank" rel="noopener noreferrer">Threads 원문 보기 ↗</a>}
                    </td></tr>}
                </Fragment>)}</tbody>
            </table>
        </div>
        <p className={styles.note}>방문·상세·예약 이동은 인원과 횟수를 함께 표시합니다. —는 확인 불가 또는 기록 없음이며 0으로 추정하지 않습니다. 예약 이동은 예약 완료가 아닙니다.</p>
    </div>;
}
