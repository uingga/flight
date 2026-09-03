'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './AdminTodayPick.module.css';

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

export default function AdminTodayPick({ adminKey }: { adminKey: string }) {
    const [data, setData] = useState<TodayPickAdminData | null>(null);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [selectingId, setSelectingId] = useState<string | null>(null);

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

    const visibleCandidates = useMemo(() => {
        const query = search.trim().toLocaleLowerCase('ko-KR');
        const filtered = !query
            ? data?.candidates || []
            : (data?.candidates || []).filter(candidate => [
                candidate.departureCity,
                candidate.arrivalCity,
                candidate.id,
            ].some(value => value.toLocaleLowerCase('ko-KR').includes(query)));
        return filtered.slice(0, 30);
    }, [data?.candidates, search]);

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
        <section className={styles.section} id="overview-tikit-drop">
            <div className={styles.heading}>
                <div>
                    <span className={styles.eyebrow}>TIKIT DROP</span>
                    <h2>오늘의 표 직접 선정</h2>
                    <p>현재 판매 중인 항공권에서 골라 메인 첫 카드로 지정합니다.</p>
                </div>
                <button type="button" className={styles.refreshButton} onClick={load} disabled={loading}>
                    {loading ? '불러오는 중' : '새로고침'}
                </button>
            </div>

            {loading && !data ? (
                <div className={styles.empty}>현재 DROP과 후보를 불러오는 중입니다.</div>
            ) : error && !data ? (
                <div className={styles.error} role="alert">{error}</div>
            ) : data ? (
                <>
                    <div className={styles.currentCard}>
                        <span>현재 TIKIT DROP</span>
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
                            <p>오늘 선정된 표가 없습니다.</p>
                        )}
                    </div>

                    {!data.available && <div className={styles.error} role="alert">{data.message}</div>}
                    {message && <div className={styles.success} role="status">{message}</div>}
                    {error && <div className={styles.error} role="alert">{error}</div>}

                    <div className={styles.toolbar}>
                        <label htmlFor="today-pick-search">항공권 찾기</label>
                        <input
                            id="today-pick-search"
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            placeholder="도착지, 출발지 또는 항공권 ID"
                        />
                        <span>{search ? `${visibleCandidates.length}개 표시` : '추천순 상위 30개'}</span>
                    </div>

                    {visibleCandidates.length > 0 ? (
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
                                        disabled={!data.available || candidate.selected || Boolean(selectingId)}
                                    >
                                        {selectingId === candidate.id ? '저장 중' : candidate.selected ? '선정됨' : '선정'}
                                    </button>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.empty}>검색 조건에 맞는 항공권이 없습니다.</div>
                    )}
                    <p className={styles.note}>
                        선정하면 <code>today-pick.json</code>만 저장되고 자동 배포가 시작됩니다.
                        같은 날 자동 선정기는 직접 고른 표를 덮어쓰지 않습니다.
                    </p>
                </>
            ) : null}
        </section>
    );
}
