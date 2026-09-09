'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Flight } from '@/types/flight';
import { parseRecentFlights, recentFlightKey, rememberFlight, RECENT_FLIGHTS_KEY, type RecentFlight } from '@/lib/recent-flights';

export function useRecentFlights(selectedFlight: Flight | null) {
    const [records, setRecords] = useState<RecentFlight[]>([]);
    const [storageUnavailable, setStorageUnavailable] = useState(false);
    useEffect(() => {
        const read = () => {
            try { setRecords(parseRecentFlights(localStorage.getItem(RECENT_FLIGHTS_KEY))); }
            catch { setStorageUnavailable(true); }
        };
        const sync = (event: StorageEvent) => {
            if (event.key === RECENT_FLIGHTS_KEY || event.key === null) read();
        };
        read();
        window.addEventListener('storage', sync);
        window.addEventListener('focus', read);
        return () => {
            window.removeEventListener('storage', sync);
            window.removeEventListener('focus', read);
        };
    }, []);
    useEffect(() => {
        if (!selectedFlight) return;
        try {
            const next = rememberFlight(parseRecentFlights(localStorage.getItem(RECENT_FLIGHTS_KEY)), selectedFlight);
            localStorage.setItem(RECENT_FLIGHTS_KEY, JSON.stringify(next));
            setRecords(next);
        } catch {
            setStorageUnavailable(true);
            setRecords(previous => rememberFlight(previous, selectedFlight));
        }
    }, [selectedFlight]);
    const clear = useCallback(() => {
        setRecords([]);
        try { localStorage.removeItem(RECENT_FLIGHTS_KEY); }
        catch { setStorageUnavailable(true); }
    }, []);
    const remove = useCallback((key: string) => {
        let next = records.filter(record => recentFlightKey(record.flight) !== key);
        try {
            next = parseRecentFlights(localStorage.getItem(RECENT_FLIGHTS_KEY))
                .filter(record => recentFlightKey(record.flight) !== key);
            localStorage.setItem(RECENT_FLIGHTS_KEY, JSON.stringify(next));
        } catch { setStorageUnavailable(true); }
        setRecords(next);
    }, [records]);
    return { records, clear, remove, storageUnavailable };
}
