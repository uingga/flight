'use client';

import { useEffect, useState } from 'react';

export interface PassengerSelection { adult: number; child: number; infant: number }
export const PASSENGER_SELECTION_KEY = 'tikitikit_passengers_v1';
const defaults: PassengerSelection = { adult: 1, child: 0, infant: 0 };

export function parsePassengerSelection(raw: string | null): PassengerSelection {
    try {
        const value = JSON.parse(raw || 'null');
        if (!value || !['adult', 'child', 'infant'].every(key => Number.isInteger(value[key]))) return { ...defaults };
        const adult = Math.min(9, Math.max(1, value.adult));
        return {
            adult,
            child: Math.min(9, Math.max(0, value.child)),
            infant: Math.min(4, adult, Math.max(0, value.infant)),
        };
    } catch {
        return { ...defaults };
    }
}

/** Keep the user's choice across details/reloads in this tab, not across visits. */
export function usePassengerSelection() {
    const [passengers, setPassengers] = useState<PassengerSelection>({ ...defaults });
    const [restored, setRestored] = useState(false);
    useEffect(() => {
        try { setPassengers(parsePassengerSelection(sessionStorage.getItem(PASSENGER_SELECTION_KEY))); } catch { }
        setRestored(true);
    }, []);
    useEffect(() => {
        if (!restored) return;
        try { sessionStorage.setItem(PASSENGER_SELECTION_KEY, JSON.stringify(passengers)); } catch { }
    }, [passengers, restored]);
    return [passengers, setPassengers] as const;
}
