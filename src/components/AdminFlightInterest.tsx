'use client';

import { useState } from 'react';
import type { FlightInterestData, InterestPeriod } from '@/lib/flight-interest';
import styles from './AdminFlightInterest.module.css';

const agencyNames: Record<string, string> = { ybtour: '노랑풍선', hanatour: '하나투어', modetour: '모두투어', onlinetour: '온라인투어', ttang: '땡처리닷컴', myrealtrip: '마이리얼트립' };

interface CityRow {
    city: string;
    details: { events: number };
    bookings: { events: number };
    searches: { events: number };
    saves: { events: number };
    shares: { events: number };
}
export default function AdminFlightInterest({ data, cities }: {
    data?: FlightInterestData;
    cities?: { basis: string; periods: Record<InterestPeriod, CityRow[]>; availablePeriods: Record<InterestPeriod, boolean> };
}) {
    const [period, setPeriod] = useState<InterestPeriod>('recent7');
    const [view, setView] = useState<'flights' | 'cities'>('flights');
    const [visibleCount, setVisibleCount] = useState(10);
    const report = data?.[period];
    const cityRows = (cities?.periods[period] || []).filter(row => [row.details, row.bookings, row.searches, row.saves, row.shares].some(action => action.events > 0))
        .slice().sort((a, b) => b.bookings.events - a.bookings.events || b.details.events - a.details.events || a.city.localeCompare(b.city));
    return <div className={styles.panel}>
        <div className={styles.toolbar}>
            <div role="group" aria-label="집계 보기">
                <button type="button" aria-pressed={view === 'flights'} onClick={() => setView('flights')}>항공권별</button>
                <button type="button" aria-pressed={view === 'cities'} onClick={() => setView('cities')}>도시별 집계</button>
            </div>
            <div role="group" aria-label="항공권 행동 집계 기간">
                {([['today', '오늘'], ['recent7', '7일'], ['current', '30일']] as const).map(([key, label]) =>
                    <button type="button" key={key} aria-pressed={period === key} onClick={() => { setPeriod(key); setVisibleCount(10); }}>{label}</button>)}
            </div>
        </div>
        <p className={styles.note}>{period === 'today' ? '오늘 현재까지 · 처리 지연이 있는 잠정 수치' : `어제까지 최근 ${period === 'recent7' ? 7 : 30}일`} · 예약 클릭순{view === 'flights' ? ' · 기본 10개' : ' 상위 30개'}</p>
        {view === 'flights' ? <>
            {!report?.available ? <p role="status">{report?.message || '항공권별 기록을 아직 조회하지 못했습니다.'}</p>
                : report.rows.length === 0 ? <p role="status">이 기간에 항공권 ID로 확인되는 상세 조회·예약 클릭 기록이 없습니다. 미수집 기록은 0회로 추정하지 않습니다.</p>
                : <div className={styles.tableWrap}><table>
                    <thead><tr><th>항공권</th><th>상세 조회</th><th>예약 클릭</th></tr></thead>
                    <tbody>{report.rows.slice(0, visibleCount).map(row => <tr key={row.flightId}>
                        <td><strong>{row.route || '노선 미수집'}</strong>
                            {row.recorded && <small>{[row.recorded.agency && (agencyNames[row.recorded.agency] || row.recorded.agency), row.recorded.airline].filter(Boolean).join(' · ')}
                                {(row.recorded.departureDate || row.recorded.returnDate) && <> · {row.recorded.departureDate || '출발일 미수집'} ~ {row.recorded.returnDate || '귀국일 미수집'}</>}
                                {row.recorded.minPrice !== null && <> · 기록 가격 {row.recorded.minPrice.toLocaleString()}{row.recorded.maxPrice !== row.recorded.minPrice && `~${row.recorded.maxPrice?.toLocaleString()}`}원</>}
                            </small>}
                            <small>항공권 ID: {row.flightId}</small></td>
                        <td>{row.detailOpens.toLocaleString()}회</td><td>{row.bookingClicks.toLocaleString()}회</td>
                    </tr>)}</tbody>
                </table></div>}
            {report?.available && report.rows.length > 0 && <div className={styles.more}>
                <span>{Math.min(visibleCount, report.rows.length)} / {report.rows.length.toLocaleString()}개 항공권</span>
                {report.rows.length > visibleCount && <button type="button" onClick={() => setVisibleCount(count => count + 10)}>10개 더 보기</button>}
            </div>}
            {report?.available && (report.unidentified.detailOpens > 0 || report.unidentified.bookingClicks > 0) && <p className={styles.note}>
                항공권 ID 미수집으로 순위에서 제외: 상세 조회 {report.unidentified.detailOpens.toLocaleString()}회 · 예약 클릭 {report.unidentified.bookingClicks.toLocaleString()}회
            </p>}
            <p className={styles.note}>기록된 항공권 ID별 횟수입니다. 같은 사람의 반복 클릭도 포함하며, 화면 노출은 집계하지 않습니다. 예약 클릭은 여행사로 이동한 횟수로 구매 완료를 뜻하지 않습니다.</p>
            <p className={styles.note}>수집·측정기준 등록 이후 확인되는 기록만 표시합니다. 과거 일정·가격을 현재 항공권 정보로 채우거나, 다른 ID의 항공권 기록을 추정해 합치지 않습니다.</p>
        </> : <>
            {!cities?.availablePeriods[period] ? <p role="status">도시별 전체 집계를 확인하지 못했습니다. 조회 실패·제한된 기록을 0회로 표시하지 않습니다.</p> : cityRows.length === 0 ? <p role="status">이 기간에 확인되는 도시별 행동 기록이 없습니다.</p>
                : <div className={styles.tableWrap}><table>
                    <thead><tr><th>도시</th><th>상세 조회</th><th>예약 클릭</th><th>직접 검색</th><th>저장</th><th>공유</th></tr></thead>
                    <tbody>{cityRows.slice(0, 30).map(row => <tr key={row.city}><td>{row.city}</td><td>{row.details.events.toLocaleString()}회</td><td>{row.bookings.events.toLocaleString()}회</td><td>{row.searches.events.toLocaleString()}회</td><td>{row.saves.events.toLocaleString()}회</td><td>{row.shares.events.toLocaleString()}회</td></tr>)}</tbody>
                </table></div>}
            <p className={styles.note}>도시별 이벤트의 별도 집계입니다. 화면 노출·현재 항공권 수는 관심 지표에 포함하지 않습니다. 항공권 ID 미수집 기록도 도시가 기록됐다면 포함될 수 있어 항공권별 합계와 다를 수 있습니다.{cities?.basis === 'route_fallback' && ' 도시 측정기준 대신 기록된 노선의 도착 도시를 기준으로 합산했습니다.'}</p>
        </>}
    </div>;
}
