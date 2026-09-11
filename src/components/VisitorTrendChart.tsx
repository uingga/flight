'use client';
import {useEffect, useState} from 'react';
import styles from '@/app/admin/admin.module.css';
export default function VisitorTrendChart({ trend, returning = false }: { trend: Array<{date: string; users: number; sessions?: number}>; returning?: boolean }) {
    const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, trend.length - 1));

    useEffect(() => {
        setSelectedIndex(Math.max(0, trend.length - 1));
    }, [trend.length]);

    if (trend.length === 0) return <div className={styles.emptyState}>일별 방문 기록이 아직 없어요.</div>;

    const max = Math.max(...trend.map(point => point.users), 1);
    const selected = trend[Math.min(selectedIndex, trend.length - 1)];
    const tickIndexes = new Set([0, 7, 14, 21, trend.length - 1].filter(index => index < trend.length));
    const shortDate = (date: string) => {
        const [, month, day] = date.split('-').map(Number);
        return `${month}/${day}`;
    };
    const selectedDate = shortDate(selected.date).replace('/', '월 ') + '일';

    return (
        <div className={styles.visitorTrend}>
            <div className={styles.visitorTrendSelected} aria-live="polite">
                <span>{selectedDate}</span>
                <strong>{selected.users.toLocaleString()}명</strong>
                {!returning && <small>· 재방문 포함 총 {selected.sessions?.toLocaleString()}회 접속</small>}
            </div>
            <div className={`${styles.trendChart} ${styles.desktopVisitorTrend}`} aria-label={returning ? '최근 30일 일별 재방문자' : '최근 30일 일별 방문자'}>
                {trend.map((point, index) => (
                    <button
                        key={point.date}
                        type="button"
                        className={index === selectedIndex ? `${styles.trendCol} ${styles.trendColSelected}` : styles.trendCol}
                        onClick={() => setSelectedIndex(index)}
                        aria-label={`${point.date}, ${returning ? '다시 온 사람' : '방문자'} ${point.users}명`}
                        aria-pressed={index === selectedIndex}
                    >
                        <span className={styles.trendValue}>{point.users.toLocaleString()}명</span>
                        <span className={styles.trendTrack}>
                            <span className={styles.trendBar} style={{ height: `${(point.users / max) * 100}%` }} />
                        </span>
                        <span className={styles.trendDate}>{tickIndexes.has(index) ? shortDate(point.date) : ''}</span>
                    </button>
                ))}
            </div>
            <div className={styles.verticalTrend} aria-label={returning ? '최근 30일 일별 재방문자' : '최근 30일 일별 방문자'}>
                {[...trend].reverse().map(point => (
                    <div key={point.date} className={styles.verticalTrendRow}>
                        <time dateTime={point.date}>{shortDate(point.date)}</time>
                        <div className={styles.verticalTrendTrack} aria-hidden="true">
                            <div
                                className={styles.verticalTrendBar}
                                style={{ width: `${(point.users / max) * 100}%` }}
                            />
                        </div>
                        <strong>{point.users.toLocaleString()}명</strong>
                    </div>
                ))}
            </div>
            <p className={styles.trendHint}>{returning ? '이전 방문 이력이 있는 활성 사용자입니다. 같은 날 여러 번 와도 한 명으로 집계하며, 날짜별 인원을 합친 값은 기간 전체 인원과 다릅니다. 오늘 수치는 집계 중입니다.' : '방문자는 사람 수, 접속은 같은 사람의 재방문을 포함한 횟수입니다.'}</p>
        </div>
    );
}
