'use client';

import React, { useEffect, useState } from 'react';
import type { RetentionResult } from '@/lib/ga-retention';
import styles from '@/app/admin/admin.module.css';

export default function AdminRetention({ adminKey }: { adminKey: string }) {
    const [data, setData] = useState<RetentionResult | null>(null);
    const [message, setMessage] = useState('재방문율을 불러오는 중입니다.');
    useEffect(() => {
        const controller = new AbortController();
        setData(null);
        setMessage('재방문율을 불러오는 중입니다.');
        fetch('/api/ga-retention', { headers: { 'x-admin-key': adminKey }, signal: controller.signal, cache: 'no-store' })
            .then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
            .then(result => { if (result.available) setData(result); else setMessage(result.message); })
            .catch(() => { if (!controller.signal.aborted) setMessage('재방문율을 불러오지 못했습니다.'); });
        return () => controller.abort();
    }, [adminKey]);
    return <AdminRetentionView data={data} message={message} />;
}

export function AdminRetentionView({ data, message }: { data: RetentionResult | null; message: string }) {
    return <section className={styles.section} id="visitor-retention">
        <div className={styles.sectionHeading}><div>
            <h2>처음 방문한 뒤 다시 왔나요?</h2>
            <p>첫 방문 다음 날부터 기간 안에 다시 방문한 사람을 한 번만 셉니다.</p>
        </div></div>
        {data ? <>
            <div className={styles.segmentGrid}>
                {data.windows.map(window => <article className={styles.signalCard} key={window.days}>
                    <span>{window.days}일 이내 재방문율{window.days === 7 ? ' · 대표' : ' · 보조'}</span>
                    <strong>{window.rate === null ? '—' : `${window.rate}%`}</strong>
                    <small>{window.users ? `${window.users.toLocaleString()}명 중 ${window.returnedUsers.toLocaleString()}명 재방문` : '측정 가능한 첫 방문자가 없습니다.'}</small>
                    <small>첫 방문 {window.cohortStart} ~ {window.cohortEnd}</small>
                </article>)}
            </div>
            <p>{data.asOf}까지 · 관찰 기간을 채운 최근 30일치 첫 방문자 기준입니다. 두 지표의 첫 방문 기간은 다릅니다. GA4 처리 지연과 기기·쿠키 변경에 따라 수치가 달라질 수 있습니다.</p>
        </> : <div className={styles.dealReviewEmpty}>{message}</div>}
    </section>;
}
