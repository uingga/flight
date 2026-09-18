'use client';

import { useId, useRef } from 'react';
import OverlayDialog from './OverlayDialog';
import { useSwipeToDismiss } from '@/lib/hooks/use-swipe-to-dismiss';
import type { AnnouncementNotice } from '@/lib/announcement-notice';
// Reuse the exact production sheet styles; no separate visual variant.
import styles from '@/app/preview/mobile-redesign/page.module.css';

export default function AnnouncementDialog({ notice, open, active = true, onClose, onDismiss }: {
    notice: AnnouncementNotice;
    open: boolean;
    active?: boolean;
    onClose: () => void;
    onDismiss: () => void;
}) {
    const dialogRef = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const swipe = useSwipeToDismiss({ open, sheetRef: dialogRef, onDismiss: onClose });
    return <OverlayDialog open={open} active={active} dialogRef={dialogRef} onClose={onClose}
        overlayClassName={`${styles.sheetOverlay} ${styles.serviceUpdateOverlay}`}
        dialogClassName={`${styles.bottomSheet} ${styles.serviceUpdateSheet}`} ariaLabelledBy={titleId}>
        <div className={styles.sheetHandle} aria-hidden="true" {...swipe} />
        <p className={styles.serviceUpdateEyebrow}>{notice.eyebrow}</p>
        <div className={styles.serviceUpdateNotice}>
            <h2 id={titleId}>{notice.title}</h2>
            <p>{notice.body}</p>
        </div>
        <div className={styles.serviceUpdateActions}>
            <button type="button" className={styles.serviceUpdateClose} onClick={onClose}>{notice.closeLabel ?? '닫기'}</button>
            <button type="button" className={styles.serviceUpdateConfirm} onClick={onDismiss}>{notice.dismissLabel ?? '다시 보지 않기'}</button>
        </div>
    </OverlayDialog>;
}
