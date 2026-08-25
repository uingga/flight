'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
    favoriteIds?: string[];
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
    const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
    const [recent, setRecent] = useState<AccountRecent[]>([]);
    const [savedSearches, setSavedSearches] = useState<AccountSavedSearch[]>([]);
    const [message, setMessage] = useState<string | null>(null);
    const favoriteMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
    const sessionGenerationRef = useRef(0);
    const sessionIdentityRef = useRef('');
    const refreshRequestRef = useRef(0);

    const refresh = useCallback(async () => {
        const requestNumber = ++refreshRequestRef.current;
        try {
            const response = await fetch('/api/account', { credentials: 'same-origin', cache: 'no-store' });
            const payload = await response.json() as AccountPayload;
            if (requestNumber !== refreshRequestRef.current) return;
            if (!response.ok) {
                setStatus(payload.unavailable ? 'unavailable' : 'anonymous');
                setMessage(payload.error || null);
                return;
            }
            if (!payload.authenticated) {
                if (sessionIdentityRef.current) {
                    sessionGenerationRef.current += 1;
                    sessionIdentityRef.current = '';
                }
                setStatus('anonymous');
                setEmail('');
                setFavorites([]);
                setFavoriteIds([]);
                setRecent([]);
                setSavedSearches([]);
                return;
            }
            const nextEmail = payload.user?.email || '';
            if (sessionIdentityRef.current !== nextEmail) {
                sessionGenerationRef.current += 1;
                sessionIdentityRef.current = nextEmail;
            }
            setStatus('authenticated');
            setEmail(nextEmail);
            setFavorites(payload.favorites || []);
            setFavoriteIds(payload.favoriteIds || (payload.favorites || []).map(item => item.flightId));
            setRecent(payload.recent || []);
            setSavedSearches(payload.savedSearches || []);
            setMessage(null);
        } catch {
            if (requestNumber !== refreshRequestRef.current) return;
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
            body: JSON.stringify({
                ...body,
                expectedAccountEmail: sessionIdentityRef.current,
            }),
        });
        const payload = await readJson(response);
        if (shouldRefresh) await refresh();
        return payload;
    }, [refresh]);

    const enqueueFavoriteMutation = useCallback((
        operation: (isCurrentSession: () => boolean) => Promise<void>,
    ) => {
        const generation = sessionGenerationRef.current;
        const isCurrentSession = () => generation === sessionGenerationRef.current;
        const next = favoriteMutationQueueRef.current
            .catch(() => undefined)
            .then(async () => {
                if (!isCurrentSession()) return;
                await operation(isCurrentSession);
            });
        favoriteMutationQueueRef.current = next.catch(() => undefined);
        return next;
    }, []);

    const mergeLocalFavorites = useCallback(async (flightIds: string[]) => {
        if (status !== 'authenticated' || !flightIds.length) {
            return { completed: false, mergedFlightIds: [] as string[] };
        }
        const uniqueFlightIds = Array.from(new Set(flightIds));
        const mergedFlightIds: string[] = [];
        let completed = false;
        await enqueueFavoriteMutation(async isCurrentSession => {
            for (let index = 0; index < uniqueFlightIds.length; index += 100) {
                if (!isCurrentSession()) return;
                const result = await postAction({
                    action: 'merge_favorites',
                    flightIds: uniqueFlightIds.slice(index, index + 100),
                });
                if (Array.isArray(result.mergedFlightIds)) {
                    mergedFlightIds.push(...result.mergedFlightIds.filter(id => typeof id === 'string'));
                }
            }
            if (!isCurrentSession()) return;
            await refresh();
            completed = isCurrentSession();
        });
        return {
            completed,
            mergedFlightIds: Array.from(new Set(mergedFlightIds)),
        };
    }, [enqueueFavoriteMutation, postAction, refresh, status]);

    const setFavorite = useCallback(async (flightId: string, favorite: boolean) => {
        if (status !== 'authenticated') return;
        await enqueueFavoriteMutation(async isCurrentSession => {
            if (!isCurrentSession()) return;
            await postAction({ action: 'set_favorite', flightId, favorite });
            if (isCurrentSession()) await refresh();
        });
    }, [enqueueFavoriteMutation, postAction, refresh, status]);

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
        const previousRecent = recent;
        setRecent([]);
        try {
            await postAction({ action: 'clear_recent' });
        } catch (error) {
            setRecent(previousRecent);
            throw error;
        }
    }, [postAction, recent]);

    const logout = useCallback(async () => {
        const previousIdentity = sessionIdentityRef.current;
        sessionGenerationRef.current += 1;
        sessionIdentityRef.current = '';
        refreshRequestRef.current += 1;
        try {
            const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
            await readJson(response);
            await refresh();
        } catch (error) {
            sessionGenerationRef.current += 1;
            sessionIdentityRef.current = previousIdentity;
            refreshRequestRef.current += 1;
            throw error;
        }
    }, [refresh]);

    const deleteAccount = useCallback(async () => {
        await postAction({ action: 'delete_account' });
        sessionGenerationRef.current += 1;
        sessionIdentityRef.current = '';
        refreshRequestRef.current += 1;
        await refresh();
    }, [postAction, refresh]);

    return {
        status,
        email,
        favorites,
        recent,
        savedSearches,
        message,
        favoriteIds,
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
