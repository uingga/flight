'use client';

import { useCallback, useEffect, useState } from 'react';
import { type AnnouncementNotice, watchAnnouncement } from '../announcement-notice';

export function useAnnouncementNotice(notice: AnnouncementNotice, enabled = true) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!enabled) { setOpen(false); return; }
        return watchAnnouncement(notice, setOpen, window, document);
    }, [notice, enabled]);
    const close = useCallback(() => setOpen(false), []);
    const dismiss = useCallback(() => {
        setOpen(false);
        try { window.localStorage.setItem(notice.storageKey, 'dismissed'); } catch { }
    }, [notice.storageKey]);
    return { open, close, dismiss };
}
