'use client';
import { useEffect, useState } from 'react';
import { dailyDelta, dayBefore, kstDay, METRIC_LABELS, type DailyHistory, type Metric } from '@/lib/promotion-daily';
import styles from './AdminPromotionDaily.module.css';

const outcome: Record<string, string> = { success: '정상', partial: '일부 확인', failed: '실패', unsupported: '지원 전', running: '진행 중', complete: '완료', incomplete: '미완료' };
const names: Record<string, string> = { threads: 'Threads', te31: 'TE31', ga4: '사이트 행동 · GA4' };
const reasonLabels: Record<string, string> = {
    manual_observations_preserved: '기존 수동 확인값 보존 · 자동 수집 전 기록입니다.',
    listing_sample_required: '실제 목록 표본 검증 전', listing_schema_unverified: '목록 형식 확인 필요', registered_posts_or_counts_missing: '등록 글 또는 수치 일부 누락',
    listing_counts_only: '게시판 목록에서 확인', recent30: '최근 글 30개 범위', metrics_or_replies_incomplete: '일부 지표 또는 본인 답글 확인 불가',
    daily_kst_recent3_provisional: '한국 시간 기준 최근 3일 재확인', token_missing: '연결 토큰 미설정', ga4_config_missing: 'GA4 연결 미설정',
    ga4_timezone_mismatch: 'GA4 속성 시간대 확인 필요', ga4_incomplete_report: 'GA4 보고서 일부 누락 또는 제한', request_failed: '요청 실패',
};
const time = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '아직 없음';
function MetricValue({ cell, delta }: { cell?: Metric; delta: number | null }) {
    return <>{cell ? <><strong>{cell.value.toLocaleString()}</strong><span>{delta === null ? '전날 비교 없음' : `전날 대비 ${delta > 0 ? '+' : ''}${delta.toLocaleString()}`}</span><span>{cell.day} 기준</span><time dateTime={cell.observedAt}>확인 {time(cell.observedAt)}</time></> : <><strong>—</strong><span>확인값 없음</span></>}</>;
}
export function PromotionDailyView({ data }: { data: DailyHistory }) {
    const today = kstDay();
    return <div className={styles.panel}>
        <p>매일 오전 9시 수집 요청 · 한국 시간. 외부 반응은 누적 관측값, 사이트 행동은 날짜별 잠정치입니다. GA4는 어제부터 3일 전까지 다시 확인합니다.</p>
        <p>—는 확인 불가입니다. 첫날이나 바로 전날 기록이 없으면 차이를 계산하지 않습니다. 실패한 값은 마지막 확인값과 시각을 유지합니다.</p>
        {!data.latest.length && <p role="status">아직 저장된 일별 성과가 없습니다.</p>}
        {data.latest.map(({ source, payload }) => {
            const expectedDay = source === 'ga4' ? dayBefore(today) : today;
            const stale = kstDay(new Date(payload.observedAt)) !== today || payload.outcome !== 'success';
            const keys = source === 'ga4' ? ['users', 'sessions', 'detailUsers', 'bookingUsers', 'bookingClicks', 'verifiedUsers']
                : source === 'te31' ? ['views', 'comments', 'recommendations'] : source === 'threads' ? ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'] : Array.from(new Set(payload.posts.flatMap(post => Object.keys(post.metrics))));
            return <section key={source} className={styles.source} aria-label={`${names[source] || source} 일별 성과`}>
                <h3>{names[source] || source} · {outcome[payload.outcome]}{stale ? ' · 최신 확인 필요' : ''}</h3>
                <p>최근 시도 {time(payload.observedAt)} · 마지막 정상 수집 {time(payload.lastSuccessAt)}</p>
                <p>{reasonLabels[payload.reason] || (payload.reason.startsWith('access_') ? '접근 제한으로 중단' : '일부 항목을 확인하지 못했습니다.')}</p>
                {source === 'te31' && <p>추천 등 목록에서 갱신할 수 없는 지표는 과거 확인값과 확인 시각을 유지하며, 기록이 없으면 확인 불가로 표시합니다. 댓글에는 작성자 댓글도 포함될 수 있습니다.</p>}
                {source === 'ga4' && <p>본문·본인 답글·확인 등록의 기존 링크 연결과 TE31의 출처+캠페인 일치 기준을 사용합니다. 공유 링크 방문은 다른 채널 유입도 포함할 수 있습니다. 누적 조회 증가와 하루 방문은 서로 다른 값입니다.</p>}
                <div className={styles.posts}>{payload.posts.map(post => <article key={post.id} className={styles.post}>
                    <h4>{post.url ? <a href={post.url} target="_blank" rel="noopener noreferrer">{post.title || post.id} ↗</a> : post.title || post.id}</h4>
                    <p>{post.platform === 'threads' ? 'Threads' : post.platform === 'te31' ? 'TE31' : post.platform} · {post.trackingContent ? '등록된 추적 링크로 연결' : '글별 사이트 연결 확인 불가'}{post.shared ? ' · 다른 글과 같은 링크 사용' : ''}{post.trackingSource === 'verified-link' ? ' · 원문 확인 등록' : ''}</p>
                    <dl className={styles.metrics}>{keys.map(key => <div key={key}>
                        <dt>{METRIC_LABELS[key] || key}{post.metrics[key] && post.metrics[key].day < expectedDay ? ' · 이전 값' : ''}</dt>
                        <dd><MetricValue cell={post.metrics[key]} delta={post.metrics[key] ? dailyDelta(post.metrics[key], post.id, key, source, data.sources) : null} /></dd>
                    </div>)}</dl>
                </article>)}</div>
            </section>;
        })}
        <details><summary>최근 실행 기록 · {data.runs.length}일</summary><ul className={styles.history}>{data.runs.map(run => <li key={run.day}>
            <strong>{run.day} · {outcome[run.status]}</strong><span>시작 {time(run.started_at)} · 종료 {time(run.finished_at)}</span>
            {data.sources.filter(row => row.day === run.day).map(row => <details key={row.source}><summary>{names[row.source] || row.source}: {outcome[row.payload.outcome]} · {time(row.payload.observedAt)}</summary>
                <p>이 회차에서 확인한 값만 표시합니다. 누락값은 0이 아닙니다.</p>
                {row.payload.posts.map((post, index) => <p key={`${post.id}:${index}`}><strong>{post.title}</strong><br />{Object.entries(post.metrics).map(([key, cell]) => `${cell.day} ${METRIC_LABELS[key] || key} ${cell.value.toLocaleString()}`).join(' · ') || '확인값 없음'}</p>)}
            </details>)}
        </li>)}</ul></details>
        {Boolean(data.dispatches?.length) && <details><summary>예약 요청 기록</summary>{data.dispatches!.map(dispatch => <p key={dispatch.day}>{dispatch.day} · {dispatch.status === 'dispatched' ? '작업 요청 전달' : dispatch.status === 'failed' ? '작업 요청 실패' : '요청 처리 미확인'} · {time(dispatch.claimed_at)}{!data.runs.some(run => run.day === dispatch.day) ? ' · 수집 시작 기록 없음' : ''}</p>)}</details>}
        <p>같은 사람이 여러 글에 포함될 수 있어 글별 인원을 합산하지 않습니다. 예약 이동은 여행사 페이지로 나간 행동이며 구매·발권 완료가 아닙니다.</p>
    </div>;
}
export default function AdminPromotionDaily({ authKey }: { authKey: string }) {
    const [data, setData] = useState<DailyHistory | null>(null); const [error, setError] = useState(''); const [version, setVersion] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setError('');
        fetch('/api/admin/promotion-daily?days=30', { headers: { Authorization: `Bearer ${authKey}` }, cache: 'no-store', signal: controller.signal })
            .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<DailyHistory>; })
            .then(setData).catch(() => { if (!controller.signal.aborted) setError('저장 기록을 불러오지 못했습니다. 연결 설정과 실행 기록을 확인해 주세요.'); });
        return () => controller.abort();
    }, [authKey, version]);
    return <section className={styles.panel} aria-label="저장된 일별 홍보 성과"><div className={styles.heading}><h2>일별 홍보 성과</h2><button type="button" onClick={() => setVersion(value => value + 1)}>저장 기록 새로고침</button></div>
        {error && <p role="status">{error}</p>}{data ? <PromotionDailyView data={data} /> : !error && <p>저장 기록을 불러오는 중입니다.</p>}
    </section>;
}
