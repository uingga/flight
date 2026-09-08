'use client';

import { useState } from 'react';
import { emptyDemandGroup, type DemandGroup, type FilterDemandData } from '@/lib/filter-demand';
import styles from './AdminFilterDemand.module.css';

interface DateDemand { leadTime: Array<{ label: string; count: number }> | null; range: Array<{ label: string; count: number }> | null; method: Array<{ label: string; count: number }> | null; presets: Array<{ label: string; count: number }> | null }
const toGroup = (items: DateDemand['range']): DemandGroup => ({ available: items !== null, cleared: 0, missing: 0, items: (items || []).map(item => ({ ...item, key: item.label, users: null })) });
function Ranking({ title, description, group, date = false }: { title: string; description: string; group: DemandGroup; date?: boolean }) {
    const [expanded, setExpanded] = useState(false);
    const total = group.items.reduce((sum, item) => sum + item.count, 0);
    return <article className={styles.card}>
        <header><h3>{title}</h3>{group.available && total > 0 && <span>{total.toLocaleString()}회</span>}</header>
        <p className={styles.description}>{description}</p>
        {!group.available ? <p className={styles.empty} role="status">아직 조회할 수 없습니다. 측정기준 등록·조회 상태를 확인해야 합니다.</p>
            : total === 0 ? <p className={styles.empty} role="status">확인되는 선택 기록이 없습니다. 미수집 기록을 0회로 추정하지 않습니다.</p>
                : <ol className={styles.ranking}>{group.items.slice(0, expanded ? undefined : 6).map(item => <li key={item.key}>
                    <div className={styles.row}><span>{item.label}</span><span className={styles.count}><b>{item.count.toLocaleString()}회</b>{!date && <small> · {item.users === null ? '인원 미확인' : `${item.users.toLocaleString()}명`}</small>}<em>{Math.round(item.count / total * 100)}%</em></span></div>
                    <div className={styles.track} aria-hidden="true"><span style={{ width: `${item.count / total * 100}%` }} /></div>
                </li>)}</ol>}
        {group.available && group.items.length > 6 && <button className={styles.more} type="button" onClick={() => setExpanded(value => !value)}>{expanded ? '접기' : `${group.items.length - 6}개 더 보기`}</button>}
        {group.available && (group.cleared > 0 || group.missing > 0) && <p className={styles.footnote}>순위·비중에서 제외: 전체로 해제 {group.cleared.toLocaleString()}회 · 값 미수집 {group.missing.toLocaleString()}회</p>}
    </article>;
}
export default function AdminFilterDemand({ data, dates, days = 30 }: { data?: FilterDemandData; dates: DateDemand; days?: number }) {
    const [view, setView] = useState<'route' | 'conditions' | 'dates'>('route');
    const group = (key: keyof FilterDemandData['groups']) => data?.groups[key] || emptyDemandGroup();
    return <div className={styles.panel}>
        <div className={styles.toolbar}><div role="group" aria-label="검색 조건 보기">
            {([['route', '출발·도착'], ['conditions', '가격·항공사·여행사'], ['dates', '출발 날짜']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
        </div><span>어제까지 최근 {days}일</span></div>
        <div className={styles.grid} key={view}>
            {view === 'route' && <>
                <Ranking title="출발지" description="어느 공항에서 출발하려고 했나" group={group('departure')} />
                <Ranking title="도착 권역" description="동남아·일본 등 선택한 여행 권역" group={group('region')} />
                <Ranking title="검색한 도착 도시" description="현재 표가 있는 도시명과 일치한 검색만 기록합니다. 결과 없는 검색은 포함되지 않습니다." group={data?.cities || emptyDemandGroup()} />
            </>}
            {view === 'conditions' && <>
                <Ranking title="가격 상한" description="사용자가 정한 항공권 예산의 상한" group={group('max_price')} />
                <Ranking title="항공사" description="골라서 보고 싶었던 항공사" group={group('airline')} />
                <Ranking title="여행사" description="판매처 필터에서 직접 고른 여행사" group={group('source')} />
            </>}
            {view === 'dates' && <>
                <Ranking title="출발까지 남은 기간" description="선택 당시 출발일까지 얼마나 남았나" group={toGroup(dates.leadTime)} date />
                <Ranking title="출발일 선택 폭" description="출발일을 찾은 날짜 범위입니다. 여행 체류 일수가 아닙니다." group={toGroup(dates.range)} date />
                <Ranking title="날짜를 고른 방식" description="달력에서 직접 골랐는지, 빠른 선택을 썼는지" group={toGroup(dates.method)} date />
                <Ranking title="누른 빠른 선택" description="이번 주·다음 달 등 출발 날짜 단축 선택" group={toGroup(dates.presets)} date />
            </>}
        </div>
        <p className={styles.footnote}>횟수는 반복 선택을 포함합니다. 인원은 각 조건 값별 GA4 사용자 수이며 서로 겹칠 수 있어 더하지 않습니다. 기기·브라우저가 다르면 같은 사람도 따로 잡힐 수 있습니다. 비중은 해당 항목의 확인된 선택 횟수 기준입니다.</p>
        <p className={styles.footnote}>{view === 'dates' ? '날짜 세부 기록은 2026년 8월 19일 측정기준 등록 이후 확인되는 횟수만 표시합니다. 날짜 구간별 인원수는 추정하지 않습니다.' : '화면 노출·기본값·전체로 해제한 선택은 선호 순위에 넣지 않습니다. 과거 미수집 기록은 채우지 않습니다.'} 선택된 조건들의 동시 조합이나 예약 완료를 나타내는 통계는 아닙니다.</p>
    </div>;
}
