'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface NotificationSettings {
    enabled: boolean;
    maxPrice: number | null; // null = 모든 가격
    routes: string[]; // 빈 배열 = 모든 노선
}

interface FlightDeal {
    id: string;
    airline: string;
    departureCity: string;
    arrivalCity: string;
    price: number;
    departureDate: string;
    link: string;
}

const SETTINGS_KEY = 'tikit-notification-settings';
const SEEN_FLIGHTS_KEY = 'tikit-seen-flights';
const LAST_CHECK_KEY = 'tikit-last-check';

function getSettings(): NotificationSettings {
    if (typeof window === 'undefined') return { enabled: false, maxPrice: null, routes: [] };
    try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (stored) return JSON.parse(stored);
    } catch (e) { }
    return { enabled: false, maxPrice: null, routes: [] };
}

function saveSettings(settings: NotificationSettings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { }
}

function getSeenFlightIds(): Set<string> {
    try {
        const stored = localStorage.getItem(SEEN_FLIGHTS_KEY);
        if (stored) return new Set(JSON.parse(stored));
    } catch (e) { }
    return new Set();
}

function saveSeenFlightIds(ids: Set<string>) {
    try {
        // 최근 500개만 유지
        const arr = Array.from(ids).slice(-500);
        localStorage.setItem(SEEN_FLIGHTS_KEY, JSON.stringify(arr));
    } catch (e) { }
}

export function useNotification() {
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [settings, setSettings] = useState<NotificationSettings>(getSettings);
    const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
    const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // 브라우저 지원 확인
    const isSupported = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;

    // Service Worker 등록
    useEffect(() => {
        if (!isSupported) return;

        setPermission(Notification.permission);

        navigator.serviceWorker.register('/sw.js').then((reg) => {
            setSwRegistration(reg);
        }).catch((err) => {
            console.error('SW 등록 실패:', err);
        });
    }, [isSupported]);

    // 알림 권한 요청
    const requestPermission = useCallback(async () => {
        if (!isSupported) return false;

        const result = await Notification.requestPermission();
        setPermission(result);

        if (result === 'granted') {
            const newSettings = { ...settings, enabled: true };
            setSettings(newSettings);
            saveSettings(newSettings);
            return true;
        }
        return false;
    }, [isSupported, settings]);

    // 알림 ON/OFF 토글
    const toggleNotification = useCallback(async () => {
        if (!settings.enabled) {
            // 켜기
            if (permission !== 'granted') {
                const granted = await requestPermission();
                return granted;
            }
            const newSettings = { ...settings, enabled: true };
            setSettings(newSettings);
            saveSettings(newSettings);
            return true;
        } else {
            // 끄기
            const newSettings = { ...settings, enabled: false };
            setSettings(newSettings);
            saveSettings(newSettings);
            return false;
        }
    }, [settings, permission, requestPermission]);

    // 가격 임계값 설정
    const setMaxPrice = useCallback((price: number | null) => {
        const newSettings = { ...settings, maxPrice: price };
        setSettings(newSettings);
        saveSettings(newSettings);
    }, [settings]);

    // 관심 노선 설정
    const setRoutes = useCallback((routes: string[]) => {
        const newSettings = { ...settings, routes };
        setSettings(newSettings);
        saveSettings(newSettings);
    }, [settings]);

    // 알림 보내기
    const sendNotification = useCallback((title: string, body: string, data?: any) => {
        if (!swRegistration || permission !== 'granted') return;

        swRegistration.active?.postMessage({
            type: 'SHOW_NOTIFICATION',
            title,
            body,
            data,
        });
    }, [swRegistration, permission]);

    // 새 특가 체크
    const checkForNewDeals = useCallback(async (flights: any[]) => {
        if (!settings.enabled || permission !== 'granted') return;

        const seenIds = getSeenFlightIds();
        const newDeals: FlightDeal[] = [];

        for (const flight of flights) {
            const flightKey = `${flight.departure?.city}-${flight.arrival?.city}-${flight.price}-${flight.departure?.date}`;

            // 이미 본 항공편이면 건너뛰기
            if (seenIds.has(flightKey)) continue;

            // 가격 필터
            if (settings.maxPrice && flight.price > settings.maxPrice) continue;

            // 노선 필터
            if (settings.routes.length > 0) {
                const route = `${flight.departure?.city}-${flight.arrival?.city}`;
                if (!settings.routes.some(r => route.includes(r))) continue;
            }

            newDeals.push({
                id: flightKey,
                airline: flight.airline || '',
                departureCity: flight.departure?.city || '',
                arrivalCity: flight.arrival?.city || '',
                price: flight.price,
                departureDate: flight.departure?.date || '',
                link: flight.link || '',
            });

            seenIds.add(flightKey);
        }

        // 새 특가가 있으면 알림
        if (newDeals.length > 0) {
            const topDeal = newDeals.sort((a, b) => a.price - b.price)[0];
            const priceStr = topDeal.price.toLocaleString();

            if (newDeals.length === 1) {
                sendNotification(
                    `✈️ ${topDeal.arrivalCity} 특가!`,
                    `${topDeal.airline} ${priceStr}원 (${topDeal.departureDate})`,
                    { url: topDeal.link }
                );
            } else {
                sendNotification(
                    `✈️ 새 특가 ${newDeals.length}건 발견!`,
                    `최저가: ${topDeal.arrivalCity} ${priceStr}원 외 ${newDeals.length - 1}건`,
                    { url: '/' }
                );
            }
        }

        saveSeenFlightIds(seenIds);
        localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());
    }, [settings, permission, sendNotification]);

    // 알림 초기화 (seen 목록 클리어)
    const resetSeenFlights = useCallback(() => {
        localStorage.removeItem(SEEN_FLIGHTS_KEY);
        localStorage.removeItem(LAST_CHECK_KEY);
    }, []);

    return {
        isSupported,
        permission,
        settings,
        requestPermission,
        toggleNotification,
        setMaxPrice,
        setRoutes,
        checkForNewDeals,
        resetSeenFlights,
        sendNotification,
    };
}
