'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { startVisitAnalytics } from '@/lib/visit-analytics-client';

export default function VisitAnalytics() {
    const path = usePathname();
    const initial = useRef(typeof window !== 'undefined' ? {url:location.href,referrer:document.referrer} : null);
    useEffect(() => {
        const landing = initial.current;
        initial.current = null;
        return startVisitAnalytics(landing?.url || location.href, landing?.referrer ?? location.origin);
    }, [path]);
    return null;
}
