'use client';

import { useEffect, useState } from 'react';

// Keep the last panel mounted for the existing 180ms filter motion.
export function useFilterPresence<T>(value: T | null, enabled = true) {
    const [retained, setRetained] = useState<T | null>(value);
    useEffect(() => {
        if (value !== null) {
            setRetained(value);
            return;
        }
        if (!enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setRetained(null);
            return;
        }
        const timer = window.setTimeout(() => setRetained(null), 180);
        return () => window.clearTimeout(timer);
    }, [value, enabled]);
    return { value: value ?? (enabled ? retained : null), closing: value === null };
}
