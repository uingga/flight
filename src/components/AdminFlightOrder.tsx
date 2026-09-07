'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Flight } from '@/types/flight';
import { applyManualFlightOrder, emptyFlightOrder, moveFlightPlacement, type FlightPlacement, type ManualFlightOrder } from '@/lib/manual-flight-order';
import { getEffectivePrice } from '@/lib/price-quality';
import { buildNaverSearchUrl, getExactRouteAirports } from '@/lib/naver-route';
import styles from './AdminFlightOrder.module.css';

interface EditorData {
    flights: Flight[];
    order: ManualFlightOrder;
    todayPickId: string | null;
    lastUpdated: string | null;
    mode: 'preview' | 'supabase';
}
const agencies: Record<Flight['source'], string> = {
    ybtour: '노랑풍선', hanatour: '하나투어', modetour: '모두투어',
    onlinetour: '온라인투어', ttang: '땡처리닷컴', myrealtrip: '마이리얼트립',
};
const dateLabel = (value: string) => {
    const match = value.match(/^\d{4}[-.](\d{1,2})[-.](\d{1,2})/);
    return match ? `${Number(match[1])}.${Number(match[2])}` : value;
};
const samePlacements = (left: FlightPlacement[], right: FlightPlacement[]) =>
    JSON.stringify([...left].sort((a, b) => a.key.localeCompare(b.key))) === JSON.stringify([...right].sort((a, b) => a.key.localeCompare(b.key)));

