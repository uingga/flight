'use client';

import { useEffect, useRef } from 'react';
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

export default function RecentFlights({ records, flights, loading, storageUnavailable, onClear, onOpen, open, onOpenChange }: {
    records: RecentFlight[]; flights: Flight[]; loading: boolean; storageUnavailable: boolean;
    onClear: () => void; onOpen: (flight: Flight) => void;
    onOpenChange: (open: boolean) => void;
    open: boolean;
}) {
    const dialogRef = useRef<HTMLElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const portalRoot = useRef<Element | null>(null);
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
            {storageUnavailable && <p className={styles.note} role="status">브라우저 저장 공간을 사용할 수 없어 이번 화면에서만 기록해요.</p>}
            {records.length === 0 ? <div className={styles.empty}><h3>아직 본 표가 없어요</h3><p>관심 가는 항공권을 열어보면 여기에 모아둘게요.</p>
                <button type="button" onClick={close}>항공권 둘러보기</button></div>
                : <div className={styles.list}>{records.map(record => {
                    const current = findRecentFlight(record, flights);
                    const display = current || record.flight;
                    return <div className={styles.card} key={recentFlightKey(record.flight)}>
                        <button type="button" disabled={!current} onClick={() => {
                            if (current) { onOpenChange(false); onOpen(current); }
                        }}>
                            <strong className={styles.route}>{display.departure.city} → {display.arrival.city}</strong>
                            <span className={styles.schedule}>{shortDate(display.departure.date)} — {shortDate(display.arrival.date)} · {SOURCE_NAMES[display.source]} · {display.airline}</span>
                            <strong className={styles.price}>{display.price.toLocaleString('ko-KR')}원</strong>
                            <span className={styles.status}>{current ? '현재 목록의 가격 · 상세 보기 ↗' : loading ? '현재 목록 확인 중 · 마지막으로 본 정보' : '현재 목록에서 내려간 표 · 마지막으로 본 정보'}</span>
                        </button>
                        {!current && !loading && <p className={styles.unavailable}>판매 종료 여부는 단정할 수 없어요.</p>}
                    </div>;
                })}</div>}
        </OverlayDialog>, portalRoot.current || document.body)}
    </>;
}
