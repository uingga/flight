'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type {
    AccountController,
    AccountFlightSnapshot,
    AccountSearchFilters,
} from './useAccount';
import styles from './AccountSheet.module.css';
import * as gtag from '@/lib/analytics';
import { useDialogFocus } from '@/lib/hooks/use-dialog-focus';
import { useSwipeToDismiss } from '@/lib/hooks/use-swipe-to-dismiss';

interface AccountSheetProps {
    open: boolean;
    onClose: () => void;
    account: AccountController;
    onApplySearch: (filters: AccountSearchFilters) => void;
    onOpenFlight: (flightId: string) => void;
    onOpenAlert: () => void;
    onFavoriteRemoved: (flightId: string) => void;
    guestFavorites?: AccountFlightSnapshot[];
}

type AccountTab = 'favorites' | 'recent' | 'searches';

const SOURCE_NAMES: Record<string, string> = {
    ybtour: '노랑풍선', modetour: '모두투어', hanatour: '하나투어',
    onlinetour: '온라인투어', ttang: '땡처리닷컴', myrealtrip: '마이리얼트립',
};

function formatDate(value: string) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${Number(match[2])}월 ${Number(match[3])}일` : value;
}

function FlightRow({
    snapshot, onClick, availableNow = true, savedPrice, onRemove,
}: {
    snapshot: AccountFlightSnapshot;
    onClick: () => void;
    availableNow?: boolean;
    savedPrice?: number;
    onRemove?: () => void;
}) {
    const priceChange = savedPrice && availableNow ? snapshot.price - savedPrice : 0;
    return (
        <div className={styles.flightItem}>
            <button type="button" className={styles.flightRow} onClick={onClick}>
                <span className={styles.flightRowMain}>
                    <strong>{snapshot.departureCity} → {snapshot.arrivalCity}</strong>
                    <small>{availableNow ? `${formatDate(snapshot.departureDate)} 출발 · ${SOURCE_NAMES[snapshot.source] || snapshot.source}` : '현재 목록에서 내려감 · 저장 당시 정보'}</small>
                </span>
                <span className={styles.flightPrice}>
                    <strong>{snapshot.price.toLocaleString('ko-KR')}원</strong>
                    {priceChange !== 0 && <small className={priceChange < 0 ? styles.priceDown : styles.priceUp}>{Math.abs(priceChange).toLocaleString('ko-KR')}원 {priceChange < 0 ? '내림' : '오름'}</small>}
                </span>
            </button>
            {onRemove && <button type="button" className={styles.removeFavorite} aria-label={`${snapshot.arrivalCity} 찜 해제`} onClick={onRemove}>×</button>}
        </div>
    );
}

function savedSearchDateLabel(filters: AccountSearchFilters) {
    const period = ({
        'this-week': '이번 주', 'next-week': '다음 주',
        'this-month': '이번 달', 'next-month': '다음 달',
    } as Record<string, string>)[filters.datePeriod || ''];
    if (period) return period;
    return filters.startDate ? `${formatDate(filters.startDate)}부터` : '날짜 전체';
}

export default function AccountSheet({
    open, onClose, account, onApplySearch, onOpenFlight, onOpenAlert, onFavoriteRemoved, guestFavorites = [],
}: AccountSheetProps) {
    const [loginEmail, setLoginEmail] = useState('');
    const [code, setCode] = useState('');
    const [requestId, setRequestId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<AccountTab>('favorites');
    const firstInputRef = useRef<HTMLInputElement>(null);
    const sheetRef = useRef<HTMLElement>(null);
    useDialogFocus(open, sheetRef);
    const swipeHandle = useSwipeToDismiss({ open, sheetRef, onDismiss: onClose });

    useEffect(() => {
        if (!open) return;
        setError(null);
        const id = setTimeout(() => firstInputRef.current?.focus(), 180);
        return () => clearTimeout(id);
    }, [open]);

    if (!open) return null;

    const sendCode = async () => {
        setBusy(true); setError(null);
        try {
            const id = await account.requestCode(loginEmail);
            setRequestId(id);
            setCode('');
            gtag.trackAccountAction('code_requested');
            setTimeout(() => firstInputRef.current?.focus(), 50);
        } catch (err) {
            setError(err instanceof Error ? err.message : '인증번호를 보내지 못했어요.');
        } finally { setBusy(false); }
    };

    const verify = async () => {
        setBusy(true); setError(null);
        try {
            await account.verifyCode(loginEmail, code, requestId);
            setRequestId(''); setCode('');
            gtag.trackAccountAction('login');
        } catch (err) {
            setError(err instanceof Error ? err.message : '로그인하지 못했어요.');
        } finally { setBusy(false); }
    };

    const deleteAccount = async () => {
        if (!window.confirm('계정과 저장한 찜·최근 본 표·검색 조건을 모두 삭제할까요? 이 작업은 되돌릴 수 없어요.')) return;
        gtag.trackAccountAction('delete');
        setBusy(true); setError(null);
        try { await account.deleteAccount(); } catch (err) {
            setError(err instanceof Error ? err.message : '계정을 삭제하지 못했어요.');
        } finally { setBusy(false); }
    };

    const logout = async () => {
        gtag.trackAccountAction('logout');
        setBusy(true); setError(null);
        try { await account.logout(); } catch (err) {
            setError(err instanceof Error ? err.message : '로그아웃하지 못했어요.');
        } finally { setBusy(false); }
    };

    const clearRecent = async () => {
        setBusy(true); setError(null);
        try { await account.clearRecent(); } catch (err) {
            setError(err instanceof Error ? err.message : '최근 본 표를 비우지 못했어요.');
        } finally { setBusy(false); }
    };

    const deleteSavedSearch = async (id: string) => {
        setBusy(true); setError(null);
        try { await account.deleteSearch(id); } catch (err) {
            setError(err instanceof Error ? err.message : '저장한 검색을 삭제하지 못했어요.');
        } finally { setBusy(false); }
    };

    return (
        <div className={styles.overlay} role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
            <section ref={sheetRef} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="account-title">
                <div className={styles.handle} aria-hidden="true" {...swipeHandle} />
                <header className={styles.header}>
                    <div>
                        <p className={styles.eyebrow}>내 여행</p>
                        <h2 id="account-title">{account.status === 'authenticated' ? '저장해 둔 여행' : '어디서든 이어보기'}</h2>
                    </div>
                    <button type="button" className={styles.close} onClick={onClose} aria-label="닫기">×</button>
                </header>

                {account.status === 'loading' && <div className={styles.centerMessage}>계정 정보를 확인하고 있어요…</div>}
                {account.status === 'unavailable' && (
                    <div className={styles.centerMessage}>
                        <strong>로그인 기능을 준비 중이에요.</strong>
                        <span>{account.message || '잠시 뒤 다시 확인해 주세요.'}</span>
                    </div>
                )}

                {account.status === 'anonymous' && (
                    <div className={styles.loginBody}>
                        <p className={styles.loginIntro}>로그인하면 찜한 표, 최근 본 표, 저장한 검색 조건을 휴대폰과 컴퓨터에서 그대로 이어볼 수 있어요.</p>
                        <div className={styles.benefits}>
                            <span>♡ 찜 동기화</span><span>↻ 최근 본 표</span><span>⌕ 검색 조건 저장</span>
                        </div>
                        {guestFavorites.length > 0 && (
                            <section className={styles.guestFavorites} aria-label="이 브라우저에 찜한 표">
                                <div className={styles.guestFavoritesHeader}>
                                    <strong>이전 버전에서 찜한 표</strong>
                                    <span>{guestFavorites.length}개 · 로그인하면 계정으로 옮겨요</span>
                                </div>
                                <div className={styles.guestFavoritesList}>
                                    {guestFavorites.map(snapshot => (
                                        <FlightRow
                                            key={snapshot.id}
                                            snapshot={snapshot}
                                            onClick={() => onOpenFlight(snapshot.id)}
                                            onRemove={() => onFavoriteRemoved(snapshot.id)}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}
                        {!requestId ? (
                            <form onSubmit={event => { event.preventDefault(); void sendCode(); }}>
                                <label className={styles.label} htmlFor="account-email">이메일</label>
                                <input
                                    ref={firstInputRef}
                                    id="account-email"
                                    type="email"
                                    inputMode="email"
                                    autoComplete="email"
                                    placeholder="name@example.com"
                                    value={loginEmail}
                                    onChange={event => setLoginEmail(event.target.value)}
                                    className={styles.input}
                                />
                                <button className={styles.primaryButton} type="submit" disabled={busy || !loginEmail.trim()}>
                                    {busy ? '보내는 중…' : '인증번호 받기'}
                                </button>
                            </form>
                        ) : (
                            <form onSubmit={event => { event.preventDefault(); void verify(); }}>
                                <p className={styles.sentTo}><strong>{loginEmail}</strong>로 6자리 번호를 보냈어요.</p>
                                <label className={styles.label} htmlFor="account-code">인증번호</label>
                                <input
                                    ref={firstInputRef}
                                    id="account-code"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    placeholder="000000"
                                    value={code}
                                    onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                                    className={`${styles.input} ${styles.codeInput}`}
                                />
                                <button className={styles.primaryButton} type="submit" disabled={busy || code.length !== 6}>
                                    {busy ? '확인 중…' : '로그인'}
                                </button>
                                <button type="button" className={styles.textButton} onClick={() => { setRequestId(''); setCode(''); setError(null); }}>
                                    이메일 다시 입력
                                </button>
                            </form>
                        )}
                        {error && <p className={styles.error}>{error}</p>}
                        <p className={styles.privacyNote}>비밀번호는 만들지 않아요. 로그인하면 <Link href="/terms">이용약관</Link>과 <Link href="/privacy">개인정보처리방침</Link>에 동의하는 것으로 봅니다.</p>
                    </div>
                )}

                {account.status === 'authenticated' && (
                    <div className={styles.accountBody}>
                        <div className={styles.profileRow}>
                            <div className={styles.avatar}>{account.email.slice(0, 1).toUpperCase()}</div>
                            <div className={styles.profileText}><strong>{account.email}</strong><span>30일 동안 로그인 상태가 유지돼요</span></div>
                            <button type="button" className={styles.logout} disabled={busy} onClick={() => void logout()}>로그아웃</button>
                        </div>

                        <div className={styles.summary}>
                            <button type="button" onClick={() => setTab('favorites')}><strong>{account.favoriteIds.length}</strong><span>찜한 표</span></button>
                            <button type="button" onClick={() => setTab('recent')}><strong>{account.recent.length}</strong><span>최근 본 표</span></button>
                            <button type="button" onClick={() => setTab('searches')}><strong>{account.savedSearches.length}</strong><span>다시 볼 조건</span></button>
                        </div>

                        <div className={styles.saveBox}>
                            <div><strong>특가 알림</strong><span>출발지 · 지역 · 예산</span></div>
                            <button type="button" className={styles.alertSetupButton} onClick={onOpenAlert}>알림 조건 만들기</button>
                            <small className={styles.saveHint}>여기서 만든 조건은 다음에도 다시 볼 수 있게 함께 저장해요.</small>
                        </div>

                        <nav className={styles.tabs} aria-label="내 여행 목록">
                            <button type="button" className={tab === 'favorites' ? styles.activeTab : ''} onClick={() => setTab('favorites')}>찜한 표</button>
                            <button type="button" className={tab === 'recent' ? styles.activeTab : ''} onClick={() => setTab('recent')}>최근 본 표</button>
                            <button type="button" className={tab === 'searches' ? styles.activeTab : ''} onClick={() => setTab('searches')}>다시 볼 조건</button>
                        </nav>

                        <div className={styles.list}>
                            {tab === 'favorites' && (account.favorites.length
                                ? account.favorites.map(item => <FlightRow
                                    key={item.flightId}
                                    snapshot={item.snapshot}
                                    savedPrice={item.savedPrice}
                                    availableNow={item.availableNow}
                                    onClick={() => onOpenFlight(item.flightId)}
                                    onRemove={() => onFavoriteRemoved(item.flightId)}
                                />)
                                : <p className={styles.empty}>마음에 드는 표의 ♡를 눌러 두세요.</p>)}
                            {tab === 'recent' && (account.recent.length ? <>
                                <div className={styles.listToolbar}><span>최근 30개까지 보여요</span><button type="button" disabled={busy} onClick={() => void clearRecent()}>기록 비우기</button></div>
                                {account.recent.map(item => <FlightRow key={item.flightId} snapshot={item.snapshot} availableNow={item.availableNow} onClick={() => onOpenFlight(item.flightId)} />)}
                            </> : <p className={styles.empty}>상세하게 본 항공권이 여기에 남아요.</p>)}
                            {tab === 'searches' && (account.savedSearches.length
                                ? account.savedSearches.map(item => (
                                    <div key={item.id} className={styles.searchRow}>
                                        <button type="button" onClick={() => { gtag.trackAccountAction('apply_search'); onApplySearch(item.filters); onClose(); }}>
                                            <strong>{item.name}</strong>
                                            <span>{savedSearchDateLabel(item.filters)} · 눌러서 다시 보기</span>
                                        </button>
                                        <button type="button" className={styles.deleteRow} disabled={busy} aria-label={`${item.name} 삭제`} onClick={() => void deleteSavedSearch(item.id)}>×</button>
                                    </div>
                                ))
                                : <p className={styles.empty}>특가 알림을 만들면 같은 조건을 여기서 다시 볼 수 있어요.</p>)}
                        </div>
                        {error && <p className={styles.error}>{error}</p>}
                        <div className={styles.accountFooter}>
                            <Link href="/privacy">개인정보처리방침</Link>
                            <button type="button" disabled={busy} onClick={() => void deleteAccount()}>계정 삭제</button>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
