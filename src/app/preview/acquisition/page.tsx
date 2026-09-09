import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { flightOrderStorageMode } from '@/lib/server/flight-order-store';
import AdminTrafficOverview from '@/components/AdminTrafficOverview';
import styles from '@/app/admin/admin.module.css';
import { parseDeviceTraffic, unavailableDevices, type DeviceTrafficData } from '@/lib/device-traffic';
import type { AcquisitionData } from '@/lib/acquisition';
export const dynamic = 'force-dynamic';
export const metadata = { title: '유입 유형과 출처 미리보기', robots: {index:false,follow:false} };
export default function Preview({searchParams}:{searchParams:{state?:string}}) {
    if (!['localhost','127.0.0.1'].includes(headers().get('host')?.split(':')[0] || '') || process.env.VERCEL || flightOrderStorageMode()!=='preview' || !process.env.ADMIN_KEY) notFound();
    const data:AcquisitionData={available:true,groups:[
        {label:'커뮤니티',sessions:8,users:6,sources:[{source:'te31',label:'TE31',sessions:8,users:6}]},
        {label:'검색',sessions:5,users:3,sources:[{source:'naver',label:'네이버 검색',sessions:4,users:3,rawSources:['naver','m.search.naver.com']},{source:'google',label:'구글 검색',sessions:1,users:1}]},
        {label:'사용자 공유',sessions:2,users:2,sources:[{source:'user_share',label:'항공권 공유 링크',sessions:2,users:2}]},
        {label:'기타 외부 링크',sessions:1,users:1,sources:[{source:'m.keep.naver.com',label:'네이버 Keep',sessions:1,users:1}]},
        {label:'블로그',sessions:1,users:1,sources:[{source:'naver_blog',label:'네이버 블로그',sessions:1,users:1,rawSources:['naver_blog','blog.naver.com']}]},
        {label:'AI 서비스',sessions:2,users:2,sources:[{source:'chatgpt.com',label:'ChatGPT',sessions:1,users:1},{source:'gemini.google.com',label:'Gemini',sessions:1,users:1}]},
        {label:'유형 미분류',sessions:2,users:null,sources:[{source:'hanatour',label:'hanatour (출처 확인 필요)',sessions:1,users:1},{source:'unknown-source.example',label:'unknown-source.example',sessions:1,users:null}]},
        {label:'출처 확인 불가',sessions:1,users:1,sources:[{source:'(not set)',label:'출처 정보 없음',sessions:1,users:1}]},
    ]};
    if(searchParams.state==='empty') data.groups=[];
    if(searchParams.state==='unavailable') { data.available=false;data.groups=[]; }
    const deviceSample = (values:Array<[string,number,number]>) => parseDeviceTraffic({rows:values.map(([device,sessions,users])=>({dimensionValues:[{value:device}],metricValues:[sessions,users].map(value=>({value:String(value)}))}))});
    const devices:DeviceTrafficData = {
        today:deviceSample([['mobile',8,6],['desktop',2,2]]),
        recent7:deviceSample([['mobile',60,42],['desktop',30,20],['tablet',5,4],['(not set)',5,3]]),
        recent30:deviceSample([['mobile',156,100],['desktop',36,28],['tablet',8,6]]),
    };
    for(const key of ['today','recent7','recent30'] as const) {
        if(searchParams.state==='empty') devices[key]=deviceSample([]);
        if(searchParams.state==='unavailable') devices[key]=unavailableDevices();
    }
    return <main className={styles.container}>
        <header className={styles.header}><h1>티키티킷 운영실</h1><p>방문·예약 상단 배치 미리보기 · 모든 수치는 예시입니다</p></header>
        <nav className={styles.tabNav} aria-label="미리보기 메뉴">{['오늘','노출 순서','홍보 성과','방문·예약','항공권·수집','고객·알림'].map((label,i)=><button type="button" key={label} className={i===3?styles.tabBtnActive:styles.tabBtn} disabled={i!==3}><span className={styles.tabLabel}>{label}</span></button>)}</nav>
        <section className={styles.section} id="visitor-flow"><div className={styles.sectionHeading}><div><h2>방문 흐름 요약</h2><p>방문 → 상세 열람 → 예약 페이지 이동을 사람 수로 비교합니다.</p></div></div><div className={styles.signalGridFour}>{[['방문한 사람','12명'],['상세를 연 사람','6명'],['예약 페이지로 이동한 사람','2명']].map(([label,n])=><article className={styles.signalCard} key={label}><span>{label}</span><strong>{n}</strong><small>최근 30일 · 예시</small></article>)}</div></section>
        <section className={styles.section} id="visitor-acquisition"><div className={styles.sectionHeading}><div><h2>어디서 와서 무엇을 눌렀나</h2><p>최근 30일 유입처와 예약 이동 상위 노선을 비교합니다. 출처별 예약 전환을 뜻하지는 않습니다.</p></div></div><AdminTrafficOverview data={data} devices={devices} routes={[{label:'부산-시즈오카',count:5},{label:'부산-타이중',count:4},{label:'인천-고베',count:3},{label:'청주-이바라키',count:2},{label:'부산-오사카',count:1}]}/><details className={styles.openDisclosure} id="visitor-secondary"><summary>여행사별 예약 이동 · 알림 등록 위치</summary><div className={styles.analysisGrid}><div className={styles.analysisPanel}><h3>예약 이동이 많은 여행사</h3><p>모두투어 8회 · 땡처리닷컴 4회</p></div><div className={styles.analysisPanel}><h3>알림 등록을 시작한 위치</h3><p>검색 결과 2회</p></div></div></details></section>
        <section className={styles.section} id="visitor-promotion"><div className={styles.sectionHeading}><div><h2>홍보 채널별 글 성과</h2><p>이 아래에 기존 홍보 글 성과 표가 이어집니다.</p></div></div></section>
        <section className={styles.section} id="visitor-cities"><div className={styles.sectionHeading}><div><h2>어떤 항공권을 눌렀나</h2><p>기존 항공권별 상세·예약·공유 분석이 이어집니다.</p></div></div><p>이후 탐색 깊이 → 방문자 추이 → 접속 시간 → 신규·재방문 → 검색 조건 순서로 유지합니다.</p></section>
    </main>;
}
