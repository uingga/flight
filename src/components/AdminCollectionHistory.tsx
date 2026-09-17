'use client';

import { useState } from 'react';
import { buildCollectionHistory, collectionChange, collectionStatus, COLLECTION_SOURCES, type CrawlHistoryEntry, type ActiveCollectionRun, type NaverCollectionEntry, type CollectionStat } from '@/lib/admin-collection-history';
import styles from './AdminCollectionHistory.module.css';

const number = (value?: number | null) => value == null ? '—' : value.toLocaleString();
const signed = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString()}`;
const time = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));

function FlightChanges({ stat }: { stat: CollectionStat }) {
    if (stat.preserved || stat.skipped || (!stat.added && !stat.removed)) return null;
    return <details className={styles.changes}><summary>신규·제외 항공권 목록</summary><div className={styles.flightLists}>
        {(['added', 'removed'] as const).map(kind => {
            const flights = stat[kind === 'added' ? 'addedFlights' : 'removedFlights'] || [];
            const count = stat[kind];
            return <section key={kind}><h4>{kind === 'added' ? '신규' : '제외'} {number(count)}개</h4>
                {flights.map((flight, index) => <div key={`${flight.id}-${index}`}><strong>{flight.route} · {number(flight.price)}원</strong><span>{flight.airline} · {flight.departureDate} ~ {flight.returnDate}</span></div>)}
                {!flights.length && <p>{count === 0 ? '해당 항공권 없음' : '이 회차에는 상세 목록이 기록되지 않았습니다.'}</p>}
                {flights.length > 0 && count != null && count > flights.length && <p>외 {number(count - flights.length)}개 · 상세 미기록</p>}
            </section>;
        })}
    </div></details>;
}

export default function AdminCollectionHistory({ history, naver, active }: {
    history: CrawlHistoryEntry[]; naver: NaverCollectionEntry[]; active?: ActiveCollectionRun | null;
}) {
    const [limit, setLimit] = useState(12);
    const runs = buildCollectionHistory(history, naver, active);
    return <div className={styles.root}>
        <p className={styles.note}>한국시간 기준 · 원본은 필터 전 수집량, 노출은 해당 회차 저장 결과입니다. 변화량은 신규−제외이며 미수집 수치는 —로 표시합니다.</p>
        {!runs.length && <p className={styles.empty}>아직 수집 실행 기록이 없습니다.</p>}
        {runs.slice(0, limit).map(run => {
            const n = run.naver;
            const sources = Array.from(new Set([...Object.keys(run.sites), ...(run.active?.plannedSources || [])]));
            const status = run.active ? (run.active.stage === 'publishing' ? '결과 반영 중' : run.active.stage === 'crawling' ? '진행 중' : '시작 대기')
                : n ? (n.abortedEarly ? '중단' : n.misses > 0 ? '일부 실패' : '완료')
                    : Object.values(run.sites).some(s => s.preserved || s.partial || (s.skipped && s.skipReason === 'circuit')) ? '확인 필요' : '완료';
            return <article className={styles.run} key={run.id}>
                <header><div><h3>{run.title}</h3><time dateTime={run.timestamp}>{time(run.timestamp)} {run.active ? '시작' : '기록'}{run.slotAt ? ` · ${time(run.slotAt)} 회차` : ''}</time></div><span className={status === '완료' ? styles.ok : styles.warn}>{status}</span></header>
                {n ? <><div className={styles.naverMetrics}>
                    <div><span>확인 대상</span><strong>{number(n.needed)}</strong></div><div><span>실제 조회</span><strong>{number(n.attempted)}</strong></div>
                    <div><span>가격 확인 성공</span><strong>{number(n.success)}</strong></div><div><span>다음 회차 이월</span><strong>{number(n.deferred)}</strong></div>
                </div><p className={styles.note}>{n.sourceFilter === 'all' ? '전체 여행사' : n.sourceFilter.split(',').map(s => COLLECTION_SOURCES[s.trim()] || s).join(' · ')} · 페이지 이동 {number(n.navigations ?? n.attempted)}회{n.durationSeconds != null ? ` · ${Math.round(n.durationSeconds / 60)}분 소요` : ''}</p>
                    <details className={styles.changes}><summary>확인 세부 내역</summary><p>처음 확인 {number(n.newRoutesAttempted)} / {number(n.newRoutes)} · 결과 없음 {number(n.noResult)} · 노선 오류 {number(n.routeErrors)} · 일시 오류 {number(n.transientErrors)} · 접근 제한 {number(n.blocked)}</p><p>처음 미확인 이월 {number(n.deferredNeverChecked)} · 가장 오래된 이월 {n.oldestDeferredHours == null ? '—' : `${Math.round(n.oldestDeferredHours)}시간`}</p>{n.abortReason && <p>{n.abortReason}</p>}</details>
                </> : <><div className={styles.tableWrap}><table><thead><tr><th>여행사 / 결과</th><th>원본</th><th>노출</th><th>변화량</th><th>신규</th><th>제외</th></tr></thead><tbody>
                    {sources.map(source => {
                        const stat = run.sites[source];
                        const change = stat ? collectionChange(stat) : null;
                        const valid = stat && !stat.preserved && !stat.skipped;
                        return <tr key={source}><th scope="row">{COLLECTION_SOURCES[source] || source}<small>{stat ? collectionStatus(stat) : run.active?.skippedSources.includes(source) ? '일정상 휴식' : status}</small>{stat?.detail && <small>{stat.detail}</small>}</th><td>{number(stat?.scraped)}</td><td>{number(stat?.total)}</td><td>{signed(change)}</td><td>{valid ? number(stat.added) : '—'}</td><td>{valid ? number(stat.removed) : '—'}</td></tr>;
                    })}
                </tbody></table></div>
                    {sources.map(source => { const stat = run.sites[source]; return stat && !stat.preserved && !stat.skipped && (stat.added || stat.removed) ? <div className={styles.sourceChanges} key={source}><strong>{COLLECTION_SOURCES[source] || source}</strong><FlightChanges stat={stat} /></div> : null; })}
                </>}
                {run.active && <p className={styles.note}>진행 중인 작업의 결과는 완료 후 반영됩니다. <a href={run.active.url} target="_blank" rel="noreferrer">실행 보기</a></p>}
                {run.alerts.length > 0 && <details className={styles.changes}><summary>수집 중 안내 {run.alerts.length}건</summary>{run.alerts.map((alert, i) => <p key={i}>{alert.replace(/^🚨\s*/, '')}</p>)}</details>}
            </article>;
        })}
        {limit < runs.length && <button type="button" className={styles.more} onClick={() => setLimit(value => value + 12)}>이전 기록 더 보기 ({runs.length - limit})</button>}
    </div>;
}
