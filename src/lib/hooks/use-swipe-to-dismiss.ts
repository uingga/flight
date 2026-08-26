'use client';

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

interface SwipeToDismissOptions {
    open: boolean;
    sheetRef: RefObject<HTMLElement | null>;
    onDismiss: () => void;
}

interface DragState {
    pointerId: number;
    startY: number;
    lastY: number;
    startedAt: number;
}

const CLOSE_DURATION_MS = 180;

/** 바텀시트 손잡이를 아래로 끌어 닫는 공통 동작. */
export function useSwipeToDismiss({ open, sheetRef, onDismiss }: SwipeToDismissOptions) {
    const dragRef = useRef<DragState | null>(null);
    const resetTimerRef = useRef<number | null>(null);
    const dismissRef = useRef(onDismiss);
    dismissRef.current = onDismiss;

    const clearResetTimer = useCallback(() => {
        if (resetTimerRef.current === null) return;
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
    }, []);

    const restoreSheet = useCallback((animate: boolean) => {
        const sheet = sheetRef.current;
        if (!sheet) return;
        clearResetTimer();
        sheet.style.transition = animate
            ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)'
            : 'none';
        sheet.style.transform = 'translate3d(0, 0, 0)';
        resetTimerRef.current = window.setTimeout(() => {
            const currentSheet = sheetRef.current;
            if (!currentSheet) return;
            currentSheet.style.transition = '';
            currentSheet.style.transform = '';
            currentSheet.style.animation = '';
            resetTimerRef.current = null;
        }, animate ? 230 : 0);
    }, [clearResetTimer, sheetRef]);

    useEffect(() => {
        if (open) restoreSheet(false);
        return () => {
            clearResetTimer();
            dragRef.current = null;
        };
    }, [clearResetTimer, open, restoreSheet]);

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (!open || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
        const sheet = sheetRef.current;
        if (!sheet) return;
        clearResetTimer();
        dragRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            lastY: event.clientY,
            startedAt: performance.now(),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        sheet.style.animation = 'none';
        sheet.style.transition = 'none';
    }, [clearResetTimer, open, sheetRef]);

    const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.lastY = event.clientY;
        const offset = Math.max(0, drag.lastY - drag.startY);
        const sheet = sheetRef.current;
        if (sheet) sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
        if (offset > 0) event.preventDefault();
    }, [sheetRef]);

    const finishDrag = useCallback((event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 이미 해제됨 */ }

        const sheet = sheetRef.current;
        if (!sheet) return;
        const distance = Math.max(0, drag.lastY - drag.startY);
        const elapsed = Math.max(1, performance.now() - drag.startedAt);
        const velocity = distance / elapsed;
        const threshold = Math.min(140, Math.max(84, sheet.clientHeight * 0.18));
        const shouldDismiss = !cancelled
            && (distance >= threshold || (distance >= 48 && velocity >= 0.65));

        if (!shouldDismiss) {
            restoreSheet(true);
            return;
        }

        clearResetTimer();
        sheet.style.transition = `transform ${CLOSE_DURATION_MS}ms ease-in`;
        sheet.style.transform = `translate3d(0, ${Math.max(sheet.clientHeight, window.innerHeight)}px, 0)`;
        resetTimerRef.current = window.setTimeout(() => {
            resetTimerRef.current = null;
            dismissRef.current();
        }, CLOSE_DURATION_MS - 10);
    }, [clearResetTimer, restoreSheet, sheetRef]);

    return {
        'data-swipe-handle': true,
        onPointerDown,
        onPointerMove,
        onPointerUp: (event: ReactPointerEvent<HTMLElement>) => finishDrag(event, false),
        onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => finishDrag(event, true),
    };
}
