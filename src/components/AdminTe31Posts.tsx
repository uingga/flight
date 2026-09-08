'use client';

import { TE31_POSTS, TE31_OBSERVED_AT, matchTe31Campaign, unmatchedTe31Campaigns, type Te31Campaign } from '@/lib/te31-posts';
import styles from './AdminThreadsPosts.module.css';

const people = (value: number | null | undefined) => value == null ? '—' : `${value.toLocaleString()}명`;

export default function AdminTe31Posts({ campaigns, available, days, generatedAt, error }: {
    campaigns: readonly Te31Campaign[] | null | undefined;
    available: boolean;
    days: number;
    generatedAt?: string;
    error?: string | null;
}) {
    const ready = available && campaigns != null && !error;
    const unmatched = unmatchedTe31Campaigns(campaigns);
    return <div className={styles.panel}>
        <div className={styles.help}><span>등록 글 {TE31_POSTS.length}개 · 최신 게시일 순</span><span>사이트 최근 {days}일 · 오늘 현재까지</span></div>
        <p className={styles.note}>TE31 조회·댓글·추천은 <time dateTime={TE31_OBSERVED_AT}>2026. 9. 8. 19:40 KST경</time> 수동 확인한 누적값입니다. 새로고침해도 외부 수치는 자동 갱신되지 않습니다.</p>
        {!ready && <p role="status">{error || '사이트 통계를 아직 확인할 수 없습니다. 아래 외부 관측값만 표시합니다.'}</p>}
        <div className={styles.scroll} tabIndex={0} role="region" aria-label="TE31 글별 성과 비교">
            <table className={styles.table}>
                <thead><tr>{['글 · 게시일', '조회', '댓글', '추천', '방문', '상세', '예약 이동'].map(label => <th key={label} scope="col" style={{ paddingTop: 13, paddingBottom: 13 }}>{label}</th>)}</tr></thead>
                <tbody>{TE31_POSTS.map(post => {
                    const row = ready ? matchTe31Campaign(post.campaign, campaigns) : null;
                    const status = !post.campaign ? '글별 추적 불가' : !ready ? '사이트 통계 확인 불가' : !row ? '집계 기록 없음' : '전용 링크로 연결';
                    return <tr key={post.id}>
                        <td><a href={`https://te31.com/rgr/view.php?id=freead&no=${post.id}`} target="_blank" rel="noopener noreferrer" className={styles.post}>{post.title} ↗</a><span className={styles.meta}><time dateTime={post.date}>{post.date}</time><span>{status}</span></span>
                            <details className={styles.trackingDetails}><summary>추적 기준</summary>{post.campaign ? <><p>출처 te31 + 캠페인 <code>{post.campaign}</code> 일치 기준입니다. 링크를 다른 곳에 재공유한 방문도 포함될 수 있습니다.</p><p>게시 링크: <code>{post.link}</code></p>{!row && <p>기록이 없거나 조회할 수 없는 경우 0명으로 추정하지 않습니다.</p>}</> : <p>글 전용 추적 코드가 확인되지 않아 과거 사이트 행동을 이 글에 소급 배정하지 않습니다.</p>}</details>
                        </td>
                        <td data-label="조회">{post.views}</td><td data-label="댓글">{post.comments}</td><td data-label="추천">{post.recommendations ?? '—'}</td>
                        <td data-label="방문"><strong>{people(row?.users)}</strong>{row && <small>{row.sessions.toLocaleString()}회 접속</small>}</td>
                        <td data-label="상세">{people(row?.detailOpenUsers)}</td>
                        <td data-label="예약 이동"><strong>{people(row?.bookingClickUsers)}</strong>{row?.bookingClicks != null && <small>{row.bookingClicks.toLocaleString()}회 이동</small>}</td>
                    </tr>;
                })}</tbody>
            </table>
        </div>
        {ready && unmatched.length > 0 && <details className={styles.trackingDetails}><summary>글을 특정하지 못한 TE31 캠페인 {unmatched.length}개</summary><p>과거 공통 캠페인 등은 임의로 한 글에 합치지 않습니다.</p>{unmatched.map(row => <p key={row.name}><code>{row.name}</code> · 방문 {people(row.users)} · 상세 {people(row.detailOpenUsers)} · 예약 이동 {people(row.bookingClickUsers)}</p>)}</details>}
        <p className={styles.note}>—는 확인 불가 또는 기록 없음입니다. 확인된 0만 숫자로 표시합니다. 같은 사람이 여러 글에 포함될 수 있어 인원을 합산하지 않습니다. 예약 이동은 예약 완료가 아닙니다. GA4 반영 지연으로 최근 방문이 아직 보이지 않을 수 있습니다.</p>
        {generatedAt && <p className={styles.note}>사이트 통계 조회 시각: {new Date(generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</p>}
    </div>;
}