export default function AdminFlightOrder({ adminKey }: { adminKey: string }) {
    const [data, setData] = useState<EditorData | null>(null);
    const [draft, setDraft] = useState<FlightPlacement[]>([]);
    const [search, setSearch] = useState('');
    const [limit, setLimit] = useState(40);
    const [preview, setPreview] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [dragKey, setDragKey] = useState<string | null>(null);
    const [dropKey, setDropKey] = useState<string | null>(null);
    const [desktop, setDesktop] = useState(false);
    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const response = await fetch('/api/admin-flight-order', { headers: { 'x-admin-key': adminKey }, cache: 'no-store' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || '목록을 불러오지 못했습니다.');
            setData(result);
            setDraft(result.order.placements);
            setPreview(false);
            setSearch('');
            setLimit(40);
        } catch (cause) { setError(cause instanceof Error ? cause.message : '목록을 불러오지 못했습니다.'); }
        finally { setLoading(false); }
    }, [adminKey]);
    useEffect(() => { if (adminKey) void load(); }, [adminKey, load]);
    useEffect(() => {
        const media = window.matchMedia('(hover: hover) and (pointer: fine)');
        const update = () => setDesktop(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    const saved = data?.order || emptyFlightOrder();
    const dirty = !samePlacements(draft, saved.placements);
    const pinned = data?.flights.find(flight => flight.id === data.todayPickId);
    const automatic = useMemo(() => (data?.flights || []).filter(flight => flight.id !== data?.todayPickId), [data]);
    const ordered = useMemo(() => applyManualFlightOrder(automatic, draft), [automatic, draft]);
    const keyCounts = useMemo(() => {
        const counts = new Map<string, number>();
        automatic.forEach(flight => { if (flight.manualOrderKey) counts.set(flight.manualOrderKey, (counts.get(flight.manualOrderKey) || 0) + 1); });
        return counts;
    }, [automatic]);
    const dormant = draft.filter(item => keyCounts.get(item.key) !== 1 && item.key !== pinned?.manualOrderKey);
    const visible = ordered.map((flight, index) => ({ flight, index })).filter(({ flight }) => {
        const query = search.trim().toLowerCase();
        return !query || [flight.departure.city, flight.arrival.city, flight.airline, agencies[flight.source], flight.departure.date, flight.arrival.date]
            .some(value => value.toLowerCase().includes(query));
    });
    const editingDisabled = loading || saving || preview;
    function move(key: string, index: number) {
        if (editingDisabled) return;
        try {
            setDraft(moveFlightPlacement(automatic, draft, key, index));
            setError('');
            setMessage('편집 중입니다. 미리보기에서 확인한 뒤 적용해 주세요.');
        } catch (cause) { setError(cause instanceof Error ? cause.message : '배치를 변경하지 못했습니다.'); }
    }
    async function apply() {
        if (!preview || !dirty || saving) return;
        setSaving(true);
        setError('');
        try {
            const response = await fetch('/api/admin-flight-order', {
                method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
                body: JSON.stringify({ revision: saved.revision, placements: draft }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || '저장하지 못했습니다.');
            setData(current => current ? { ...current, order: result.order } : current);
            setMessage(data?.mode === 'preview' ? '격리된 미리보기에 적용했습니다. 운영 순서는 바뀌지 않습니다.' : '추천순에 적용했습니다. 새로 여는 목록부터 반영됩니다.');
            await load();
        } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.'); }
        finally { setSaving(false); }
    }
    function card(flight: Flight, index: number, isDrop = false) {
        const key = flight.manualOrderKey || '';
        const manual = draft.some(item => item.key === key);
        const movable = !isDrop && keyCounts.get(key) === 1;
        const exactRoute = getExactRouteAirports(flight);
        const naverUrl = exactRoute ? buildNaverSearchUrl(exactRoute, flight.departure.date, flight.arrival.date) : null;
        return (
            <article key={flight.id} data-order-card={flight.id} data-order-key={key} data-position={isDrop ? 'drop' : index + 1}
                className={`${styles.card} ${manual ? styles.manual : ''} ${isDrop ? styles.dropCard : ''} ${dropKey === key ? styles.dropTarget : ''}`}
                draggable={desktop && movable && !editingDisabled}
                onDragStart={event => {
                    if (!movable || editingDisabled) return event.preventDefault();
                    event.dataTransfer.setData('text/plain', key);
                    event.dataTransfer.effectAllowed = 'move';
                    setDragKey(key);
                }}
                onDragOver={event => {
                    if (!isDrop && dragKey && !editingDisabled) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropKey(key); }
                }}
                onDrop={event => {
                    event.preventDefault();
                    if (!isDrop && dragKey && event.dataTransfer.getData('text/plain') === dragKey) move(dragKey, index);
                    setDragKey(null); setDropKey(null);
                }}
                onDragEnd={() => { setDragKey(null); setDropKey(null); }}
            >
                <div className={styles.rank}><span>{isDrop ? 'DROP' : index + 1}</span>{desktop && movable && !preview && <small aria-hidden="true">⠿</small>}</div>
                <div className={styles.cardContent}>
                    <div className={styles.route}>
                        <h3>{flight.departure.city} <span aria-hidden="true">→</span> {flight.arrival.city}</h3>
                        {(isDrop || manual) && <span className={styles.badge}>{isDrop ? '기존 고정 유지' : '직접 배치'}</span>}
                    </div>
                    <div className={styles.schedule}>
                        <span>{dateLabel(flight.departure.date)} — {dateLabel(flight.arrival.date)} <small>왕복</small></span>
                        <small>가는 {flight.departure.time || '미확인'} · 오는 {flight.arrival.time || '미확인'}</small>
                    </div>
                    <div className={styles.agency}><span>{agencies[flight.source]}</span><small>{flight.airline}</small></div>
                    <div className={styles.price}><strong>{getEffectivePrice(flight).toLocaleString('ko-KR')}원</strong><small>{flight.seats || (flight.availableSeats ? `잔여 ${flight.availableSeats}석` : '좌석 확인 필요')}</small></div>
                    <div className={styles.comparison}>
                        {Number.isFinite(flight.naverLowest) && flight.naverLowest! > 0
                            ? <strong className={styles.naverPrice} title={`저장된 네이버 최저가${flight.naverCheckedAt ? ` · ${new Date(flight.naverCheckedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 확인` : ''}`}>
                                {flight.naverLowest!.toLocaleString('ko-KR')}원
                            </strong>
                            : <span className={styles.naverMissing}>가격 미확인</span>}
                        {naverUrl ? <a href={naverUrl} target="_blank" rel="noopener noreferrer" draggable={false}
                            aria-label={`${flight.departure.city} → ${flight.arrival.city} ${dateLabel(flight.departure.date)}~${dateLabel(flight.arrival.date)} 네이버 비교 (새 탭)`}
                            onDragStart={event => event.stopPropagation()}>
                            네이버 비교 <span aria-hidden="true">↗</span>
                        </a> : <span title="정확한 왕복 공항을 확인하지 못해 비교 링크를 제공하지 않습니다.">공항 확인 필요</span>}
                    </div>
                    {!isDrop && !preview && <div className={styles.moves}>
                        <button type="button" disabled={editingDisabled || !movable || index === 0} onClick={() => move(key, 0)} aria-label={`${flight.arrival.city} 맨 위로`}>맨 위로</button>
                        <button type="button" disabled={editingDisabled || !movable || index === 0} onClick={() => move(key, index - 1)} aria-label={`${flight.arrival.city} 위로`}>위로 ↑</button>
                        <button type="button" disabled={editingDisabled || !movable || index === ordered.length - 1} onClick={() => move(key, index + 1)} aria-label={`${flight.arrival.city} 아래로`}>아래로 ↓</button>
                        {manual && <button type="button" className={styles.release} disabled={editingDisabled} onClick={() => { setDraft(current => current.filter(item => item.key !== key)); setMessage('자동 배치로 돌렸습니다. 확인 후 적용해 주세요.'); }}>자동 배치</button>}
                        {!movable && <small>같은 상품 식별이 겹쳐 직접 이동할 수 없습니다.</small>}
                    </div>}
                </div>
            </article>
        );
    }
    return (
        <section className={styles.editor} aria-label="항공권 노출 순서 편집">
            <header className={styles.heading}>
                <h2>노출 순서 관리</h2>
                <span className={styles.count}>직접 배치 {draft.length}/30</span>
            </header>
            {data?.mode === 'preview' && <p className={styles.isolation}>격리 미리보기 · 여기서 적용하거나 복원해도 운영 사이트는 바뀌지 않습니다.</p>}
            <div className={styles.explanation}>
                <p>TIKIT DROP 다음부터 적용돼요. 가격·좌석은 최신값이며 가격순·출발일순은 그대로예요.</p>
                <details><summary>배치 기준 자세히 보기</summary><p>아래 번호는 DROP을 제외한 일반 항공권 순서입니다. 판매 종료·노출 제외·검색 조건에 맞지 않는 표는 표시하지 않고 빈자리는 자동 추천으로 채워요. 결과가 적으면 직접 배치한 표는 가능한 마지막 위치까지 앞당겨집니다.</p></details>
            </div>
            {error && <p role="alert" className={styles.error}>{error}</p>}
            {message && <p role="status" className={styles.message}>{message}</p>}
            <div className={styles.toolbar}>
                <label>항공권 찾기<input value={search} disabled={loading || saving || preview} onChange={event => { setSearch(event.target.value); setLimit(40); }} placeholder="도시, 여행사, 항공사, 날짜" /></label>
                <button type="button" disabled={loading || saving} onClick={() => { setMessage(''); void load(); }}>{dirty ? '편집 취소·새로고침' : '최신 목록 불러오기'}</button>
                <button type="button" disabled={loading || saving || (!draft.length && !saved.placements.length)} onClick={() => { setDraft([]); setPreview(true); setSearch(''); setMessage('자동 추천순 미리보기입니다. 적용을 누르면 직접 배치가 모두 해제됩니다.'); }}>자동 추천순으로 복원</button>
            </div>
            {dormant.length > 0 && <p className={styles.hint}>현재 목록에 없거나 식별이 겹치는 배치 {dormant.length}개는 표시하지 않고 설정만 보관합니다. 정상 목록에 같은 상품·일정이 돌아오면 다시 적용됩니다.</p>}
            <footer className={styles.actions}>
                <span>{dirty ? '아직 적용 전입니다' : '저장된 순서와 같습니다'}{data?.lastUpdated && <small>항공권 갱신 {new Date(data.lastUpdated).toLocaleString('ko-KR')}</small>}</span>
                {preview
                    ? <button type="button" disabled={saving} onClick={() => setPreview(false)}>편집으로 돌아가기</button>
                    : <button type="button" disabled={loading || saving || !data} onClick={() => { setPreview(true); setSearch(''); setLimit(40); }}>미리보기</button>}
                <button type="button" className={styles.primary} disabled={!preview || !dirty || loading || saving} onClick={() => void apply()}>{saving ? '적용 중…' : '적용'}</button>
            </footer>
            {loading && <p className={styles.loading}>최신 항공권과 저장된 순서를 불러오는 중…</p>}
            {data && !loading && <>
                <div className={styles.listHeading}><strong>{preview ? '적용 전 미리보기' : '항공권 순서 편집'}</strong><span>{preview ? '현재 최신 목록 기준' : desktop ? '카드를 끌거나 이동 버튼을 사용하세요' : '이동 버튼으로 순서를 바꾸세요'}</span></div>
                <div className={styles.list}>
                    {pinned && !search.trim() && card(pinned, -1, true)}
                    {visible.slice(0, limit).map(({ flight, index }) => card(flight, index))}
                </div>
                {visible.length === 0 && <p className={styles.loading}>조건에 맞는 항공권이 없습니다.</p>}
                {visible.length > limit && <button type="button" className={styles.more} onClick={() => setLimit(current => current + 40)}>항공권 더 보기 ({Math.min(limit, visible.length)}/{visible.length})</button>}
            </>}

        </section>
    );
}
