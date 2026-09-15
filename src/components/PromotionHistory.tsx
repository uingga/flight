'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { dayBefore, METRIC_LABELS, type DailyHistory, type Metric } from '@/lib/promotion-daily';
import styles from './PromotionHistory.module.css';

const Context = createContext<{ data: DailyHistory | null; error: boolean }>({ data: null, error: false });
export function PromotionHistoryProvider({ authKey, initialData, children }: { authKey?: string; initialData?: DailyHistory; children: ReactNode }) {
    const [data, setData] = useState<DailyHistory | null>(initialData || null);
    const [error, setError] = useState(false);
    useEffect(() => {
        if (initialData || !authKey) return;
        const controller = new AbortController();
        setData(null); setError(false);
        fetch('/api/admin/promotion-daily?days=30', { headers: { Authorization: `Bearer ${authKey}` }, cache: 'no-store', signal: controller.signal })
            .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<DailyHistory>; })
            .then(setData).catch(() => { if (!controller.signal.aborted) setError(true); });
        return () => controller.abort();
    }, [authKey, initialData]);
    return <Context.Provider value={{ data, error }}>{children}</Context.Provider>;
}

// Join only exact platform/post IDs. Snapshot run dates are not metric dates.
export function postDailyRows(data: DailyHistory, platform: string, postId: string, source: string) {
    const id = source === 'ga4' ? `${platform}:${postId}` : postId;
    const days = new Map<string, Record<string, Metric>>();
    const posts = [...data.sources.map(row => ({ source: row.source, posts: row.payload.posts })),
        ...data.latest.map(row => ({ source: row.source, posts: row.payload.posts }))]
        .filter(row => row.source === source).flatMap(row => row.posts)
        .filter(post => post.platform === platform && post.id === id);
    for (const post of posts) for (const [key, cell] of Object.entries(post.metrics)) {
        const cells = days.get(cell.day) || {};
        if (!cells[key] || cell.observedAt > cells[key].observedAt) cells[key] = cell;
        days.set(cell.day, cells);
    }
    return { days: Array.from(days.entries()).sort(([a], [b]) => b.localeCompare(a)), shared: posts.some(post => post.shared) };
}

export function PostDailyHistory({ platform, postId }: { platform: 'threads' | 'te31'; postId: string }) {
    const { data, error } = useContext(Context);
    if (!data) return <p role="status">{error ? '일별 기록을 불러오지 못했습니다. 누적 성과와는 별개입니다.' : '일별 기록을 불러오는 중입니다.'}</p>;
    return <section className={styles.panel} aria-label="이 글의 일별 변화"><h4>일별 변화</h4>
        {[platform, 'ga4'].map(source => {
            const { days, shared } = postDailyRows(data, platform, postId, source);
            const keys = source === 'ga4' ? ['users', 'detailUsers', 'bookingUsers'] : platform === 'threads' ? ['views', 'likes', 'replies'] : ['views', 'comments', 'recommendations'];
            const allKeys = Array.from(new Set(days.flatMap(([, cells]) => Object.keys(cells))));
            return <div key={source} className={styles.group}><h5>{source === 'ga4' ? '사이트 행동 · 해당 날짜의 인원' : '외부 반응 · 누적값과 전날 대비 변화'}</h5>
                {source === 'ga4' && <p>최근 30일 합계가 아닌 날짜별 잠정치입니다. 예약 이동은 구매 완료가 아닙니다.</p>}
                {shared && <p>다른 글과 같은 추적 링크를 사용합니다. 글별 인원을 합산하지 마세요.</p>}
                {!days.length ? <p>이 글에 연결된 일별 기록이 없습니다. 0으로 추정하지 않습니다.</p> : <>
                    <div className={styles.scroll}><table><thead><tr><th>기준일</th>{keys.map(key => <th key={key}>{METRIC_LABELS[key]}</th>)}</tr></thead>
                        <tbody>{days.map(([day, cells]) => <tr key={day}><th>{day}</th>{keys.map(key => {
                            const cell = cells[key];
                            const previous = days.find(([date]) => date === dayBefore(day))?.[1][key];
                            const delta = cell && previous ? cell.value - previous.value : null;
                            return <td key={key} title={cell ? `확인 시각 ${new Date(cell.observedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : '확인값 없음'}>{cell ? cell.value.toLocaleString() : '—'}{source !== 'ga4' && cell && <small>{delta === null ? '전날 비교 없음' : `(${delta > 0 ? '+' : ''}${delta.toLocaleString()})`}</small>}</td>;
                        })}</tr>)}</tbody></table></div>
                    <details><summary>전체 지표 · 확인 시각</summary>{days.map(([day, cells]) => <div key={day}><strong>{day}</strong><ul>{allKeys.filter(key => cells[key]).map(key => <li key={key}>{METRIC_LABELS[key] || key}: {cells[key].value.toLocaleString()} · 확인 {new Date(cells[key].observedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</li>)}</ul></div>)}</details>
                </>}
            </div>;
        })}
    </section>;
}

export function PromotionHistoryStatus() {
    const { data, error } = useContext(Context);
    return <details className={styles.status}><summary>일별 기록 수집 상태{error ? ' · 확인 필요' : ''}</summary>
        <p>매일 오전 9시 수집 요청 · 한국 시간. 글을 펼치면 저장된 일별 변화를 볼 수 있습니다. 누락값은 0이 아닙니다.</p>
        {error ? <p>저장 기록을 불러오지 못했습니다. 페이지를 새로고침해 다시 확인해 주세요.</p> : !data ? <p>불러오는 중입니다.</p> : <>
            {data.latest.map(({ source, payload }) => <p key={source}>{source} · {payload.outcome === 'success' ? '정상' : '확인 필요'} · 최근 시도 {new Date(payload.observedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 마지막 정상 수집 {payload.lastSuccessAt ? new Date(payload.lastSuccessAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '없음'}</p>)}
            <details><summary>최근 실행 기록 · {data.runs.length}일</summary>{data.runs.map(run => <p key={run.day}>{run.day} · {run.status === 'complete' ? '완료' : run.status === 'running' ? '진행 중' : '미완료'}</p>)}</details>
        </>}
    </details>;
}
