export interface AnnouncementNotice {
    id: string;
    storageKey: string;
    /** null keeps an undated notice active until explicitly withdrawn. */
    endsAt: number | null;
    eyebrow: string;
    title: string;
    body: string;
    closeLabel?: string;
    dismissLabel?: string;
}

export function isAnnouncementActive(notice: Pick<AnnouncementNotice, 'endsAt'>, now = Date.now()) {
    return Number.isFinite(now) && (notice.endsAt === null || (Number.isFinite(notice.endsAt) && now < notice.endsAt));
}

/** Browser dependencies are injectable so expiry and storage failure can be tested without a live clock. */
export function watchAnnouncement(notice: AnnouncementNotice, setOpen: (open: boolean) => void,
    browser: Pick<Window, 'localStorage' | 'setTimeout' | 'clearTimeout'>,
    visibility: Pick<Document, 'addEventListener' | 'removeEventListener'>,
    now = Date.now) {
    setOpen(false);
    if (!isAnnouncementActive(notice, now())) return () => {};
    try { setOpen(browser.localStorage.getItem(notice.storageKey) !== 'dismissed'); }
    catch { setOpen(true); }
    const endsAt = notice.endsAt;
    if (endsAt === null) return () => {};
    let timer = 0;
    const checkExpiry = () => {
        browser.clearTimeout(timer);
        if (!isAnnouncementActive(notice, now())) { setOpen(false); return; }
        timer = browser.setTimeout(checkExpiry, Math.min(endsAt - now(), 86400000));
    };
    checkExpiry();
    visibility.addEventListener('visibilitychange', checkExpiry);
    return () => {
        browser.clearTimeout(timer);
        visibility.removeEventListener('visibilitychange', checkExpiry);
    };
}
