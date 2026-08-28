'use client';

import { useEffect, useRef, useState } from 'react';
import * as gtag from '@/lib/analytics';
import { dealAlertRegionLabel, type DealAlertRegion } from '@/lib/deal-alerts';
import { useSwipeToDismiss } from '@/lib/hooks/use-swipe-to-dismiss';
import OverlayDialog from '@/components/ui/OverlayDialog';
import styles from './MobileDealAlertSheet.module.css';

interface MobileDealAlertSheetProps {
    open: boolean;
    active?: boolean;
    initialDeparture: string;
    initialRegion: string;
    initialMaxPrice: number;
    initialRoute?: {
        flightId?: string;
        departureCity: string;
        arrivalCity: string;
        currentPrice?: number;
        suggestedPrice?: number;
    } | null;
    onSaveSearchCondition?: (condition: AlertSearchCondition) => Promise<void>;
    onClose: () => void;
}

export interface AlertSearchCondition {
    departureCity: string;
    arrivalCity?: string;
    region?: DealAlertRegion;
    maxPrice: number;
}

type SaveStatus = 'idle' | 'saving' | 'sent' | 'error';
type SheetView = 'create' | 'manage';
type SuccessKind = 'alert' | 'search';

interface ManagedAlert {
    id: string;
    type: 'price' | 'deal';
    departureCity: string;
    arrivalCity?: string;
    region?: DealAlertRegion;
    maxPrice: number;
    draftPrice: string;
}

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

const getCurrentPushSubscription = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    return registration ? registration.pushManager.getSubscription() : null;
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
    if (!response.ok) {
        const errors: Record<string, string> = {
            'daily limit reached': '오늘 등록할 수 있는 알림 수를 모두 사용했어요.',
            'capacity reached': '현재 알림 신청이 많아 잠시 등록할 수 없어요.',
            'too many alerts': '이 기기에 등록할 수 있는 알림 수를 모두 사용했어요.',
            'test cooldown': '테스트 알림은 10분에 한 번 보낼 수 있어요.',
            'no active alerts': '테스트할 수 있는 알림이 없어요.',
            'test unavailable': '테스트 알림을 잠시 사용할 수 없어요.',
        };
        throw new Error(errors[data.error] || '알림을 처리하지 못했어요. 잠시 뒤 다시 시도해주세요.');
    }
    return data as Record<string, unknown>;
};

