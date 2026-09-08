import AdminAcquisition from './AdminAcquisitionSources';
import type { AcquisitionData } from '@/lib/acquisition';
import styles from './AdminTrafficOverview.module.css';
export default function AdminTrafficOverview({data,routes}:{data?:AcquisitionData;routes?:Array<{label:string;count:number}>|null}) {
 return <div className={styles.grid}>
  <article className={styles.card}><header><h3>어디서 왔나</h3><span>방문순</span></header><AdminAcquisition data={data}/></article>
  <article className={styles.card}><header><h3>예약 이동이 많은 노선</h3><span>상위 5개</span></header>{routes?.length ? <table className={styles.routes}><thead><tr><th>노선</th><th>예약 이동</th></tr></thead><tbody>{routes.slice(0,5).map(row=><tr key={row.label}><td>{row.label.replace('-', ' → ')}</td><td>{row.count.toLocaleString()}회</td></tr>)}</tbody></table> : <p className={styles.note}>확인되는 예약 이동 기록이 없습니다.</p>}<p className={styles.note}>반복 클릭을 포함한 예약 페이지 이동 횟수입니다.</p></article>
 </div>;
}
