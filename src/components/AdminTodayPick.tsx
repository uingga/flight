'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import OverlayDialog from '@/components/ui/OverlayDialog';
import { dismissOverlayWithHistory, historyOverlay, showOverlayWithHistory } from '@/lib/ui/overlay-history';
import styles from './AdminTodayPick.module.css';
import type { TodayPickRecord } from '@/lib/manual-today-pick';

interface TodayPickCandidate {
    id: string;
    rank: number;
    departureCity: string;
    arrivalCity: string;
    departureDate: string;
    returnDate: string;
    effectivePrice: number;
    naverLowest: number | null;
    naverDifference: number | null;
    recommendationTier: number;
    selected: boolean;
}

interface CurrentTodayPick {
    id: string;
    departureCity: string;
    arrivalCity: string;
    departureDate: string;
    returnDate: string;
    effectivePrice: number;
    selectedAt: string | null;
    selectionMode: string | null;
}

interface TodayPickAdminData {
    available: boolean;
    message: string | null;
    current: CurrentTodayPick | null;
    candidates: TodayPickCandidate[];
    history?: TodayPickRecord[];
}

const TIER_LABELS: Record<number, string> = {
    0: '아주 좋음',
    1: '좋음',
    2: '무난',
    3: '비교 부족',
    4: '비쌈',
};

function formatPrice(value: number): string {
    return `${value.toLocaleString('ko-KR')}원`;
}

function shortDate(value: string): string {
    const match = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return match ? `${Number(match[1])}.${Number(match[2])}` : value;
}

function naverComparisonLabel(candidate: TodayPickCandidate): string {
    if (candidate.naverDifference === null || candidate.naverLowest === null) return '네이버 비교가 없음';
    if (candidate.naverDifference === 0) return '네이버 최저가와 같음';
    const difference = formatPrice(Math.abs(candidate.naverDifference));
    return candidate.naverDifference < 0
        ? `네이버보다 ${difference} 저렴`
        : `네이버보다 ${difference} 비쌈`;
}

