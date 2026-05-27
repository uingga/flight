'use client';
import { useEffect, useRef, useState } from 'react';
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
    const [filled, setFilled] = useState(false);

    useEffect(() => {
        if (pushed.current) return;
        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
            pushed.current = true;
        } catch {
            // AdSense not loaded (e.g. localhost)
            return;
        }

        // AdSense가 광고를 채웠는지 확인 (iframe 또는 높이 변화 감지)
        const checkFilled = () => {
            const el = adRef.current;
            if (!el) return false;
            // AdSense가 광고를 렌더하면 ins 안에 iframe이 생기거나 data-ad-status="filled"가 붙음
            if (el.dataset.adStatus === 'filled') return true;
            if (el.querySelector('iframe')) return true;
            if (el.offsetHeight > 50) return true;
            return false;
        };

        // 짧은 간격으로 몇 초간 체크
        let attempts = 0;
        const maxAttempts = 15;
        const timer = setInterval(() => {
            attempts++;
            if (checkFilled()) {
                setFilled(true);
                clearInterval(timer);
            } else if (attempts >= maxAttempts) {
                clearInterval(timer);
                // 끝까지 안 채워지면 숨김 유지
            }
        }, 500);

        return () => clearInterval(timer);
    }, []);

    return (
        <div
            className={`${styles.adCard} ${className || ''}`}
            style={{ display: filled ? '' : 'none' }}
        >
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
