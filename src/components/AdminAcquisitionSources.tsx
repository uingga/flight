'use client';
import {useState} from 'react';
import type {AcquisitionData} from '@/lib/acquisition';
import styles from './AdminAcquisitionSources.module.css';
const people=(n:number|null)=>n===null?'미확인':`${n.toLocaleString()}명`;
export default function AdminAcquisitionSources({data}:{data?:AcquisitionData}) {
 const [all,setAll]=useState(false);
 if(!data?.available)return <p className={styles.note} role="status">{data?.message||'유입 기록을 불러오지 못했습니다.'}</p>;
 const rows=data.sourceRows || data.groups.flatMap(group=>group.sources.map(source=>({...source,categories:[group.label]}))).sort((a,b)=>b.sessions-a.sessions||a.source.localeCompare(b.source));
 const known=rows.filter(row=>!row.categories.includes('출처 확인 불가'));
 const unknown=data.groups.find(group=>group.label==='출처 확인 불가');
 return <div className={styles.panel}>
 {known.length ? <table className={styles.table}><thead><tr><th>유입처</th><th>방문</th><th>인원</th></tr></thead><tbody>{(all?known:known.slice(0,5)).map(row=><tr key={row.source}><td><strong title={row.source}>{row.label}</strong><small>{row.categories.join(' · ')}</small></td><td>{row.sessions.toLocaleString()}회</td><td>{people(row.users)}</td></tr>)}</tbody></table> : <p className={styles.note} role="status">확인되는 유입처가 없습니다.</p>}
 {unknown && <div className={styles.unknown}><span>출처 확인 불가</span><span>{unknown.sessions.toLocaleString()}회 · {people(unknown.users)}</span></div>}
 <div className={styles.footer}>{known.length>5 && <button type="button" aria-expanded={all} onClick={()=>setAll(!all)}>{all?'접기':`유입처 ${known.length-5}개 더 보기`}</button>}<details><summary>집계 기준</summary><p>방문은 세션, 인원은 GA4 전체 사용자 기준입니다. 동일 출처의 인원은 중복을 제외하며, 출처별 인원은 서로 겹칠 수 있습니다. 미확인 인원은 추정하지 않습니다.</p></details></div>
 </div>;
}