export default function AdminTodayPick({ adminKey, readOnly = false, onManage }: {
    adminKey: string;
    readOnly?: boolean;
    onManage?: () => void;
}) {
    const [data, setData] = useState<TodayPickAdminData | null>(null);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [selectingId, setSelectingId] = useState<string | null>(null);
    const [panelOpen, setPanelOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [historyPage, setHistoryPage] = useState(1);
    const dialogRef = useRef<HTMLElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (readOnly) return;
        const syncPanel = () => setPanelOpen(historyOverlay() === 'admin-today-pick');
        window.addEventListener('popstate', syncPanel);
        return () => window.removeEventListener('popstate', syncPanel);
    }, [readOnly]);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/admin-today-pick?key=${encodeURIComponent(adminKey)}`, {
                cache: 'no-store',
            });
            const json = await response.json();
            if (!response.ok) throw new Error(json.error || 'TIKIT DROP 후보를 불러오지 못했습니다.');
            setData(json);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'TIKIT DROP 후보를 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (adminKey) load();
        // 어드민 키가 바뀌면 새 권한으로 다시 불러온다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [adminKey]);

    const filteredCandidates = useMemo(() => {
        const query = search.trim().toLocaleLowerCase('ko-KR');
        const filtered = !query
            ? data?.candidates || []
            : (data?.candidates || []).filter(candidate => [
                candidate.departureCity,
                candidate.arrivalCity,
                candidate.id,
            ].some(value => value.toLocaleLowerCase('ko-KR').includes(query)));
        return filtered;
    }, [data?.candidates, search]);

    const pageCount = Math.max(1, Math.ceil(filteredCandidates.length / 10));
    const currentPage = Math.min(page, pageCount);
    const visibleCandidates = filteredCandidates.slice((currentPage - 1) * 10, currentPage * 10);

    function openPanel() {
        setSearch('');
        setPage(1);
        showOverlayWithHistory('admin-today-pick', () => setPanelOpen(true));
    }

    function closePanel() {
        dismissOverlayWithHistory('admin-today-pick', () => setPanelOpen(false));
    }

    function changePage(nextPage: number) {
        setPage(nextPage);
        listRef.current?.scrollTo({ top: 0 });
    }

    async function selectCandidate(candidate: TodayPickCandidate) {
        const confirmed = window.confirm([
            `${candidate.departureCity} → ${candidate.arrivalCity}`,
            `${shortDate(candidate.departureDate)}–${shortDate(candidate.returnDate)} · ${formatPrice(candidate.effectivePrice)}`,
            '',
            '이 항공권을 오늘의 TIKIT DROP으로 선정할까요?',
        ].join('\n'));
        if (!confirmed) return;

        setSelectingId(candidate.id);
        setMessage(null);
        setError(null);
        try {
            const response = await fetch('/api/admin-today-pick', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: adminKey, flightId: candidate.id }),
            });
            const json = await response.json();
            if (!response.ok) throw new Error(json.error || 'TIKIT DROP 선정을 저장하지 못했습니다.');
            setData(current => current ? {
                ...current,
                current: json.current,
                candidates: current.candidates.map(item => ({
                    ...item,
                    selected: item.id === candidate.id,
                })),
            } : current);
            setMessage(json.message);
        } catch (selectionError) {
            setError(selectionError instanceof Error ? selectionError.message : 'TIKIT DROP 선정을 저장하지 못했습니다.');
        } finally {
            setSelectingId(null);
        }
    }

    return (
        <section className={styles.section} id={readOnly ? 'overview-tikit-drop' : 'flight-order-tikit-drop'}>
            <div className={styles.heading}>
                <div>
                    <span className={styles.eyebrow}>TIKIT DROP</span>
                    <h2>{readOnly ? '오늘 선정한 항공권' : '오늘의 표 선정'}</h2>
                </div>
                {readOnly ? (
                    <button type="button" className={styles.refreshButton} onClick={onManage}>노출순서에서 관리</button>
                ) : <button type="button" className={styles.refreshButton} onClick={openPanel} aria-haspopup="dialog">
                    선정·변경
                </button>}
            </div>
            {loading && !data ? <p className={styles.empty} role="status">선정 상태를 불러오는 중입니다.</p>
                : !data ? <div className={styles.error} role="alert">{error || '선정 상태를 확인하지 못했습니다.'}</div>
                    : <>
                    <div className={styles.currentCard}>
                        {data.current ? (
                            <div>
                                <strong>{data.current.departureCity} → {data.current.arrivalCity}</strong>
                                <b>{formatPrice(data.current.effectivePrice)}</b>
                                <small>
                                    {shortDate(data.current.departureDate)}–{shortDate(data.current.returnDate)}
                                    {' · '}{data.current.selectionMode === 'manual' ? '직접 선정' : '자동 선정'}
                                </small>
                            </div>
                        ) : (
                            <p>오늘 선정된 항공권이 없습니다.</p>
                        )}
                    </div>
                    <details className={styles.history}>
                        <summary>지난 선정 내역 <span>{data.history?.length || 0}건</span></summary>
                        <p className={styles.note}>최신 선정일부터 표시합니다. 가격은 선정 당시 기록이며 현재 판매가와 다를 수 있습니다. 같은 날 변경한 표도 포함합니다.</p>
                        {(data.history?.length || 0) > 0 ? <>
                            <div className={styles.historyList}>
                                {data.history!.slice((historyPage - 1) * 10, historyPage * 10).map(pick => (
                                    <article key={`${pick.date}|${pick.flightId}|${pick.effectivePrice}`}>
                                        <time dateTime={pick.date}>{pick.date}</time>
                                        <div><strong>{pick.arrivalCity || pick.destinationKey || '도착지 기록 없음'}</strong>
                                            <small>{({ttang: '땡처리닷컴', modetour: '모두투어', ybtour: '노랑풍선', hanatour: '하나투어', onlinetour: '온라인투어', myrealtrip: '마이리얼트립'} as Record<string, string>)[pick.source || ''] || pick.source || '여행사 기록 없음'}</small>
                                        </div>
                                        <b>{formatPrice(pick.effectivePrice)}</b>
                                    </article>
                                ))}
                            </div>
                            {data.history!.length > 10 && <nav className={styles.pagination} aria-label="선정 내역 페이지">
                                <button type="button" className={styles.refreshButton} disabled={historyPage === 1} onClick={() => setHistoryPage(historyPage - 1)}>이전</button>
                                <span>{historyPage} / {Math.ceil(data.history!.length / 10)}</span>
                                <button type="button" className={styles.refreshButton} disabled={historyPage * 10 >= data.history!.length} onClick={() => setHistoryPage(historyPage + 1)}>다음</button>
                            </nav>}
                        </> : <p className={styles.empty}>저장된 선정 내역이 없습니다.</p>}
                    </details>
                    {!data.available && <div className={styles.error} role="alert">{data.message}</div>}
                    {!panelOpen && message && <div className={styles.success} role="status">{message}</div>}
                    {!panelOpen && error && <div className={styles.error} role="alert">{error}</div>}
                    </>}
            {!readOnly && <OverlayDialog
                open={panelOpen}
                dialogRef={dialogRef}
                onClose={closePanel}
                ariaLabelledBy="today-pick-panel-title"
                overlayClassName={styles.overlay}
                dialogClassName={styles.panel}
            >
                <header className={styles.panelHeading}>
                    <div><h2 id="today-pick-panel-title">TIKIT DROP 선정·변경</h2><p>현재 판매 중인 항공권에서 선정합니다.</p></div>
                    <button type="button" className={styles.refreshButton} onClick={closePanel} aria-label="선정 패널 닫기">닫기</button>
                </header>
                <div className={styles.panelBody} ref={listRef}>
                    {message && <div className={styles.success} role="status">{message}</div>}
                    {error && <div className={styles.error} role="alert">{error}</div>}
                    {data && !data.available && <div className={styles.error} role="alert">{data.message}</div>}
                    <button type="button" className={styles.refreshButton} onClick={load} disabled={loading || Boolean(selectingId)}>
                        {loading ? '불러오는 중' : '새로고침'}
                    </button>
                    <div className={styles.toolbar}>
                        <label htmlFor="today-pick-search">항공권 찾기</label>
                        <input
                            id="today-pick-search"
                            value={search}
                            onChange={event => { setSearch(event.target.value); setPage(1); }}
                            placeholder="도착지, 출발지 또는 항공권 ID"
                        />
                        <span role="status">{filteredCandidates.length}개{search ? ' 검색됨' : ' · 추천순'}</span>
                    </div>
                    {loading && !data ? <div className={styles.empty} role="status">후보를 불러오는 중입니다.</div>
                        : !data ? null : visibleCandidates.length > 0 ? (
                        <div className={styles.candidateList}>
                            {visibleCandidates.map(candidate => (
                                <article key={candidate.id} className={candidate.selected ? styles.selectedCandidate : undefined}>
                                    <div className={styles.rank}>추천 {candidate.rank}위</div>
                                    <div className={styles.route}>
                                        <strong>{candidate.departureCity} → {candidate.arrivalCity}</strong>
                                        <span>{shortDate(candidate.departureDate)}–{shortDate(candidate.returnDate)}</span>
                                        <small>{naverComparisonLabel(candidate)}</small>
                                    </div>
                                    <div className={styles.price}>
                                        <strong>{formatPrice(candidate.effectivePrice)}</strong>
                                        <span className={`${styles.tier} ${styles[`tier${candidate.recommendationTier}`] || ''}`}>
                                            {TIER_LABELS[candidate.recommendationTier] || '확인 필요'}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => selectCandidate(candidate)}
                                        disabled={loading || !data.available || candidate.selected || Boolean(selectingId)}
                                    >
                                        {selectingId === candidate.id ? '저장 중' : candidate.selected ? '선정됨' : '선정'}
                                    </button>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.empty} role="status">{search ? '검색 조건에 맞는 항공권이 없습니다.' : '현재 선정 가능한 항공권이 없습니다.'}</div>
                    )}
                    <p className={styles.note}>
                        선정하면 메인에 반영되기까지 배포 시간이 걸립니다.
                        같은 날 자동 선정은 직접 고른 항공권을 덮어쓰지 않습니다.
                    </p>
                </div>
                <nav className={styles.pagination} aria-label="후보 페이지">
                    <button type="button" className={styles.refreshButton} disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>이전</button>
                    <span role="status">{currentPage} / {pageCount} 페이지</span>
                    <button type="button" className={styles.refreshButton} disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>다음</button>
                </nav>
            </OverlayDialog>}
        </section>
    );
}
