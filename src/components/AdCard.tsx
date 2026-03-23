'use client';
import { useEffect, useRef } from 'react';
import styles from './Dashboard.module.css';

declare global {
    interface Window {
        adsbygoogle: Array<Record<string, unknown>>;
    }
}

interface AdCardProps {
    adSlot?: string;
    className?: string;
}

export default function AdCard({ adSlot = '6919960351', className }: AdCardProps) {
    const adRef = useRef<HTMLModElement>(null);
    const pushed = useRef(false);

    useEffect(() => {
        if (pushed.current) return;
        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
            pushed.current = true;
        } catch {
            // AdSense not loaded (e.g. localhost)
        }
    }, []);

    return (
        <div className={`${styles.flightCard} ${styles.adCard} ${className || ''}`}>
            <div className={styles.adLabel}>광고</div>
            <ins
                ref={adRef}
                className="adsbygoogle"
                style={{ display: 'block', width: '100%', minHeight: '200px' }}
                data-ad-client="ca-pub-8329497855024061"
                data-ad-slot={adSlot}
                data-ad-format="fluid"
                data-ad-layout-key="-6t+ed+2i-1n-4w"
            />
        </div>
    );
}
