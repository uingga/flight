'use client';

import { useCallback, useEffect, useState } from 'react';

export interface AccountFlightSnapshot {
    id: string;
    source: string;
    airline: string;
    departureCity: string;
    departureAirport: string;
    departureDate: string;
    departureTime: string;
    arrivalCity: string;
    arrivalAirport: string;
    returnDate: string;
    returnTime: string;
    price: number;
    availableSeats?: number;
}

export interface AccountFavorite {
    flightId: string;
    snapshot: AccountFlightSnapshot;
    savedPrice: number;
    availableNow: boolean;
    updatedAt: string;
}

export interface AccountRecent {
    flightId: string;
    snapshot: AccountFlightSnapshot;
    availableNow: boolean;
    viewedAt: string;
}

export interface AccountSearchFilters {
    searchTerm: string;
    sortBy: 'price' | 'date' | 'airline' | 'discount' | 'discountRate';
    sortOrder: 'asc' | 'desc';
    sourceFilter: string;
    regionFilter: string;
    startDate: string;
    endDate: string;
    departureFilter: string;
    airlineFilter: string;
    maxPrice?: number;
    datePeriod?: 'all' | 'this-week' | 'next-week' | 'this-month' | 'next-month' | 'custom';
}

export interface AccountSavedSearch {
    id: string;
    name: string;
    filters: AccountSearchFilters;
    updatedAt: string;
}

interface AccountPayload {
    authenticated: boolean;
    unavailable?: boolean;
    error?: string;
    user?: { email: string };
    favorites?: AccountFavorite[];
    recent?: AccountRecent[];
    savedSearches?: AccountSavedSearch[];
}

export type AccountStatus = 'loading' | 'anonymous' | 'authenticated' | 'unavailable';

async function readJson(response: Response) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : '요청을 처리하지 못했어요.');
    return payload;
}

export function useAccount() {
    const [status, setStatus] = useState<AccountStatus>('loading');
    const [email, setEmail] = useState('');
    const [favorites, setFavorites] = useState<AccountFavorite[]>([]);
    const [recent, setRecent] = useState<AccountRecent[]>([]);
    const [savedSearches, setSavedSearches] = useState<AccountSavedSearch[]>([]);
    const [message, setMessage] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const response = await fetch('/api/account', { credentials: 'same-origin', cache: 'no-store' });
            const payload = await response.json() as AccountPayload;
            if (!response.ok) {
                setStatus(payload.unavailable ? 'unavailable' : 'anonymous');
                setMessage(payload.error || null);
                return;
            }
            if (!payload.authenticated) {
                setStatus('anonymous');
                setEmail('');
                setFavorites([]);
                setRecent([]);
                setSavedSearches([]);
                return;
            }
            setStatus('authenticated');
            setEmail(payload.user?.email || '');
            setFavorites(payload.favorites || []);
            setRecent(payload.recent || []);
            setSavedSearches(payload.savedSearches || []);
            setMessage(null);
        } catch {
            setStatus('unavailable');
            setMessage('계정 정보를 불러오지 못했어요.');
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const requestCode = useCallback(async (loginEmail: string) => {
        const response = await fetch('/api/auth/request-code', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: loginEmail }),
        });
        const payload = await readJson(response);
        return String(payload.requestId || '');
    }, []);

    const verifyCode = useCallback(async (loginEmail: string, code: string, requestId: string) => {
        const response = await fetch('/api/auth/verify-code', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: loginEmail, code, requestId }),
        });
        await readJson(response);
        await refresh();
    }, [refresh]);

    const postAction = useCallback(async (body: Record<string, unknown>, shouldRefresh = false) => {
        const response = await fetch('/api/account', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const payload = await readJson(response);
        if (shouldRefresh) await refresh();
        return payload;
    }, [refresh]);

    const mergeLocalFavorites = useCallback(async (flightIds: string[]) => {
        if (status !== 'authenticated' || !flightIds.length) return;
        await postAction({ action: 'merge_favorites', flightIds }, true);
    }, [postAction, status]);

    const setFavorite = useCallback(async (flightId: string, favorite: boolean) => {
        if (status !== 'authenticated') return;
        setFavorites(current => favorite
            ? current
            : current.filter(item => item.flightId !== flightId));
        await postAction({ action: 'set_favorite', flightId, favorite }, favorite);
    }, [postAction, status]);

    const recordRecent = useCallback((flightId: string) => {
        if (status !== 'authenticated') return;
        void postAction({ action: 'record_recent', flightId }).catch(() => undefined);
    }, [postAction, status]);

    const saveSearch = useCallback(async (name: string, filters: AccountSearchFilters) => {
        await postAction({ action: 'save_search', name, filters }, true);
    }, [postAction]);

    const deleteSearch = useCallback(async (id: string) => {
        await postAction({ action: 'delete_search', id }, true);
    }, [postAction]);

    const clearRecent = useCallback(async () => {
        setRecent([]);
        await postAction({ action: 'clear_recent' });
    }, [postAction]);

    const logout = useCallback(async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        await refresh();
    }, [refresh]);

    const deleteAccount = useCallback(async () => {
        await postAction({ action: 'delete_account' });
        await refresh();
    }, [postAction, refresh]);

    return {
        status,
        email,
        favorites,
        recent,
        savedSearches,
        message,
        favoriteIds: favorites.map(item => item.flightId),
        requestCode,
        verifyCode,
        mergeLocalFavorites,
        setFavorite,
        recordRecent,
        saveSearch,
        deleteSearch,
        clearRecent,
        logout,
        deleteAccount,
        refresh,
    };
}

export type AccountController = ReturnType<typeof useAccount>;
