'use client';

import { useEffect, useState } from 'react';
import * as gtag from '@/lib/analytics';
import { dealAlertRegionLabel, type DealAlertRegion } from '@/lib/deal-alerts';
import styles from './MobileDealAlertSheet.module.css';

interface MobileDealAlertSheetProps {
    open: boolean;
    initialDeparture: string;
    initialRegion: string;
    initialMaxPrice: number;
    onClose: () => void;
}

type SaveStatus = 'idle' | 'saving' | 'sent' | 'error';

const DEPARTURES = ['인천', '부산', '대구', '청주'];
const REGIONS: Array<{ value: DealAlertRegion; label: string }> = [
    { value: '일본', label: '일본' },
    { value: '동남아', label: '동남아' },
    { value: '중국', label: '중화권' },
    { value: '남태평양', label: '남태평양' },
    { value: 'all', label: '아무데나' },
];
const BUDGETS = [150_000, 200_000, 300_000, 500_000];

const normalizeDeparture = (value: string) => {
    if (value.startsWith('부산')) return '부산';
    if (value === '대구' || value === '청주') return value;
    return '인천';
};

const normalizeRegion = (value: string): DealAlertRegion => {
    if (value === '중화권') return '중국';
    if (value === '일본' || value === '동남아' || value === '남태평양') return value;
    return 'all';
};

const formatPrice = (price: number) => `${Math.round(price / 10_000)}만원`;

const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from(rawData, character => character.charCodeAt(0));
};

const postAlert = async (payload: Record<string, unknown>) => {
    const nonceResponse = await fetch('/api/alerts', { method: 'GET', credentials: 'same-origin' });
    if (!nonceResponse.ok) throw new Error('알림 보안 확인에 실패했어요.');

    const response = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error === 'daily limit reached'
        ? '오늘 등록할 수 있는 알림 수를 모두 사용했어요.'
        : '알림을 저장하지 못했어요. 잠시 뒤 다시 시도해주세요.');
};

export default function MobileDealAlertSheet({
    open,
    initialDeparture,
    initialRegion,
    initialMaxPrice,
    onClose,
}: MobileDealAlertSheetProps) {
    const [departure, setDeparture] = useState('인천');
    const [region, setRegion] = useState<DealAlertRegion>('일본');
    const [maxPrice, setMaxPrice] = useState('200000');
    const [status, setStatus] = useState<SaveStatus>('idle');
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setDeparture(normalizeDeparture(initialDeparture));
        setRegion(normalizeRegion(initialRegion));
        setMaxPrice(String(initialMaxPrice || 200_000));
        setStatus('idle');
        setMessage(null);
    }, [initialDeparture, initialMaxPrice, initialRegion, open]);

    if (!open) return null;

    const saveAlert = async () => {
        const budget = Number(maxPrice);
        if (!Number.isFinite(budget) || budget < 10_000 || budget > 10_000_000) {
            setStatus('error');
            setMessage('예산을 1만원 이상으로 입력해주세요.');
            return;
        }

        const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent);
        const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches
            || standaloneNavigator.standalone === true;
        if (isIOS && !isStandalone) {
            setStatus('error');
            setMessage('아이폰은 Safari 공유 버튼 → 홈 화면에 추가한 뒤 티키티킷 아이콘에서 신청해주세요.');
            return;
        }

        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
            setStatus('error');
            setMessage('이 브라우저는 특가 알림을 지원하지 않아요.');
            return;
        }

        setStatus('saving');
        setMessage(null);
        try {
            const permission = Notification.permission === 'granted'
                ? 'granted'
                : await Notification.requestPermission();
            if (permission !== 'granted') throw new Error('브라우저 설정에서 알림을 허용해주세요.');

            const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
            if (!vapidPublicKey) throw new Error('특가 알림을 준비 중이에요. 잠시 뒤 다시 시도해주세요.');

            const registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription()
                || await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
                });

            await postAlert({
                subscription: subscription.toJSON(),
                conditions: {
                    alertType: 'deal',
                    departureCity: departure,
                    region,
                    maxPrice: budget,
                },
            });
            gtag.trackDealAlertSetup(departure, region, budget);
            setStatus('sent');
            setMessage(`${departure} 출발 · ${dealAlertRegionLabel(region)} · ${formatPrice(budget)} 이하`);
        } catch (error) {
            setStatus('error');
            setMessage(error instanceof Error ? error.message : '알림을 저장하지 못했어요.');
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="deal-alert-title" onClick={event => event.stopPropagation()}>
                <div className={styles.handle} />
                <header className={styles.header}>
                    <div>
                        <p>특가 알림</p>
                        <h2 id="deal-alert-title">떠날 만한 표가 없나요?</h2>
                        <span>좋은 표만 골라서 알려드려요.</span>
                    </div>
                    <button type="button" onClick={onClose} aria-label="닫기">×</button>
                </header>

                {status === 'sent' ? (
                    <div className={styles.success}>
                        <b>✓</b>
                        <strong>조건을 저장했어요.</strong>
                        <span>{message}</span>
                        <p>조건에 맞는 표를 전부 보내지는 않아요. 정말 볼 만할 때만 알려드릴게요.</p>
                        <button type="button" onClick={onClose}>확인</button>
                    </div>
                ) : (
                    <div className={styles.body}>
                        <fieldset>
                            <legend>어디서 출발하세요?</legend>
                            <div className={styles.options}>
                                {DEPARTURES.map(item => (
                                    <button type="button" key={item} className={departure === item ? styles.active : ''} onClick={() => setDeparture(item)}>{item}</button>
                                ))}
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend>어디쯤 가고 싶으세요?</legend>
                            <div className={styles.options}>
                                {REGIONS.map(item => (
                                    <button type="button" key={item.value} className={region === item.value ? styles.active : ''} onClick={() => setRegion(item.value)}>{item.label}</button>
                                ))}
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend>얼마까지 괜찮으세요?</legend>
                            <div className={styles.options}>
                                {BUDGETS.map(price => (
                                    <button type="button" key={price} className={maxPrice === String(price) ? styles.active : ''} onClick={() => setMaxPrice(String(price))}>{formatPrice(price)}</button>
                                ))}
                            </div>
                            <label className={styles.customPrice}>
                                <input type="number" min="10000" max="10000000" step="1000" inputMode="numeric" value={maxPrice} onChange={event => setMaxPrice(event.target.value)} aria-label="최대 예산" />
                                <span>원 이하</span>
                            </label>
                        </fieldset>

                        <p className={styles.note}>날짜와 도시는 정하지 않아도 돼요. 로그인 없이 이 기기에 알림을 보냅니다.</p>
                        {message && <p className={styles.error} role="alert">{message}</p>}
                        <button type="button" className={styles.submit} disabled={status === 'saving'} onClick={() => void saveAlert()}>
                            {status === 'saving' ? '저장 중…' : '이 조건으로 알려주세요'}
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}
