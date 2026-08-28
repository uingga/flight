'use client';

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { useDialogFocus } from './use-dialog-focus';

interface OverlayDialogOptions {
    open: boolean;
    active?: boolean;
    dialogRef: RefObject<HTMLElement>;
    onClose: () => void;
}

let bodyLockCount = 0;
let bodyOverflowBeforeLock = '';

function lockBodyScroll() {
    if (bodyLockCount === 0) {
        bodyOverflowBeforeLock = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    bodyLockCount += 1;

    return () => {
        bodyLockCount = Math.max(0, bodyLockCount - 1);
        if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeLock;
    };
}

/** 리디자인 오버레이가 공유하는 스크롤 잠금, ESC 닫기, 포커스 트랩. */
export function useOverlayDialog({
    open,
    active = true,
    dialogRef,
    onClose,
}: OverlayDialogOptions) {
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useDialogFocus(open, dialogRef, active);

    useEffect(() => {
        if (!open) return;
        return lockBodyScroll();
    }, [open]);

    useEffect(() => {
        if (!open || !active) return;
        const closeWithEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeRef.current();
        };
        document.addEventListener('keydown', closeWithEscape, true);
        return () => document.removeEventListener('keydown', closeWithEscape, true);
    }, [active, open]);
}
