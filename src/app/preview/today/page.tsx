import AdminTodayHourly from '@/components/AdminTodayHourly';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { flightOrderStorageMode } from '@/lib/server/flight-order-store';
import AdminTodayMetrics from '@/components/AdminTodayMetrics';
import AdminTodayFlights from '@/components/AdminTodayFlights';
import AdminAcquisition from '@/components/AdminAcquisition';
import type { FlightInterestPeriod } from '@/lib/flight-interest';
import styles from '@/app/admin/admin.module.css';
export const dynamic='force-dynamic';
export const metadata={title:'오늘 어드민 미리보기',robots:{index:false,follow:false}};
export default function Preview({searchParams}:{searchParams:{state?:string}}) {
 if(!['localhost','127.0.0.1'].includes(headers().get('host')?.split(':')[0]||'')||process.env.VERCEL||flightOrderStorageMode()!=='preview'||!process.env.ADMIN_KEY) notFound();
 const unavailable=searchParams.state==='unavailable';
 const report:FlightInterestPeriod={available:!unavailable,message:'항공권별 보고서를 불러오지 못했습니다.',unidentified:{detailOpens:0,bookingClicks:0},rows:searchParams.state==='empty'?[]:['부산-오사카','인천-마쓰야마','청주-다낭','부산-타이중','인천-후쿠오카'].map((route,i)=>({flightId:`example-${i}`,route,detailOpens:30-i*4,bookingClicks:10-i*2,detailUsers:8-i,bookingUsers:i===1?null:5-i,recorded:{agency:'modetour',departureDate:'2026-10-10',returnDate:'2026-10-13',airline:'제주항공',minPrice:199000+i*10000,maxPrice:199000+i*10000}}))};
 return <main className={styles.container} style={{gridTemplateColumns:"minmax(0,1120px)"}}>
 <header className={styles.header}><h1>오늘</h1><p>화면 검토용 예시 데이터입니다. 운영 수치가 아닙니다.</p><nav><a href="/preview/today">예시</a> · <a href="?state=empty">기록 없음</a> · <a href="?state=unavailable">조회 실패</a></nav></header>
 <section style={{gridColumn:"1 / -1"}} className={styles.section}><h2>오늘 처리할 일</h2><div className={styles.actionGrid}><div className={styles.actionCardWarn}><span>항공권 수집</span><strong>1곳 확인 필요</strong><small>모두투어 · 마지막 정상 갱신 9월 16일 14:23</small><small>운영 탭에서 수집 상태와 기록 확인</small></div></div></section>
 <section style={{gridColumn:"1 / -1"}} className={styles.section}><div className={styles.sectionHeading}><div><h2>오늘 핵심 지표</h2><p>행동별 사람 수입니다. 실제 구매 완료나 순서가 확인된 전환 흐름은 아닙니다.</p></div></div>{unavailable?<p>방문 통계를 불러오지 못했습니다.</p>:<AdminTodayMetrics data={{visitors:32,detailOpenUsers:18,bookingClickUsers:8,detailOpenRate:56.3,bookingClickRate:25}} sessions={40}/>}<p className={styles.todayMeta}>GA4 · 예시 · 오늘 수치는 잠정치이며 실시간 통계가 아닙니다.</p><p className={styles.todayMeta}>처음 온 사람 24명 · 다시 온 사람 10명 · 전체 방문자와 단순 합산하지 않습니다.</p></section>
 <section style={{gridColumn:"1 / -1"}} className={styles.section}><div className={styles.sectionHeading}><div><h2>오늘 반응이 좋은 항공권</h2><p>예약 클릭순 상위 5개 · 상세 조회·예약 클릭의 횟수와 인원</p></div></div><AdminTodayFlights report={report}/></section>
 <section style={{gridColumn:"1 / -1"}} className={styles.section}><h2>오늘의 TIKIT DROP</h2><p>부산 → 오사카 · 199,000원 · 예시</p><p>상세 조회 30회 · 8명 / 예약 클릭 10회 · 5명</p><small>이 표의 오늘 전체 행동입니다. TIKIT DROP 영역에서 누른 반응만을 뜻하지 않습니다.</small></section>
 <div className={styles.todayLowerGrid} style={{gridColumn:"1 / -1"}}><section className={styles.section}><h2>오늘 유입 경로</h2><AdminAcquisition data={unavailable?undefined:{available:true,groups:[{label:'검색',sessions:25,users:21,sources:[{source:'naver',label:'네이버 검색',sessions:25,users:21}]},{label:'SNS',sessions:15,users:11,sources:[{source:'threads',label:'Threads',sessions:15,users:11}]}]}}/></section><section className={`${styles.section} ${styles.todayHourlyCompact}`}><h2>오늘 시간대별 접속</h2>{unavailable?<p>시간대별 기록을 확인하지 못했습니다.</p>:<AdminTodayHourly data={{timeZone:"Asia/Seoul",timeZoneSource:"property",bucketHours:1,recent7:[],current:[],today:Array.from({length:24},(_,i)=>({startHour:i,endHour:i+1,sessions:i>17?0:i%5}))}}/>}</section></div>
 <section style={{gridColumn:"1 / -1"}} className={styles.section}><h2>가입·저장·알림</h2><div className={styles.todaySecondaryGrid}>{[['가입한 사람','2명'],['저장한 사람','3명'],['알림을 적용한 사람','1명']].map(([label,value])=><article key={label}><span>{label}</span><strong>{unavailable?'—':value}</strong></article>)}</div></section>
 </main>;
}