export default function MobileDealAlertSheet({
    open,
    active = true,
    initialDeparture,
    initialRegion,
    initialMaxPrice,
    initialRoute = null,
    onSaveSearchCondition,
    onClose,
}: MobileDealAlertSheetProps) {
    const [departure, setDeparture] = useState('인천');
    const [region, setRegion] = useState<DealAlertRegion>('일본');
    const [maxPrice, setMaxPrice] = useState('200000');
    const [status, setStatus] = useState<SaveStatus>('idle');
    const [successKind, setSuccessKind] = useState<SuccessKind>('alert');
    const [searchSaveWarning, setSearchSaveWarning] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [view, setView] = useState<SheetView>('create');
    const [managedAlerts, setManagedAlerts] = useState<ManagedAlert[]>([]);
    const [alertsLoading, setAlertsLoading] = useState(false);
    const [alertBusy, setAlertBusy] = useState<string | null>(null);
    const [managerMessage, setManagerMessage] = useState<string | null>(null);
    const sheetRef = useRef<HTMLElement>(null);
    const swipeHandle = useSwipeToDismiss({ open, sheetRef, onDismiss: onClose });

    const loadManagedAlerts = async () => {
        setAlertsLoading(true);
        setManagerMessage(null);
        try {
            const subscription = await getCurrentPushSubscription();
            if (!subscription) {
                setManagedAlerts([]);
                return;
            }
            const data = await postAlert({ action: 'list', subscription: subscription.toJSON() });
            const alerts = Array.isArray(data.alerts) ? data.alerts : [];
            setManagedAlerts(alerts.map(item => {
                const alert = item as Omit<ManagedAlert, 'draftPrice'>;
                return { ...alert, draftPrice: String(alert.maxPrice) };
            }));
        } catch (error) {
            setManagerMessage(error instanceof Error ? error.message : '내 알림을 불러오지 못했어요.');
        } finally {
            setAlertsLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setDeparture(normalizeDeparture(initialRoute?.departureCity || initialDeparture));
        setRegion(normalizeRegion(initialRegion));
        setMaxPrice(String(initialRoute?.currentPrice || initialRoute?.suggestedPrice || initialMaxPrice || 200_000));
        setStatus('idle');
        setSuccessKind('alert');
        setSearchSaveWarning(false);
        setMessage(null);
        setView('create');
        setManagerMessage(null);
    }, [initialDeparture, initialMaxPrice, initialRegion, initialRoute, open]);

    useEffect(() => {
        if (!open) return;
        void loadManagedAlerts();
        // 열릴 때 현재 기기의 푸시 구독을 한 번만 확인한다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

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
                    alertType: initialRoute ? 'price' : 'deal',
                    departureCity: initialRoute?.departureCity || departure,
                    ...(initialRoute
                        ? { arrivalCity: initialRoute.arrivalCity }
                        : { region }),
                    maxPrice: budget,
                },
                ...(initialRoute?.flightId && initialRoute.currentPrice ? {
                    baseline: { flightId: initialRoute.flightId, price: initialRoute.currentPrice },
                } : {}),
            });
            if (initialRoute) {
                gtag.trackAlertSetup(`${initialRoute.departureCity}-${initialRoute.arrivalCity}`, budget, 'redesign_detail');
            } else {
                gtag.trackDealAlertSetup(departure, region, budget);
            }
            let failedToSaveSearch = false;
            if (onSaveSearchCondition) {
                try {
                    await onSaveSearchCondition({
                        departureCity: initialRoute?.departureCity || departure,
                        ...(initialRoute ? { arrivalCity: initialRoute.arrivalCity } : { region }),
                        maxPrice: budget,
                    });
                } catch {
                    failedToSaveSearch = true;
                }
            }
            await loadManagedAlerts();
            setSuccessKind('alert');
            setSearchSaveWarning(failedToSaveSearch);
            setStatus('sent');
            setMessage(initialRoute
                ? `${initialRoute.departureCity} → ${initialRoute.arrivalCity} · ${formatPrice(budget)} 이하`
                : `${departure} 출발 · ${dealAlertRegionLabel(region)} · ${formatPrice(budget)} 이하`);
        } catch (error) {
            setStatus('error');
            setMessage(error instanceof Error ? error.message : '알림을 저장하지 못했어요.');
        }
    };

    const saveSearchOnly = async () => {
        const budget = Number(maxPrice);
        if (!onSaveSearchCondition) return;
        if (!Number.isFinite(budget) || budget < 10_000 || budget > 10_000_000) {
            setStatus('error');
            setMessage('예산을 1만원 이상으로 입력해주세요.');
            return;
        }
        setStatus('saving');
        setMessage(null);
        try {
            await onSaveSearchCondition({
                departureCity: initialRoute?.departureCity || departure,
                ...(initialRoute ? { arrivalCity: initialRoute.arrivalCity } : { region }),
                maxPrice: budget,
            });
            setSuccessKind('search');
            setSearchSaveWarning(false);
            setStatus('sent');
            setMessage(initialRoute
                ? `${initialRoute.departureCity} → ${initialRoute.arrivalCity} · ${formatPrice(budget)} 이하`
                : `${departure} 출발 · ${dealAlertRegionLabel(region)} · ${formatPrice(budget)} 이하`);
        } catch (error) {
            setStatus('error');
            setMessage(error instanceof Error ? error.message : '조건을 저장하지 못했어요.');
        }
    };

    const updateManagedAlert = async (alert: ManagedAlert) => {
        const budget = Number(alert.draftPrice);
        if (!Number.isFinite(budget) || budget < 10_000 || budget > 10_000_000) {
            setManagerMessage('목표 가격을 1만원 이상으로 입력해주세요.');
            return;
        }
        setAlertBusy(alert.id);
        setManagerMessage(null);
        try {
            const subscription = await getCurrentPushSubscription();
            if (!subscription) throw new Error('이 기기의 알림 연결을 찾지 못했어요.');
            await postAlert({
                action: 'update',
                subscription: subscription.toJSON(),
                alertId: alert.id,
                maxPrice: budget,
            });
            setManagedAlerts(current => current.map(item => item.id === alert.id
                ? { ...item, maxPrice: Math.round(budget), draftPrice: String(Math.round(budget)) }
                : item));
            setManagerMessage('목표 가격을 바꿨어요.');
        } catch (error) {
            setManagerMessage(error instanceof Error ? error.message : '목표 가격을 바꾸지 못했어요.');
        } finally {
            setAlertBusy(null);
        }
    };

    const deleteManagedAlert = async (alert: ManagedAlert) => {
        setAlertBusy(alert.id);
        setManagerMessage(null);
        try {
            const subscription = await getCurrentPushSubscription();
            if (!subscription) throw new Error('이 기기의 알림 연결을 찾지 못했어요.');
            await postAlert({ action: 'delete', subscription: subscription.toJSON(), alertId: alert.id });
            setManagedAlerts(current => current.filter(item => item.id !== alert.id));
            setManagerMessage('알림을 해제했어요.');
        } catch (error) {
            setManagerMessage(error instanceof Error ? error.message : '알림을 해제하지 못했어요.');
        } finally {
            setAlertBusy(null);
        }
    };

    const sendTestAlert = async () => {
        setAlertBusy('test');
        setManagerMessage(null);
        try {
            const subscription = await getCurrentPushSubscription();
            if (!subscription) throw new Error('이 기기의 알림 연결을 찾지 못했어요.');
            await postAlert({ action: 'test', subscription: subscription.toJSON() });
            setManagerMessage('테스트 알림을 요청했어요. 잠시 후 기기 알림을 확인해주세요.');
        } catch (error) {
            setManagerMessage(error instanceof Error ? error.message : '테스트 알림을 보내지 못했어요.');
        } finally {
            setAlertBusy(null);
        }
    };

    return (
        <OverlayDialog
            open={open}
            active={active}
            dialogRef={sheetRef}
            onClose={onClose}
            overlayClassName={styles.overlay}
            dialogClassName={styles.sheet}
            ariaLabelledBy="deal-alert-title"
        >
                <div className={styles.handle} aria-hidden="true" {...swipeHandle} />
                <header className={styles.header}>
                    <div>
                        <p>특가 알림</p>
                        <h2 id="deal-alert-title">{view === 'manage'
                            ? '내 특가 알림'
                            : initialRoute ? `${initialRoute.arrivalCity} 가격 알림` : '떠날 만한 표가 없나요?'}</h2>
                        <span>{view === 'manage'
                            ? '이 기기에 등록한 조건을 관리해요.'
                            : initialRoute ? '이 가격 이하로 내려오면 알려드려요.' : '좋은 표만 골라서 알려드려요.'}</span>
                    </div>
                    <button type="button" onClick={onClose} aria-label="닫기">×</button>
                </header>

                <nav className={styles.tabs} aria-label="특가 알림 메뉴">
                    <button type="button" className={view === 'create' ? styles.activeTab : ''} onClick={() => setView('create')}>새 알림</button>
                    <button type="button" className={view === 'manage' ? styles.activeTab : ''} onClick={() => { setView('manage'); void loadManagedAlerts(); }}>
                        내 알림{managedAlerts.length > 0 ? ` ${managedAlerts.length}` : ''}
                    </button>
                </nav>

                {view === 'manage' ? (
                    <div className={styles.managerBody}>
                        {alertsLoading ? (
                            <div className={styles.managerEmpty}>
                                <span>이 기기에 등록한 알림을 불러오고 있어요…</span>
                            </div>
                        ) : managedAlerts.length === 0 ? (
                            <div className={styles.managerEmpty}>
                                <strong>이 기기에 등록된 알림이 없어요.</strong>
                                <span>출발지·지역·예산만 정하면 볼 만한 표가 나올 때 알려드려요.</span>
                                <button type="button" onClick={() => setView('create')}>새 알림 만들기</button>
                            </div>
                        ) : (
                            <div className={styles.alertList}>
                                {managedAlerts.map(alert => {
                                    const destination = alert.type === 'deal' && alert.region
                                        ? dealAlertRegionLabel(alert.region)
                                        : alert.arrivalCity || '목적지';
                                    return (
                                        <article className={styles.alertItem} key={alert.id}>
                                            <div className={styles.alertItemTitle}>
                                                <strong>{alert.departureCity} 출발 · {destination}</strong>
                                                <span>{alert.type === 'deal' ? '좋은 표만 골라서 알림' : '노선 가격 알림'}</span>
                                            </div>
                                            <label className={styles.alertPriceInput}>
                                                <input
                                                    type="number"
                                                    min="10000"
                                                    max="10000000"
                                                    step="1000"
                                                    inputMode="numeric"
                                                    value={alert.draftPrice}
                                                    onChange={event => setManagedAlerts(current => current.map(item => item.id === alert.id
                                                        ? { ...item, draftPrice: event.target.value }
                                                        : item))}
                                                    aria-label={`${destination} 알림 목표 가격`}
                                                />
                                                <span>원 이하</span>
                                            </label>
                                            <div className={styles.alertItemActions}>
                                                <button type="button" disabled={alertBusy === alert.id} onClick={() => void updateManagedAlert(alert)}>가격 저장</button>
                                                <button type="button" disabled={alertBusy === alert.id} onClick={() => void deleteManagedAlert(alert)}>알림 해제</button>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                        {managerMessage && <p className={styles.managerMessage} role="status">{managerMessage}</p>}
                        {managedAlerts.length > 0 && (
                            <div className={styles.managerFooter}>
                                <span>알림은 브라우저 권한 때문에 기기별로 관리돼요.</span>
                                <button type="button" disabled={alertBusy === 'test'} onClick={() => void sendTestAlert()}>
                                    {alertBusy === 'test' ? '요청 중…' : '테스트 알림 보내기'}
                                </button>
                            </div>
                        )}
                    </div>
                ) : status === 'sent' ? (
                    <div className={styles.success}>
                        <b>✓</b>
                        <strong>{successKind === 'alert' ? '특가 알림을 저장했어요.' : '다시 볼 조건을 저장했어요.'}</strong>
                        <span>{message}</span>
                        <p>{successKind === 'alert'
                            ? searchSaveWarning
                                ? '알림은 켰지만 내 여행에는 저장하지 못했어요. 알림은 정상적으로 받을 수 있어요.'
                                : onSaveSearchCondition
                                    ? '같은 조건을 내 여행에서도 다시 볼 수 있어요. 정말 볼 만할 때만 알려드릴게요.'
                                    : '조건에 맞는 표를 전부 보내지는 않아요. 정말 볼 만할 때만 알려드릴게요.'
                            : '내 여행의 ‘다시 볼 조건’에서 한 번에 다시 볼 수 있어요.'}</p>
                        {successKind === 'alert' ? (
                            <div className={styles.successActions}>
                                <button type="button" onClick={() => setView('manage')}>내 알림 보기</button>
                                <button type="button" onClick={onClose}>확인</button>
                            </div>
                        ) : (
                            <button type="button" onClick={onClose}>확인</button>
                        )}
                    </div>
                ) : (
                    <div className={styles.body}>
                        {initialRoute ? (
                            <div className={styles.routeAlertSummary}>
                                <span>선택한 노선</span>
                                <strong>{initialRoute.departureCity} → {initialRoute.arrivalCity}</strong>
                                <small>{initialRoute.currentPrice
                                    ? `현재 표시가 ${initialRoute.currentPrice.toLocaleString('ko-KR')}원`
                                    : initialRoute.suggestedPrice
                                        ? `비슷한 시기 평균을 참고해 ${initialRoute.suggestedPrice.toLocaleString('ko-KR')}원부터 제안해요.`
                                    : '원하는 가격을 정하면 새 표가 나올 때 확인해요.'}</small>
                            </div>
                        ) : (
                            <>
                                <fieldset>
                                    <legend>어디서 출발하세요?</legend>
                                    <div className={styles.options}>
                                        {DEPARTURES.map(item => (
                                            <button type="button" key={item} className={departure === item ? styles.active : ''} aria-pressed={departure === item} onClick={() => setDeparture(item)}>{item}</button>
                                        ))}
                                    </div>
                                </fieldset>

                                <fieldset>
                                    <legend>어디쯤 가고 싶으세요?</legend>
                                    <div className={styles.options}>
                                        {REGIONS.map(item => (
                                            <button type="button" key={item.value} className={region === item.value ? styles.active : ''} aria-pressed={region === item.value} onClick={() => setRegion(item.value)}>{item.label}</button>
                                        ))}
                                    </div>
                                </fieldset>
                            </>
                        )}

                        <fieldset>
                            <legend>얼마까지 괜찮으세요?</legend>
                            <div className={styles.options}>
                                {BUDGETS.map(price => (
                                    <button type="button" key={price} className={maxPrice === String(price) ? styles.active : ''} aria-pressed={maxPrice === String(price)} onClick={() => setMaxPrice(String(price))}>{formatPrice(price)}</button>
                                ))}
                            </div>
                            <label className={styles.customPrice}>
                                <input type="number" min="10000" max="10000000" step="1000" inputMode="numeric" value={maxPrice} onChange={event => setMaxPrice(event.target.value)} aria-label="최대 예산" />
                                <span>원 이하</span>
                            </label>
                        </fieldset>

                        <p className={styles.note}>{initialRoute
                            ? '현재 표가 사라져도 같은 노선에서 조건에 맞는 가격을 찾으면 알려드려요.'
                            : onSaveSearchCondition
                                ? '알림을 켜면 같은 조건을 내 여행에도 저장해요.'
                                : '날짜와 도시는 정하지 않아도 돼요. 로그인 없이 이 기기에 알림을 보냅니다.'}</p>
                        {message && <p className={styles.error} role="alert">{message}</p>}
                        <button type="button" className={styles.submit} disabled={status === 'saving'} onClick={() => void saveAlert()}>
                            {status === 'saving' ? '저장 중…' : '이 조건으로 특가 알림 받기'}
                        </button>
                        {onSaveSearchCondition && (
                            <button type="button" className={styles.saveOnly} disabled={status === 'saving'} onClick={() => void saveSearchOnly()}>
                                알림 없이 조건만 저장
                            </button>
                        )}
                    </div>
                )}
        </OverlayDialog>
    );
}
