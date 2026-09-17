import type { FlightInterestPeriod } from '@/lib/flight-interest';
import { todayActionCount, todayFlightRows } from '@/lib/admin-today';
import styles from './AdminTodayFlights.module.css';

const agencies: Record<string,string> = {ttang:'땡처리닷컴',myrealtrip:'마이리얼트립',modetour:'모두투어',hanatour:'하나투어',ybtour:'노랑풍선',onlinetour:'온라인투어'};
export default function AdminTodayFlights({report}:{report?:FlightInterestPeriod}) {
    if (!report?.available) return <p role="status">{report?.message || '항공권별 기록을 아직 확인하지 못했습니다.'}</p>;
    const rows = todayFlightRows(report);
    return <>
        {rows.length ? <div className={styles.list}>
            <div className={styles.heading} aria-hidden="true"><span>항공권</span><span>상세 조회</span><span>예약 클릭</span></div>
            {rows.map((row,index) => <article className={styles.row} key={row.flightId}>
                <div><strong><span className={styles.rank}>{index+1}</span>{row.route?.replace(/\s*-\s*/, ' → ') || '노선 미수집'}</strong>
                    <small>{[row.recorded?.agency && (agencies[row.recorded.agency] || row.recorded.agency),row.recorded?.airline].filter(Boolean).join(' · ') || '여행사·항공사 미수집'}</small>
                    <small>{row.recorded?.departureDate || '출발일 미수집'} ~ {row.recorded?.returnDate || '귀국일 미수집'}</small>
                    {row.recorded?.minPrice != null && <small>기록 가격 {row.recorded.minPrice.toLocaleString()}원{row.recorded.maxPrice !== row.recorded.minPrice && row.recorded.maxPrice != null ? ` ~ ${row.recorded.maxPrice.toLocaleString()}원` : ''}</small>}
                </div>
                <div className={styles.metric}><span>상세 조회</span>{todayActionCount(row.detailOpens,row.detailUsers)}</div>
                <div className={styles.metric}><span>예약 클릭</span><b>{todayActionCount(row.bookingClicks,row.bookingUsers)}</b></div>
            </article>)}
        </div> : <p role="status">오늘 항공권 ID로 확인되는 상세 조회·예약 클릭 기록이 없습니다.</p>}
        {(report.unidentified.detailOpens > 0 || report.unidentified.bookingClicks > 0) && <p className={styles.note}>ID 미수집으로 순위에서 제외: 상세 {report.unidentified.detailOpens}회 · 예약 클릭 {report.unidentified.bookingClicks}회</p>}
        {report.usersMessage && <p className={styles.note}>{report.usersMessage}</p>}
        <p className={styles.note}>횟수는 반복 클릭을 포함합니다. 인원은 항공권·행동별 중복 제외이며 합산하지 않습니다. 예약 클릭은 구매 완료가 아닙니다.</p>
    </>;
}
