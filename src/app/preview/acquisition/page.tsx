import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { flightOrderStorageMode } from '@/lib/server/flight-order-store';
import AdminAcquisition from '@/components/AdminAcquisition';
import type { AcquisitionData } from '@/lib/acquisition';
export const dynamic = 'force-dynamic';
export const metadata = { title: '유입 유형과 출처 미리보기', robots: {index:false,follow:false} };
export default function Preview({searchParams}:{searchParams:{state?:string}}) {
    if (!['localhost','127.0.0.1'].includes(headers().get('host')?.split(':')[0] || '') || process.env.VERCEL || flightOrderStorageMode()!=='preview' || !process.env.ADMIN_KEY) notFound();
    const data:AcquisitionData={available:true,groups:[
        {label:'커뮤니티',sessions:8,users:6,sources:[{source:'te31',label:'TE31',sessions:8,users:6}]},
        {label:'검색',sessions:5,users:3,sources:[{source:'m.search.naver.com',label:'네이버 검색',sessions:4,users:3},{source:'google',label:'구글',sessions:1,users:1}]},
        {label:'사용자 공유',sessions:2,users:2,sources:[{source:'user_share',label:'항공권 공유 링크',sessions:2,users:2}]},
        {label:'기타 외부 링크',sessions:1,users:1,sources:[{source:'m.keep.naver.com',label:'네이버 Keep',sessions:1,users:1}]},
        {label:'유형 미분류',sessions:1,users:null,sources:[{source:'unknown-source.example',label:'unknown-source.example',sessions:1,users:null}]},
        {label:'출처 확인 불가',sessions:1,users:1,sources:[{source:'(not set)',label:'출처 정보 없음',sessions:1,users:1}]},
    ]};
    if(searchParams.state==='empty') data.groups=[];
    if(searchParams.state==='unavailable') { data.available=false;data.groups=[]; }
    return <main style={{maxWidth:650,margin:'0 auto',padding:16}}><p>설명용 예시 수치 · 운영 통계가 아닙니다</p><section style={{background:'#fff',border:'1px solid #edf0f3',borderRadius:16,overflow:'hidden'}}><h1 style={{fontSize:20,padding:'0 20px'}}>유입 유형과 출처</h1><AdminAcquisition data={data}/></section></main>;
}
