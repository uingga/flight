'use client';

import { useEffect, useState } from 'react';
import styles from './AdminThreadsPosts.module.css';

export function formatAnalyticsTime(value?: string) {
    return value && Number.isFinite(Date.parse(value))
        ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) + ' KST'
        : '확인 불가';
}

export default function AdminAnalyticsFreshness({ generatedAt }: { generatedAt?: string }) {
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, []);
    const timestamp = generatedAt ? Date.parse(generatedAt) : NaN;
    const minutes = now !== null && Number.isFinite(timestamp) ? Math.max(0, Math.floor((now - timestamp) / 60_000)) : null;
    return <div className={styles.note}>
        <div><strong>실시간 통계가 아닙니다.</strong> 보고서 조회: <time dateTime={Number.isFinite(timestamp) ? generatedAt : undefined}>{formatAnalyticsTime(generatedAt)}</time>
            {minutes !== null && <> · {minutes}분 전</>}</div>
        <div>{minutes !== null && minutes >= 10 ? '10분 이상 지난 보고서입니다. 새로고침하면 다시 조회합니다.' : '같은 조회 결과는 최대 10분간 재사용합니다.'} 탭을 바꾸는 것만으로는 갱신되지 않습니다.</div>
        <div>GA4 방문·상세·예약 이동은 수시간 늦게 반영될 수 있으며 오늘 수치는 잠정치입니다. 위 시각은 데이터 반영 완료 시각이 아닙니다.</div>
    </div>;
}
