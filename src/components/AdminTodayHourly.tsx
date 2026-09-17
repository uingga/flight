import styles from '@/app/admin/admin.module.css';
interface GaHourlyBucket {
    startHour: number;
    endHour: number;
    sessions: number;
}

interface GaHourlySessions {
    timeZone: string;
    timeZoneSource: 'property' | 'kst_fallback';
    bucketHours: number;
    today: GaHourlyBucket[];
    recent7: GaHourlyBucket[];
    current: GaHourlyBucket[];
}

export function hourRangeLabel(bucket: GaHourlyBucket) {
    const hour = (value: number) => `${String(value).padStart(2, '0')}:00`;
    return `${hour(bucket.startHour)}–${hour(bucket.endHour)}`;
}

export function HourlyTimeZoneBadge({ data }: { data: GaHourlySessions }) {
    const isKst = data.timeZone === 'Asia/Seoul';
    const isFallback = data.timeZoneSource === 'kst_fallback';
    const label = isFallback
        ? '속성 시간대 미수신 · KST 임시 기준'
        : isKst
            ? 'GA4 속성 시간대 · KST (Asia/Seoul)'
            : `GA4 속성 시간대 · ${data.timeZone} (KST 아님)`;

    return (
        <span className={isKst && !isFallback ? styles.hourlyTimeZone : `${styles.hourlyTimeZone} ${styles.hourlyTimeZoneWarn}`}>
            {label}
        </span>
    );
}

export default function TodayHourlySessions({ data }: { data: GaHourlySessions }) {
    const total = data.today.reduce((sum, bucket) => sum + bucket.sessions, 0);
    const max = Math.max(...data.today.map(bucket => bucket.sessions), 1);
    const peak = total > 0
        ? data.today.reduce((best, bucket) => bucket.sessions > best.sessions ? bucket : best)
        : null;

    return (
        <div className={styles.hourlyPanel}>
            <div className={styles.hourlyPanelHead}>
                <div className={styles.hourlyPeak}>
                    <span>가장 붐빈 시간</span>
                    <strong>{peak ? hourRangeLabel(peak) : '아직 없음'}</strong>
                    <small>{peak ? `${peak.sessions.toLocaleString()}회 · 오늘 전체 ${total.toLocaleString()}회` : '오늘 시작된 접속이 아직 없습니다.'}</small>
                </div>
                <HourlyTimeZoneBadge data={data} />
            </div>
            <div className={styles.hourlyChartScroll}>
                <div className={styles.hourlyChart} role="list" aria-label="오늘 1시간 단위 세션">
                    {data.today.map(bucket => {
                        const isPeak = peak?.startHour === bucket.startHour;
                        return (
                            <div
                                key={bucket.startHour}
                                className={isPeak ? `${styles.hourlyBarColumn} ${styles.hourlyBarColumnPeak}` : styles.hourlyBarColumn}
                                role="listitem"
                                aria-label={`${hourRangeLabel(bucket)}, 접속 ${bucket.sessions}회`}
                                title={`${hourRangeLabel(bucket)} · ${bucket.sessions.toLocaleString()}회`}
                            >
                                <span className={styles.hourlyBarValue}>{bucket.sessions > 0 ? bucket.sessions.toLocaleString() : ''}</span>
                                <span className={styles.hourlyBarTrack} aria-hidden="true">
                                    <span
                                        className={styles.hourlyBar}
                                        style={{ height: bucket.sessions > 0 ? `${Math.max(6, (bucket.sessions / max) * 100)}%` : '0%' }}
                                    />
                                </span>
                                <time className={styles.hourlyBarTime} dateTime={`${String(bucket.startHour).padStart(2, '0')}:00`}>
                                    {bucket.startHour % 3 === 0 ? `${String(bucket.startHour).padStart(2, '0')}시` : ''}
                                </time>
                            </div>
                        );
                    })}
                </div>
            </div>
            <p className={styles.hourlyFootnote}>세션은 해당 시간에 시작된 접속 횟수입니다. 아직 오지 않은 시간은 0으로 표시합니다.</p>
        </div>
    );
}

