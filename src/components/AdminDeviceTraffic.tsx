'use client';
import { useState } from 'react';
import { DEVICE_PERIODS, type DevicePeriod, type DeviceTrafficData } from '@/lib/device-traffic';
import styles from './AdminDeviceTraffic.module.css';
const labels = {today:'오늘',recent7:'7일',recent30:'30일'};
const color = (device:string) => (({mobile:'#ff385c',desktop:'#5266c9',tablet:'#2a947c'} as Record<string,string>)[device] || '#788698');
const percent = (value:number) => value > 0 && value < 0.1 ? '0.1% 미만' : value.toLocaleString('ko-KR',{maximumFractionDigits:1}) + '%';
export default function AdminDeviceTraffic({data}:{data?:DeviceTrafficData}) {
    const [period,setPeriod] = useState<DevicePeriod>('recent30');
    const report = data?.[period];
    return <article className={styles.card} aria-label="접속 기기">
        <div className={styles.heading}><h3>접속 기기</h3><div className={styles.periods} role="group" aria-label="기기 통계 기간">{DEVICE_PERIODS.map(key=><button key={key} type="button" aria-pressed={period===key} onClick={()=>setPeriod(key)}>{labels[key]}</button>)}</div></div>
        <p className={styles.caption}>{period==='today'?'오늘 · 집계 중': '어제까지 최근 ' + labels[period]} · 방문 횟수 기준</p>
        {!report?.available ? <p className={styles.note} role="status">기기별 접속 통계를 불러오지 못했습니다.</p> : !report.sessions ? <p className={styles.note} role="status">이 기간에 집계된 방문이 없습니다.</p> : <>
            <div className={styles.bar} aria-hidden="true">{report.rows.filter(row=>row.sessions>0).map(row=><span key={row.device} style={{width:row.percent+'%',background:color(row.device)}} />)}</div>
            <table className={styles.table}><thead><tr><th scope="col">기기</th><th scope="col">비율</th><th scope="col">방문</th><th scope="col">인원</th></tr></thead><tbody>{report.rows.map(row=><tr key={row.device}><th scope="row"><i aria-hidden="true" style={{background:color(row.device)}}/>{row.label}</th><td>{percent(row.percent)}</td><td>{row.sessions.toLocaleString()}회</td><td>{row.users.toLocaleString()}명</td></tr>)}</tbody></table>
            <details className={styles.help}><summary>집계 기준</summary><p>인원은 GA4 전체 사용자 수입니다. 같은 사람이 여러 기기를 쓸 수 있어 기기별 인원은 합산하지 않습니다. 비율에는 기기 미확인 방문도 포함하며, 반올림으로 합계가 100%와 조금 다를 수 있습니다.</p></details>
        </>}
    </article>;
}
