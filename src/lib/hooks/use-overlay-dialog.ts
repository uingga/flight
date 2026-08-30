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

interface ScrollLockSnapshot {
    scrollX: number;
    scrollY: number;
    body: {
        position: string;
        top: string;
        left: string;
        right: string;
        width: string;
        overflow: string;
        overscrollBehavior: string;
        paddingRight: string;
    };
    root: {
        overflow: string;
        overscrollBehavior: string;
        scrollBehavior: string;
    };
}

let scrollLockSnapshot: ScrollLockSnapshot | null = null;

function lockBodyScroll() {
    if (bodyLockCount === 0) {
        const body = document.body;
        const root = document.documentElement;
        const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);

        scrollLockSnapshot = {
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            body: {
                position: body.style.position,
                top: body.style.top,
                left: body.style.left,
                right: body.style.right,
                width: body.style.width,
                overflow: body.style.overflow,
                overscrollBehavior: body.style.overscrollBehavior,
                paddingRight: body.style.paddingRight,
            },
            root: {
                overflow: root.style.overflow,
                overscrollBehavior: root.style.overscrollBehavior,
                scrollBehavior: root.style.scrollBehavior,
            },
        };

        root.style.overflow = 'hidden';
        root.style.overscrollBehavior = 'none';
        body.style.position = 'fixed';
        body.style.top = `-${scrollLockSnapshot.scrollY}px`;
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        body.style.overscrollBehavior = 'none';
        if (scrollbarWidth > 0) {
            const paddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
            body.style.paddingRight = `${paddingRight + scrollbarWidth}px`;
        }
    }
    bodyLockCount += 1;

    let released = false;
    return () => {
        if (released) return;
        released = true;
        bodyLockCount = Math.max(0, bodyLockCount - 1);
        if (bodyLockCount !== 0 || !scrollLockSnapshot) return;

        const body = document.body;
        const root = document.documentElement;
        const snapshot = scrollLockSnapshot;
        scrollLockSnapshot = null;

        body.style.position = snapshot.body.position;
        body.style.top = snapshot.body.top;
        body.style.left = snapshot.body.left;
        body.style.right = snapshot.body.right;
        body.style.width = snapshot.body.width;
        body.style.overflow = snapshot.body.overflow;
        body.style.overscrollBehavior = snapshot.body.overscrollBehavior;
        body.style.paddingRight = snapshot.body.paddingRight;
        root.style.overflow = snapshot.root.overflow;
        root.style.overscrollBehavior = snapshot.root.overscrollBehavior;

        root.style.scrollBehavior = 'auto';
        window.scrollTo(snapshot.scrollX, snapshot.scrollY);
        root.style.scrollBehavior = snapshot.root.scrollBehavior;
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
