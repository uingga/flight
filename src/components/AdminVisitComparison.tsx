'use client';
import { useCallback, useEffect, useState } from 'react';
import { CHANNEL_LABELS, type VisitReport } from '@/lib/visit-analytics';
import styles from './AdminVisitComparison.module.css';

interface Props {
    adminKey: string;
    ga?: {users:number;sessions:number;detailUsers:number;bookingUsers:number};
}
export default function AdminVisitComparison({adminKey,ga}: Props) {
    const [open,setOpen] = useState(false);
    const [report,setReport] = useState<VisitReport | null>(null);
    const [loading,setLoading] = useState(false);
    const [revision,setRevision] = useState(0);
    const refresh = useCallback(() => setRevision(value => value + 1),[]);
    useEffect(() => {
        if (!open || !adminKey) return;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(),7000);
        let mounted = true;
        setLoading(true);
        fetch('/api/visit-stats',{headers:{Authorization:`Bearer ${adminKey}`},cache:'no-store',signal:controller.signal})
            .then(async response => {
                if (response.status === 401) throw new Error('Unauthorized');
                const value = await response.json() as VisitReport;
                if (mounted) setReport(value);
            })
            .catch(() => { if (mounted) setReport({available:false,mode:'shadow',message:'검증 통계를 불러오지 못했습니다. 기존 통계에는 영향이 없습니다.'}); })
            .finally(() => { clearTimeout(timer); if (mounted) setLoading(false); });
        return () => { mounted = false; clearTimeout(timer); controller.abort(); };
    },[open,adminKey,revision]);
    return <details className={styles.panel} onToggle={event=>setOpen(event.currentTarget.open)}>
        <summary>자체 방문 기록 검증 <span>기존 GA4 유지</span></summary>
        <div className={styles.body}>
            <p>같은 방문 기록에서 전체 방문과 경로별 방문을 계산합니다. 아직 기존 통계에 합치거나 대체하지 않습니다.</p>
            <button type="button" disabled={loading} onClick={refresh}>{loading ? '확인 중…' : '검증 통계 새로고침'}</button>
            {!report ? <p role="status">{loading ? '불러오는 중입니다.' : '검증 통계를 확인해 주세요.'}</p>
                : !report.available ? <p role="status">{report.message}</p> : <>
                    <p className={styles.status} role="status">{report.reconciled ? `합계 일치: 전체 ${report.sessions}회 = 경로 합계 ${report.sessions}회` : '합계 검증 실패 — 전환하지 마세요.'}</p>
                    <table>
                        <caption>{report.day} · 인원은 브라우저 식별자 기준</caption>
                        <thead><tr><th scope="col">항목</th><th scope="col">자체 기록</th><th scope="col">GA4</th></tr></thead>
                        <tbody>
                            <tr><th scope="row">방문 횟수</th><td>{report.sessions}회</td><td>{ga ? `${ga.sessions}회` : '—'}</td></tr>
                            <tr><th scope="row">방문 인원</th><td>{report.users}명</td><td>{ga ? `${ga.users}명` : '—'}</td></tr>
                            <tr><th scope="row">상세 열람 인원</th><td>{report.detailUsers}명</td><td>{ga ? `${ga.detailUsers}명` : '—'}</td></tr>
                            <tr><th scope="row">예약 이동 인원</th><td>{report.bookingUsers}명</td><td>{ga ? `${ga.bookingUsers}명` : '—'}</td></tr>
                        </tbody>
                    </table>
                    <table>
                        <caption>자체 기록의 전체 유입 경로</caption>
                        <thead><tr><th scope="col">경로</th><th scope="col">방문 횟수</th><th scope="col">인원</th></tr></thead>
                        <tbody>{report.channels?.map(row=><tr key={row.channel}>
                            <th scope="row">{CHANNEL_LABELS[row.channel]}</th><td>{row.sessions}회</td><td>{row.users}명</td>
                        </tr>)}</tbody>
                    </table>
                    <p>경로별 인원은 같은 브라우저가 여러 경로로 재방문하면 겹칠 수 있어 합산하지 않습니다. 상세 열람·예약 이동은 각각 발생 여부이며, 순서가 보장된 전환 퍼널은 아닙니다.</p>
                    <p>GA4와는 수집 시작일·방문 정의·처리 시점이 달라 숫자가 같을 필요는 없습니다. 운영 데이터로 여러 날 검증한 뒤 전환합니다.</p>
                    <small>조회 {report.generatedAt ? new Date(report.generatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) : '—'} · 보관 중 최초 수집 {report.firstRecordedAt ? new Date(report.firstRecordedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) : '아직 없음'}</small>
                </>}
        </div>
    </details>;
}
