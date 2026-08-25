'use client';

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogFocus(
    open: boolean,
    dialogRef: RefObject<HTMLElement | null>,
    active = true,
) {
    const activeRef = useRef(active);
    useEffect(() => { activeRef.current = active; }, [active]);

    useEffect(() => {
        if (!open || !dialogRef.current) return;
        const dialog = dialogRef.current;
        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
            .filter(element => element.offsetParent !== null && element.getAttribute('aria-hidden') !== 'true');
        const focusTimer = window.setTimeout(() => {
            if (!activeRef.current) return;
            const first = focusable()[0];
            if (first) first.focus();
            else {
                dialog.tabIndex = -1;
                dialog.focus();
            }
        }, 0);

        const trapFocus = (event: KeyboardEvent) => {
            if (event.key !== 'Tab' || !activeRef.current) return;
            const items = focusable();
            if (!items.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', trapFocus);
        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('keydown', trapFocus);
            if (previouslyFocused?.isConnected) previouslyFocused.focus();
        };
    }, [dialogRef, open]);
}
