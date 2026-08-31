'use client';

import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useOverlayDialog } from '@/lib/hooks/use-overlay-dialog';
import styles from './OverlayDialog.module.css';

interface OverlayDialogProps {
    open: boolean;
    active?: boolean;
    modal?: boolean;
    dialogRef: RefObject<HTMLElement>;
    onClose: () => void;
    overlayClassName?: string;
    dialogClassName?: string;
    dialogStyle?: CSSProperties;
    ariaLabel?: string;
    ariaLabelledBy?: string;
    children: ReactNode;
}

export default function OverlayDialog({
    open,
    active = true,
    modal = true,
    dialogRef,
    onClose,
    overlayClassName = '',
    dialogClassName = '',
    dialogStyle,
    ariaLabel,
    ariaLabelledBy,
    children,
}: OverlayDialogProps) {
    useOverlayDialog({ open, active, modal, dialogRef, onClose });
    if (!open) return null;

    return (
        <div
            className={`${styles.backdrop} ${overlayClassName}`}
            role="presentation"
            onMouseDown={event => {
                if (modal && event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={dialogRef}
                className={`${styles.surface} ${dialogClassName}`}
                style={dialogStyle}
                role="dialog"
                aria-modal={active && modal ? true : undefined}
                aria-hidden={active ? undefined : true}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
            >
                {children}
            </section>
        </div>
    );
}
