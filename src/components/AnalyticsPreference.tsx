'use client';
import { useEffect, useState } from 'react';
import { isAnalyticsExcluded, setAnalyticsExcluded } from '@/lib/analytics';

export default function AnalyticsPreference() {
    const [excluded,setExcluded] = useState<boolean | null>(null);
    useEffect(()=>setExcluded(isAnalyticsExcluded()),[]);
    return <div>
        <p>이 브라우저의 선택적 방문 통계 수집: {excluded === null ? '확인 중' : excluded ? '사용 안 함' : '사용'}</p>
        <button type="button" disabled={excluded === null} onClick={()=>{
            const next = !excluded;
            setAnalyticsExcluded(next);
            setExcluded(next);
        }} style={{padding:'8px 12px',border:'1px solid #ddd',borderRadius:10,background:'#fff',color:'#222',fontWeight:600,cursor:'pointer'}}>
            {excluded ? '방문 통계 수집 허용' : '방문 통계 수집 중지'}
        </button>
        <p>GA4와 자체 방문 기록에 함께 적용됩니다. 수집 중지는 이미 저장된 기록의 삭제를 의미하지 않습니다. 브라우저 저장소를 차단하거나 삭제하면 이 설정이 유지되지 않을 수 있습니다. 허용 후에는 새로고침해 주세요.</p>
    </div>;
}
