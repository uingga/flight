'use client';
import type { AcquisitionData } from '@/lib/acquisition';
import styles from './AdminAcquisition.module.css';
const users = (n: number | null) => n === null ? '인원 미확인' : `${n.toLocaleString()}명`;
export default function AdminAcquisition({data}: {data?: AcquisitionData}) {
    if (!data?.available) return <p className={styles.note} role="status">{data?.message || '유입 기록을 불러오지 못했습니다.'}</p>;
    if (!data.groups.length) return <p className={styles.note} role="status">이 기간에 확인되는 유입 기록이 없습니다.</p>;
    return <div className={styles.panel}>
        <ul className={styles.groups}>{data.groups.map(group=><li key={group.label}>
            <div className={styles.heading}><strong>{group.label}</strong><span><b>{group.sessions.toLocaleString()}회</b><small>{users(group.users)}</small></span></div>
            <ul className={styles.sources}>{group.sources.map(source=><li key={source.source}>
                <span>{source.label}{source.source !== source.label && <small>{source.source}</small>}</span>
                <span>{source.sessions.toLocaleString()}회<small>{users(source.users)}</small></span>
            </li>)}</ul>
        </li>)}</ul>
        <p className={styles.note}>횟수는 방문(세션), 인원은 GA4 활성 사용자 기준입니다. 같은 사람이 여러 출처로 방문할 수 있어 하위 인원수를 더한 값과 유형 전체 인원은 다를 수 있습니다. 인원 미확인은 추정하지 않습니다.</p>
        <p className={styles.note}>‘유형 미분류’는 출처는 있지만 유형이 불분명한 방문, ‘출처 확인 불가’는 출처 정보가 없는 방문입니다.</p>
    </div>;
}
