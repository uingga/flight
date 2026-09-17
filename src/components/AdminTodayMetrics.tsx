import styles from '@/app/admin/admin.module.css';

export default function TodayBehaviorSummary({
    data,
    sessions,
}: {
    data: { visitors: number; detailOpenUsers: number; bookingClickUsers: number; detailOpenRate: number | null; bookingClickRate: number | null };
    sessions: number;
}) {
    const rate = (value: number | null) => value === null ? '—' : `${value}%`;

    return (
        <div className={styles.todayMetricSummary}>
            <div className={styles.todayMetricGrid}>
                <div className={styles.todayBehaviorStage}>
                    <span>방문</span>
                    <strong>{data.visitors.toLocaleString()}명</strong>
                    <small>재방문 포함 총 {sessions.toLocaleString()}회 접속</small>
                </div>
                <div className={styles.todayBehaviorStage}>
                    <span>상세 열람</span>
                    <strong>{data.detailOpenUsers.toLocaleString()}명</strong>
                    <small>방문 대비 {rate(data.detailOpenRate)}</small>
                </div>
                <div className={styles.todayBehaviorStage}>
                    <span>예약 이동</span>
                    <strong>{data.bookingClickUsers.toLocaleString()}명</strong>
                    <small>여행사 예약 페이지를 연 사람</small>
                </div>
            </div>
            <div className={styles.todayBehaviorResult}>
                <span>방문자 대비 예약 이동 비율</span>
                <strong>{rate(data.bookingClickRate)}</strong><small>예약 이동 {data.bookingClickUsers}명 / 방문 {data.visitors}명</small>
            </div>
        </div>
    );
}

