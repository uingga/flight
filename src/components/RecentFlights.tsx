'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Flight } from '@/types/flight';
import { findRecentFlight, recentFlightKey, type RecentFlight } from '@/lib/recent-flights';
import { dismissOverlayWithHistory, historyOverlay, showOverlayWithHistory } from '@/lib/ui/overlay-history';
import OverlayDialog from '@/components/ui/OverlayDialog';
import styles from './RecentFlights.module.css';

const SOURCE_NAMES: Record<Flight['source'], string> = {
    ybtour: '노랑풍선', hanatour: '하나투어', modetour: '모두투어',
    onlinetour: '온라인투어', ttang: '땡처리닷컴', myrealtrip: '마이리얼트립',
};
const shortDate = (date: string) => date.slice(5).replace('-', '.');

export default function RecentFlights({ records, flights, loading, storageUnavailable, onClear, onRemove, onOpen, open, onOpenChange }: {
    records: RecentFlight[]; flights: Flight[]; loading: boolean; storageUnavailable: boolean;
    onRemove: (key: string) => void;
    onClear: () => void; onOpen: (flight: Flight) => void;
    onOpenChange: (open: boolean) => void;
    open: boolean;
}) {
    const dialogRef = useRef<HTMLElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const portalRoot = useRef<Element | null>(null);
    const [revealedKey, setRevealedKey] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState<number | null>(null);
    const gesture = useRef<{ key: string; x: number; y: number; start: number; offset: number; axis: 'pending' | 'x' | 'y' } | null>(null);
    const suppressClick = useRef(false);
    useEffect(() => { if (!open) { setRevealedKey(null); setDragOffset(null); gesture.current = null; } }, [open]);
    const close = () => dismissOverlayWithHistory('recent-flights', () => onOpenChange(false));
    useEffect(() => {
        const sync = () => onOpenChange(historyOverlay() === 'recent-flights');
        window.addEventListener('popstate', sync);
        return () => window.removeEventListener('popstate', sync);
    }, [onOpenChange]);
    return <>
        {records.length > 0 && <button ref={triggerRef} type="button" className={styles.trigger} aria-haspopup="dialog"
            onClick={() => {
                portalRoot.current = triggerRef.current?.closest('[data-keyboard-navigation]') || document.body;
                showOverlayWithHistory('recent-flights', () => onOpenChange(true));
            }}>
            최근 본 표 <span>{records.length}</span>
        </button>}
        {open && createPortal(<OverlayDialog open active dialogRef={dialogRef} onClose={close}
            ariaLabel="최근 본 표" overlayClassName={styles.overlay} dialogClassName={styles.sheet}>
            <div className={styles.heading}><div><h2>최근 본 표</h2><p>보던 일정부터 이어서 둘러보세요.</p></div>
                <button type="button" onClick={close} className={styles.close} aria-label="최근 본 표 닫기">×</button></div>
            <div className={styles.meta}><span>이 브라우저 · 최근 10개 · 30일 보관</span>
                {records.length > 0 && <button type="button" onClick={onClear}>기록 비우기</button>}</div>
            {records.length > 0 && <p className={styles.swipeHint}>표를 왼쪽으로 밀면 삭제할 수 있어요.</p>}
            {storageUnavailable && <p className={styles.note} role="status">브라우저 저장 공간을 사용할 수 없어 이번 화면에서만 기록해요.</p>}
            {records.length === 0 ? <div className={styles.empty}><h3>아직 본 표가 없어요</h3><p>관심 가는 항공권을 열어보면 여기에 모아둘게요.</p>
                <button type="button" onClick={close}>항공권 둘러보기</button></div>
                : <div className={styles.list}>{records.map(record => {
                    const current = findRecentFlight(record, flights);
                    const display = current || record.flight;
                    const key = recentFlightKey(record.flight);
                    const revealed = revealedKey === key;
                    const offset = gesture.current?.key === key && dragOffset !== null ? dragOffset : revealed ? -80 : 0;
                    return <div className={styles.card} key={key} data-recent-card data-revealed={revealed}
                        style={{ '--swipe-offset': offset + 'px' } as CSSProperties}>
                        <div className={styles.cardContent} data-recent-swipe
                            onPointerDown={event => {
                                if (event.pointerType === 'mouse' || !event.isPrimary || !window.matchMedia('(max-width: 600px)').matches) return;
                                suppressClick.current = false;
                                gesture.current = { key, x: event.clientX, y: event.clientY, start: revealed ? -80 : 0, offset: revealed ? -80 : 0, axis: 'pending' };
                            }}
                            onPointerMove={event => {
                                const g = gesture.current;
                                if (!g || g.key !== key) return;
                                const dx = event.clientX - g.x, dy = event.clientY - g.y;
                                if (g.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
                                    g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
                                    if (g.axis === 'x') event.currentTarget.setPointerCapture(event.pointerId);
                                }
                                if (g.axis !== 'x') return;
                                suppressClick.current = true;
                                g.offset = Math.max(-80, Math.min(0, g.start + dx));
                                setRevealedKey(key); setDragOffset(g.offset);
                            }}
                            onPointerUp={() => {
                                const g = gesture.current;
                                if (!g || g.key !== key) return;
                                if (g.axis === 'x') setRevealedKey(g.offset <= -40 ? key : null);
                                gesture.current = null; setDragOffset(null);
                            }}
                            onPointerCancel={() => { gesture.current = null; setDragOffset(null); setRevealedKey(null); }}
                            onClickCapture={event => {
                                if (suppressClick.current || (revealed && window.matchMedia('(max-width: 600px)').matches)) {
                                    event.preventDefault(); event.stopPropagation();
                                    if (!suppressClick.current) setRevealedKey(null);
                                    suppressClick.current = false;
                                }
                            }}>

                        <button type="button" className={styles.openCard} disabled={!current} onClick={() => {
                            if (current) { onOpenChange(false); onOpen(current); }
                        }}>
                            <strong className={styles.route}>{display.departure.city} → {display.arrival.city}</strong>
                            <span className={styles.schedule}>{shortDate(display.departure.date)} — {shortDate(display.arrival.date)} · {SOURCE_NAMES[display.source]} · {display.airline}</span>
                            <strong className={styles.price}>{display.price.toLocaleString('ko-KR')}원</strong>
                            <span className={styles.status}>{current ? '현재 목록의 가격 · 상세 보기 ↗' : loading ? '현재 목록 확인 중 · 마지막으로 본 정보' : '현재 목록에서 내려간 표 · 마지막으로 본 정보'}</span>
                        </button>
                        {!current && !loading && <p className={styles.unavailable}>판매 종료 여부는 단정할 수 없어요.</p>}
                        </div>
                        <button type="button" className={styles.remove} data-remove-recent
                            aria-label={display.departure.city + ' → ' + display.arrival.city + ' ' + shortDate(display.departure.date) + ' 기록 삭제'}
                            onFocus={() => { if (window.matchMedia('(max-width: 600px)').matches) setRevealedKey(key); }}
                            onClick={event => {
                                setRevealedKey(null);
                                const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('[data-remove-recent]') || []);
                                const index = buttons.indexOf(event.currentTarget);
                                onRemove(recentFlightKey(record.flight));
                                requestAnimationFrame(() => {
                                    const remaining = dialogRef.current?.querySelectorAll<HTMLButtonElement>('[data-remove-recent]');
                                    const target = remaining?.[index] || remaining?.[index - 1]
                                        || dialogRef.current?.querySelector<HTMLButtonElement>('button');
                                    target?.focus();
                                });
                            }}><span className={styles.removeDesktop}>×</span><span className={styles.removeMobile}>삭제</span></button>
                    </div>;
                })}</div>}
        </OverlayDialog>, portalRoot.current || document.body)}
    </>;
}
