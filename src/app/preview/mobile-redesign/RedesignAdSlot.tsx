'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import styles from './page.module.css';

const ADSENSE_CLIENT = 'ca-pub-8329497855024061';
const HOME_FOOTER_SLOT = '9981185347';

type AdStatus = 'pending' | 'filled' | 'unfilled';

interface RedesignAdSlotProps {
    preview?: boolean;
}

export default function RedesignAdSlot({ preview = false }: RedesignAdSlotProps) {
    const adRef = useRef<HTMLModElement>(null);
    const requestedRef = useRef(false);
    const resolvedRef = useRef(false);
    const [status, setStatus] = useState<AdStatus>('pending');

    useEffect(() => {
        if (preview || !adRef.current) return;

        const adElement = adRef.current;
        const updateStatus = () => {
            const adStatus = adElement.dataset.adStatus;
            if (adStatus === 'filled') {
                resolvedRef.current = true;
                setStatus('filled');
            } else if (adStatus === 'unfilled' || adStatus === 'unfill-optimized') {
                resolvedRef.current = true;
                setStatus('unfilled');
            }
        };

        const observer = new MutationObserver(updateStatus);
        observer.observe(adElement, {
            attributes: true,
            attributeFilter: ['data-ad-status'],
        });
        updateStatus();

        if (!requestedRef.current) {
            try {
                const adsenseWindow = window as Window & {
                    adsbygoogle?: Array<Record<string, unknown>>;
                };
                (adsenseWindow.adsbygoogle = adsenseWindow.adsbygoogle || []).push({});
                requestedRef.current = true;
            } catch {
                resolvedRef.current = true;
                setStatus('unfilled');
            }
        }

        const timeout = window.setTimeout(() => {
            if (!resolvedRef.current) setStatus('unfilled');
        }, 8_000);

        return () => {
            observer.disconnect();
            window.clearTimeout(timeout);
        };
    }, [preview]);

    if (preview) {
        return (
            <aside className={styles.adPlacementPreview} aria-label="광고 위치 미리보기">
                <span className={styles.adPlacementLabel}>광고</span>
                <div className={styles.adPlacementCanvas}>
                    <span className={styles.adPlacementMark} aria-hidden="true">AD</span>
                    <span className={styles.adPlacementCopy}>
                        <strong>실제 광고가 들어올 자리</strong>
                        <small>미리보기에서만 영역을 표시하고 있어요.</small>
                    </span>
                </div>
            </aside>
        );
    }

    return (
        <>
            <Script
                id="tikitikit-home-adsense"
                src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
                strategy="afterInteractive"
                crossOrigin="anonymous"
            />
            <aside
                className={`${styles.homeAdSlot} ${status === 'pending' ? styles.homeAdSlotPending : ''} ${status === 'unfilled' ? styles.homeAdSlotUnfilled : ''}`}
                aria-label="광고"
            >
                <span className={styles.homeAdLabel}>광고</span>
                <ins
                    ref={adRef}
                    className={`adsbygoogle ${styles.homeAdIns}`}
                    style={{ display: 'block', width: '100%' }}
                    data-ad-client={ADSENSE_CLIENT}
                    data-ad-slot={HOME_FOOTER_SLOT}
                    data-ad-format="horizontal"
                    data-full-width-responsive="true"
                />
            </aside>
        </>
    );
}
