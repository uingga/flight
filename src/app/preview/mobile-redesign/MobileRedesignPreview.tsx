'use client';

import { Fragment, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import dynamic from 'next/dynamic';
import { ko } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import Logo from '@/components/Logo';
import OverlayDialog from '@/components/ui/OverlayDialog';
import * as gtag from '@/lib/analytics';
import { getDestinationContext } from '@/lib/destination-contexts';
import {
    buildRecommendationPresentation,
    buildRecommendationScoreState,
    compareRecommendedFlights,
} from '@/lib/flight-recommendation';
import { CITY_TO_AIRPORT, calcFlightTiming, formatAgencyFlightDuration, getNaverFlightUrl, normalizeAirline, normalizeCity } from '@/lib/utils/flight-helpers';
import { getTripcomHotelUrl, getTripcomTrackingId } from '@/lib/utils/tripcom-helpers';
import { getFlightBookingUrl } from '@/lib/utils/booking-url';
import { encodeShareId } from '@/lib/share-code';
import { useSwipeToDismiss } from '@/lib/hooks/use-swipe-to-dismiss';
import {
    dismissOverlayWithHistory,
    historyOverlay,
    showOverlayWithHistory,
} from '@/lib/ui/overlay-history';
import { checkIsMobile } from '@/lib/utils/mobile-url';
import { getComparisonFreshness } from '@/lib/price-quality';
import type { Flight } from '@/types/flight';
import AccountSheet from '@/components/account/AccountSheet';
import { useAccount, type AccountFlightSnapshot, type AccountSearchFilters } from '@/components/account/useAccount';
import WeeklyDiscoveryInsight from '@/components/WeeklyDiscoveryInsight';
import MobileDealAlertSheet, { type AlertSearchCondition } from './MobileDealAlertSheet';
import RedesignAdSlot from './RedesignAdSlot';
import styles from './page.module.css';

type SortMode = 'recommended' | 'price' | 'date';
type DatePeriod = 'all' | 'this-week' | 'next-week' | 'this-month' | 'next-month' | 'custom';
type DesktopFilterKey = 'departure' | 'region' | 'date' | 'price';
type FlightReportStatus = 'sending' | 'sent' | 'error';
type EmptyFilterId = 'region' | 'departure' | 'date' | 'price' | 'source' | 'airline';

const RECENT_FLIGHT_REPORTS_KEY = 'tikitikit_recent_flight_reports';
const RECENT_SEARCHES_KEY = 'tikitikit_recent_searches';
const FLIGHT_REPORT_TTL_MS = 24 * 60 * 60 * 1000;
const FRESH_MOBILE_ITEM_HEIGHT = 132;
const FRESH_MOBILE_AUTO_ADVANCE_MS = 4_800;
const FRESH_DESKTOP_PAIR_HEIGHT = 172;
const FRESH_DESKTOP_AUTO_ADVANCE_MS = 5_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DatePicker: any = dynamic(() => import('react-datepicker').then((mod: any) => mod.default), { ssr: false });

interface FlightsResponse {
    success: boolean;
    count: number;
    flights: Flight[];
    lastUpdated?: string | null;
    todayPickId?: string | null;
    todayPickDate?: string | null;
    todayPickRepeatOverride?: TodayPickRepeatOverride | null;
    priceHistory?: PriceHistory;
    interparkPrices?: InterparkPrices;
}

interface TodayPickRepeatOverride {
    previousEffectivePrice: number;
    currentEffectivePrice: number;
    dropAmount: number;
}

interface PriceHistoryEntry {
    date: string;
    minPrice: number;
    avgPrice?: number;
    count?: number;
}

type PriceHistory = Record<string, PriceHistoryEntry[]>;
type InterparkPrices = Record<string, Record<string, { avg: number; lowest: number }>>;

interface MobileRedesignPreviewProps {
    previewMode?: boolean;
    beforeFooter?: ReactNode;
    rootAs?: 'main' | 'div';
    initialFlights?: Flight[];
    initialFlightCount?: number;
    initialLastUpdated?: string | null;
    initialTodayPickId?: string | null;
}

interface RouteAlertTarget {
    flightId?: string;
    departureCity: string;
    arrivalCity: string;
    currentPrice?: number;
    suggestedPrice?: number;
}

interface FreshMobileDragState {
    pointerId: number;
    startY: number;
    startedAt: number;
}

interface FreshDesktopDragState {
    pointerId: number;
    startY: number;
    startedAt: number;
}

interface FreshRouteResults {
    route: string;
    departure: string;
    arrival: string;
    targetDate: string;
    copyPrefix: string;
}

interface FeedInsight {
    id: string;
    kind: 'price' | 'stay' | 'schedule' | 'timing' | 'airport' | 'discovery' | 'new' | 'opportunity';
    editorial?: boolean;
    eyebrow: string;
    title: string;
    flight: Flight;
    destination: string;
    currentPrice: number;
    previousPrice?: number;
    meta: string;
    badge?: string;
    description?: string;
}

const SOURCE_NAMES: Record<Flight['source'], string> = {
    ybtour: '노랑풍선',
    modetour: '모두투어',
    hanatour: '하나투어',
    onlinetour: '온라인투어',
    ttang: '땡처리닷컴',
    myrealtrip: '마이리얼트립',
};
const SOURCE_OPTIONS: Array<{ value: 'all' | Flight['source']; label: string }> = [
    { value: 'all', label: '전체' },
    ...Object.entries(SOURCE_NAMES).map(([value, label]) => ({ value: value as Flight['source'], label })),
];

const TTANG_TICKETING_FEE = 20_000;

const REGION_OPTIONS = ['전체', '일본', '동남아', '중화권', '남태평양', '유럽', '미주', '기타'];
const QUICK_REGION_OPTIONS = REGION_OPTIONS.slice(0, 4);
const MORE_REGION_OPTIONS = REGION_OPTIONS.slice(4);
const DEPARTURE_OPTIONS = ['전체', '인천/김포', '부산/김해', '대구', '청주', '제주'];
const DATE_PERIOD_OPTIONS: Array<{ label: string; value: Exclude<DatePeriod, 'custom'> }> = [
    { label: '전체', value: 'all' },
    { label: '이번 주', value: 'this-week' },
    { label: '다음 주', value: 'next-week' },
    { label: '이번 달', value: 'this-month' },
    { label: '다음 달', value: 'next-month' },
];
const PRICE_OPTIONS = [
    { label: '제한 없음', value: 0 },
    { label: '20만원 이하', value: 200_000 },
    { label: '30만원 이하', value: 300_000 },
    { label: '50만원 이하', value: 500_000 },
];
const SORT_OPTIONS: Array<{ label: string; value: SortMode }> = [
    { label: '추천순', value: 'recommended' },
    { label: '낮은 가격순', value: 'price' },
    { label: '빠른 출발순', value: 'date' },
];

const stripAirport = (city: string) => city.replace(/\([^)]*\)/g, '').trim();

const departureName = (flight: Flight) => {
    if (flight.departure.airport === 'ICN') return '인천';
    if (flight.departure.airport === 'GMP') return '김포';
    if (flight.departure.airport === 'PUS') return '부산';
    return stripAirport(flight.departure.city);
};

const effectivePrice = (flight: Flight) => flight.price + (flight.source === 'ttang' ? TTANG_TICKETING_FEE : 0);

const toAccountSnapshot = (flight: Flight): AccountFlightSnapshot => ({
    id: flight.id,
    source: flight.source,
    airline: flight.airline,
    departureCity: flight.departure.city,
    departureAirport: flight.departure.airport,
    departureDate: flight.departure.date,
    departureTime: flight.departure.time,
    arrivalCity: flight.arrival.city,
    arrivalAirport: flight.arrival.airport,
    returnDate: flight.arrival.date,
    returnTime: flight.arrival.time,
    price: flight.price,
    ...(flight.availableSeats ? { availableSeats: flight.availableSeats } : {}),
});

const parseDate = (value: string) => {
    const normalized = value.replace(/\./g, '-').replace(/\([^)]*\)/g, '').trim().slice(0, 10);
    const date = new Date(`${normalized}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
};

const shortDate = (value: string) => {
    const date = parseDate(value);
    if (!date) return value || '날짜 확인';
    return new Intl.DateTimeFormat('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
    }).format(date).replace(/\.$/, '');
};

const shortDateWithOffset = (value: string, offset: number) => {
    const date = parseDate(value);
    if (!date) return shortDate(value);
    date.setDate(date.getDate() + offset);
    return new Intl.DateTimeFormat('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
    }).format(date).replace(/\.$/, '');
};

const cardDate = (value: string) => {
    const date = parseDate(value);
    if (!date) return value || '날짜 확인';
    const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(date);
    return `${date.getMonth() + 1}.${date.getDate()}(${weekday})`;
};

const tripLength = (flight: Flight) => {
    const departure = parseDate(flight.departure.date);
    const arrival = parseDate(flight.arrival.date);
    if (!departure || !arrival) return null;
    const days = Math.round((arrival.getTime() - departure.getTime()) / 86_400_000) + 1;
    if (days === 1) return '당일';
    return days > 1 ? `${days - 1}박 ${days}일` : null;
};

const fallbackArrivalDayOffset = (departureTime?: string, arrivalTime?: string) => {
    const parseMinutes = (value?: string) => {
        const match = value?.match(/(\d{1,2}):(\d{2})/);
        if (!match) return null;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (hours > 23 || minutes > 59) return null;
        return hours * 60 + minutes;
    };
    const departureMinutes = parseMinutes(departureTime);
    const arrivalMinutes = parseMinutes(arrivalTime);
    if (departureMinutes === null || arrivalMinutes === null) return 0;
    return arrivalMinutes < departureMinutes ? 1 : 0;
};

const departureCountdownText = (flight: Flight, referenceDate: Date) => {
    const departure = parseDate(flight.departure.date);
    if (!departure) return '출발일 확인';
    const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 12);
    const daysUntilDeparture = Math.ceil((departure.getTime() - today.getTime()) / 86_400_000);
    if (daysUntilDeparture <= 0) return '오늘 출발';
    return `출발 D-${daysUntilDeparture}`;
};

const priceText = (price: number) => `${new Intl.NumberFormat('ko-KR').format(price)}원`;

const compactWon = (price: number) => {
    const tenThousands = price / 10_000;
    const value = Number.isInteger(tenThousands) ? tenThousands.toFixed(0) : tenThousands.toFixed(1);
    return `${value}만원`;
};

const normalizedRoute = (flight: Flight) => `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;

const flightScheduleIdentity = (flight: Flight) => [
    flight.id,
    flight.departure.date,
    flight.departure.time,
    flight.arrival.date,
    flight.arrival.time,
].join('|');

const flightScheduleToken = (flight: Flight) => [
    flight.departure.date,
    flight.departure.time,
    flight.arrival.date,
    flight.arrival.time,
].join('|');

const uniqueFlightSchedules = (flights: Flight[]) => Array.from(
    new Map(flights.map(flight => [flightScheduleIdentity(flight), flight])).values(),
);

const tripSpansFullWeekend = (flight: Flight) => {
    const departure = parseDate(flight.departure.date);
    const arrival = parseDate(flight.arrival.date);
    if (!departure || !arrival || arrival < departure) return false;
    const nights = Math.round((arrival.getTime() - departure.getTime()) / 86_400_000);
    if (nights < 2 || nights > 5) return false;

    let includesSaturday = false;
    let includesSunday = false;
    const cursor = new Date(departure);
    while (cursor <= arrival) {
        if (cursor.getDay() === 6) includesSaturday = true;
        if (cursor.getDay() === 0) includesSunday = true;
        cursor.setDate(cursor.getDate() + 1);
    }
    return includesSaturday && includesSunday;
};

function WeekendFlightsInsight({
    flights,
    onOpen,
}: {
    flights: Flight[];
    onOpen: (flight: Flight) => void;
}) {
    const mobileFlights = useMemo(() => flights, [flights]);
    const mobileCount = mobileFlights.length;
    const mobileLoop = useMemo(() => (
        mobileCount <= 1
            ? mobileFlights
            : [mobileFlights[mobileCount - 1], ...mobileFlights, mobileFlights[0]]
    ), [mobileCount, mobileFlights]);
    const desktopPairs = useMemo(() => Array.from(
        { length: Math.ceil(flights.length / 2) },
        (_, index) => flights.slice(index * 2, index * 2 + 2),
    ), [flights]);
    const desktopPairCount = desktopPairs.length;
    const desktopLoop = useMemo(() => (
        desktopPairCount <= 1
            ? desktopPairs
            : [desktopPairs[desktopPairCount - 1], ...desktopPairs, desktopPairs[0]]
    ), [desktopPairCount, desktopPairs]);

    const [reduceMotion, setReduceMotion] = useState(false);
    const [mobilePosition, setMobilePosition] = useState(1);
    const [mobileOffset, setMobileOffset] = useState(0);
    const [mobileAnimating, setMobileAnimating] = useState(true);
    const [desktopPosition, setDesktopPosition] = useState(1);
    const [desktopOffset, setDesktopOffset] = useState(0);
    const [desktopAnimating, setDesktopAnimating] = useState(true);
    const [desktopDragging, setDesktopDragging] = useState(false);
    const mobileDragRef = useRef<FreshMobileDragState | null>(null);
    const desktopDragRef = useRef<FreshDesktopDragState | null>(null);
    const mobileSuppressClickRef = useRef(false);
    const desktopSuppressClickRef = useRef(false);

    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updatePreference = () => setReduceMotion(media.matches);
        updatePreference();
        media.addEventListener('change', updatePreference);
        return () => media.removeEventListener('change', updatePreference);
    }, []);

    useEffect(() => {
        if (window.location.hash !== '#weekend-flights-insight') return;
        const frame = window.requestAnimationFrame(() => {
            document.getElementById('weekend-flights-insight')?.scrollIntoView({ block: 'center' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
        setMobilePosition(mobileCount > 1 ? 1 : 0);
        setMobileOffset(0);
        setDesktopPosition(desktopPairCount > 1 ? 1 : 0);
        setDesktopOffset(0);
        setDesktopDragging(false);
    }, [desktopPairCount, mobileCount]);

    const moveMobile = useCallback((direction: -1 | 1) => {
        if (mobileCount <= 1) return;
        setMobileAnimating(!reduceMotion);
        setMobileOffset(0);
        setMobilePosition(current => current + direction);
    }, [mobileCount, reduceMotion]);

    const moveDesktop = useCallback((direction: -1 | 1) => {
        if (desktopPairCount <= 1) return;
        setDesktopAnimating(!reduceMotion);
        setDesktopOffset(0);
        setDesktopPosition(current => current + direction);
    }, [desktopPairCount, reduceMotion]);

    useEffect(() => {
        if (mobileCount <= 1 || reduceMotion || mobileDragRef.current) return;
        const timer = window.setTimeout(() => moveMobile(1), FRESH_MOBILE_AUTO_ADVANCE_MS + 400);
        return () => window.clearTimeout(timer);
    }, [mobileCount, mobilePosition, moveMobile, reduceMotion]);

    useEffect(() => {
        if (mobileCount <= 1) return;
        const isLeadingClone = mobilePosition <= 0;
        const isTrailingClone = mobilePosition >= mobileCount + 1;
        if (!isLeadingClone && !isTrailingClone) return;
        const timer = window.setTimeout(() => {
            setMobileAnimating(false);
            setMobilePosition(isLeadingClone ? mobileCount : 1);
        }, reduceMotion ? 0 : 760);
        return () => window.clearTimeout(timer);
    }, [mobileCount, mobilePosition, reduceMotion]);

    useEffect(() => {
        if (desktopPairCount <= 1 || reduceMotion || desktopDragging || desktopDragRef.current) return;
        const timer = window.setTimeout(() => moveDesktop(1), FRESH_DESKTOP_AUTO_ADVANCE_MS + 400);
        return () => window.clearTimeout(timer);
    }, [desktopDragging, desktopPairCount, desktopPosition, moveDesktop, reduceMotion]);

    useEffect(() => {
        if (desktopPairCount <= 1) return;
        const isLeadingClone = desktopPosition <= 0;
        const isTrailingClone = desktopPosition >= desktopPairCount + 1;
        if (!isLeadingClone && !isTrailingClone) return;
        const timer = window.setTimeout(() => {
            setDesktopAnimating(false);
            setDesktopPosition(isLeadingClone ? desktopPairCount : 1);
        }, reduceMotion ? 0 : 760);
        return () => window.clearTimeout(timer);
    }, [desktopPairCount, desktopPosition, reduceMotion]);

    const handleMobilePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (mobileCount <= 1 || (event.pointerType === 'mouse' && event.button !== 0)) return;
        mobileDragRef.current = { pointerId: event.pointerId, startY: event.clientY, startedAt: performance.now() };
        mobileSuppressClickRef.current = false;
        setMobileAnimating(false);
        setMobileOffset(0);
    };

    const handleMobilePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = mobileDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const nextOffset = Math.max(-64, Math.min(64, event.clientY - drag.startY));
        if (Math.abs(nextOffset) >= 4 && !event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        setMobileOffset(nextOffset);
    };

    const handleMobilePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = mobileDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const distance = event.clientY - drag.startY;
        const velocity = Math.abs(distance) / Math.max(1, performance.now() - drag.startedAt);
        mobileDragRef.current = null;
        if (Math.abs(distance) >= 30 || velocity >= 0.42) {
            mobileSuppressClickRef.current = true;
            window.setTimeout(() => { mobileSuppressClickRef.current = false; }, 320);
            moveMobile(distance < 0 ? 1 : -1);
        } else {
            setMobileAnimating(!reduceMotion);
            setMobileOffset(0);
        }
    };

    const handleDesktopPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (desktopPairCount <= 1 || (event.pointerType === 'mouse' && event.button !== 0)) return;
        desktopDragRef.current = { pointerId: event.pointerId, startY: event.clientY, startedAt: performance.now() };
        desktopSuppressClickRef.current = false;
        setDesktopDragging(true);
        setDesktopAnimating(false);
        setDesktopOffset(0);
    };

    const handleDesktopPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = desktopDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const nextOffset = Math.max(-82, Math.min(82, event.clientY - drag.startY));
        if (Math.abs(nextOffset) >= 4 && !event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        setDesktopOffset(nextOffset);
    };

    const handleDesktopPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = desktopDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const distance = event.clientY - drag.startY;
        const velocity = Math.abs(distance) / Math.max(1, performance.now() - drag.startedAt);
        desktopDragRef.current = null;
        setDesktopDragging(false);
        if (Math.abs(distance) >= 36 || velocity >= 0.42) {
            desktopSuppressClickRef.current = true;
            window.setTimeout(() => { desktopSuppressClickRef.current = false; }, 320);
            moveDesktop(distance < 0 ? 1 : -1);
        } else {
            setDesktopAnimating(!reduceMotion);
            setDesktopOffset(0);
        }
    };

    if (!flights.length) return null;
    const activeMobileIndex = ((mobilePosition - 1 + mobileCount) % mobileCount);

    const renderTicket = (flight: Flight, mode: 'mobile' | 'desktop', key: string) => {
        const isMobileTicket = mode === 'mobile';
        const suppressClickRef = isMobileTicket ? mobileSuppressClickRef : desktopSuppressClickRef;
        return (
            <button
                type="button"
                className={isMobileTicket ? styles.freshFlightsMobileTicket : styles.freshFlightsTicket}
                key={key}
                data-weekend-flight-id={flight.id}
                onClick={(event) => {
                    if (suppressClickRef.current) {
                        event.preventDefault();
                        suppressClickRef.current = false;
                        return;
                    }
                    onOpen(flight);
                }}
            >
                <span className={isMobileTicket ? styles.freshFlightsMobileTicketMain : styles.freshFlightsTicketMain}>
                    <span className={isMobileTicket ? styles.freshFlightsMobilePlace : styles.freshFlightsPlace}>
                        <small>{departureName(flight)} 출발</small>
                        <strong>{stripAirport(flight.arrival.city)}</strong>
                    </span>
                    <span className={isMobileTicket ? styles.freshFlightsMobilePrice : styles.freshFlightsPrice}>
                        <small>왕복 총액</small>
                        <strong>{effectivePrice(flight).toLocaleString('ko-KR')}<i>원</i></strong>
                    </span>
                </span>
                <span className={isMobileTicket ? styles.freshFlightsMobileSchedule : styles.freshFlightsSchedule}>
                    <span>{cardDate(flight.departure.date)} — {cardDate(flight.arrival.date)}</span>
                    <small>{tripLength(flight)}</small>
                </span>
            </button>
        );
    };

    return (
        <div className={styles.freshFlightsEntry} id="weekend-flights-insight">
            <section
                className={styles.freshFlightsBar}
                aria-labelledby="weekend-flights-title"
                data-weekend-route-count={mobileCount}
            >
                <div className={styles.freshFlightsMobileTopline}>
                    <span>주말 일정</span>
                    {mobileCount > 1 && <span aria-hidden="true">{activeMobileIndex + 1} / {mobileCount}</span>}
                </div>
                <div className={styles.freshFlightsCopy}>
                    <span className={styles.freshFlightsDesktopEyebrow}>주말 일정</span>
                    <strong id="weekend-flights-title">주말이 아까운 사람에게</strong>
                    <p>토·일이 여행 일정에 들어간 항공권만 골랐어요.</p>
                </div>
                <div
                    className={styles.freshFlightsMobileViewport}
                    aria-label="주말 포함 항공권. 위아래로 밀어 다른 항공권 보기"
                    onPointerDown={handleMobilePointerDown}
                    onPointerMove={handleMobilePointerMove}
                    onPointerUp={handleMobilePointerEnd}
                    onPointerCancel={handleMobilePointerEnd}
                >
                    <div
                        className={`${styles.freshFlightsMobileTrack} ${mobileAnimating ? styles.freshFlightsMobileTrackAnimated : ''}`}
                        style={{ transform: `translateY(${(-mobilePosition * FRESH_MOBILE_ITEM_HEIGHT) + mobileOffset}px)` }}
                    >
                        {mobileLoop.map((flight, index) => renderTicket(flight, 'mobile', `${flight.id}-weekend-mobile-${index}`))}
                    </div>
                </div>
                <div
                    className={styles.freshFlightsViewport}
                    aria-label="주말 포함 항공권. 마우스로 위아래로 드래그해 다른 항공권 보기"
                    onPointerDown={handleDesktopPointerDown}
                    onPointerMove={handleDesktopPointerMove}
                    onPointerUp={handleDesktopPointerEnd}
                    onPointerCancel={handleDesktopPointerEnd}
                >
                    <div
                        className={`${styles.freshFlightsTrack} ${desktopAnimating ? styles.freshFlightsTrackAnimated : ''}`}
                        style={{ transform: `translateY(${(-desktopPosition * FRESH_DESKTOP_PAIR_HEIGHT) + desktopOffset}px)` }}
                    >
                        {desktopLoop.map((pair, pairIndex) => (
                            <div
                                className={`${styles.freshFlightsPair} ${pair.length === 1 ? styles.freshFlightsPairSingle : ''}`}
                                key={`weekend-pair-${pairIndex}`}
                            >
                                {pair.map((flight, ticketIndex) => renderTicket(
                                    flight,
                                    'desktop',
                                    `${flight.id}-weekend-desktop-${pairIndex}-${ticketIndex}`,
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        </div>
    );
}

const normalizedHistory = (history: PriceHistory) => {
    const result: PriceHistory = {};
    Object.entries(history).forEach(([route, entries]) => {
        const separator = route.indexOf('-');
        if (separator < 1) return;
        const key = `${normalizeCity(route.slice(0, separator))}-${normalizeCity(route.slice(separator + 1))}`;
        const byDate = new Map<string, PriceHistoryEntry>();
        [...(result[key] || []), ...entries].forEach(entry => {
            const existing = byDate.get(entry.date);
            if (!existing) {
                byDate.set(entry.date, { ...entry });
                return;
            }
            byDate.set(entry.date, {
                date: entry.date,
                minPrice: Math.min(existing.minPrice, entry.minPrice),
                avgPrice: existing.avgPrice && entry.avgPrice
                    ? Math.round((existing.avgPrice + entry.avgPrice) / 2)
                    : existing.avgPrice || entry.avgPrice,
                count: (existing.count || 0) + (entry.count || 0) || undefined,
            });
        });
        result[key] = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    });
    return result;
};

const airportLabel = (city: string, airport?: string) => (
    airport ? `${city}(${airport})` : city
);

const legDetails = (flight: Flight, leg: 'outbound' | 'return') => {
    const detail = flight.modetourDetail;
    const routeAirports = flight.routeAirports;
    const departureCity = departureName(flight);
    const arrivalCity = stripAirport(flight.arrival.city);

    if (leg === 'outbound') {
        const arrivalTime = detail?.departureArrivalTime || flight.departure.arrivalTime || '';
        const timing = calcFlightTiming(departureCity, flight.departure.time, flight.departure.date, arrivalCity, arrivalTime);
        const fallbackDayOffset = fallbackArrivalDayOffset(flight.departure.time, arrivalTime);
        return {
            origin: airportLabel(departureCity, routeAirports?.outboundDeparture || flight.departure.airport),
            destination: airportLabel(arrivalCity, routeAirports?.outboundArrival || flight.arrival.airport),
            departureTime: flight.departure.time || '시간 확인',
            arrivalTime: arrivalTime || '시간 확인',
            departureDate: shortDate(flight.departure.date),
            arrivalDate: shortDateWithOffset(flight.departure.date, timing?.arrivalDayOffset ?? fallbackDayOffset),
            duration: timing?.duration || formatAgencyFlightDuration(detail?.flyingTime),
        };
    }

    const departureTime = detail?.returnDepartureTime || flight.arrival.time || '';
    const arrivalTime = detail?.returnArrivalTime || flight.arrival.arrivalTime || '';
    const timing = calcFlightTiming(arrivalCity, departureTime, flight.arrival.date, departureCity, arrivalTime);
    const fallbackDayOffset = fallbackArrivalDayOffset(departureTime, arrivalTime);
    return {
        origin: airportLabel(arrivalCity, routeAirports?.returnDeparture || detail?.returnDepartureAirport || flight.arrival.airport),
        destination: airportLabel(departureCity, routeAirports?.returnArrival || detail?.returnArrivalAirport || flight.departure.airport),
        departureTime: departureTime || '시간 확인',
        arrivalTime: arrivalTime || '시간 확인',
        departureDate: shortDate(flight.arrival.date),
        arrivalDate: shortDateWithOffset(flight.arrival.date, timing?.arrivalDayOffset ?? fallbackDayOffset),
        duration: timing?.duration
            || formatAgencyFlightDuration(detail?.returnFlyingTime)
            || (flight.id.startsWith('modetour-manual-') && detail?.isReturnDirect
                ? (() => {
                    const estimate = formatAgencyFlightDuration(detail.flyingTime);
                    return estimate ? `약 ${estimate}` : null;
                })()
                : null),
    };
};

const regionMatches = (flight: Flight, region: string) => {
    if (region === '전체') return true;
    const raw = flight.region || '';
    if (region === '중화권') return ['중국', '홍콩', '마카오', '대만', '중화권'].some(item => raw.includes(item));
    return raw.includes(region);
};

const departureMatches = (flight: Flight, departure: string) => {
    if (departure === '전체') return true;
    const airport = flight.departure.airport;
    if (departure === '인천/김포') return ['ICN', 'GMP'].includes(airport) || /서울|인천|김포/.test(flight.departure.city);
    if (departure === '부산/김해') return airport === 'PUS' || /부산|김해/.test(flight.departure.city);
    return flight.departure.city.includes(departure);
};

const searchQueryMatches = (flight: Flight, query: string) => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
    if (!normalizedQuery) return true;

    const routeMatches = [flight.departure.city, flight.arrival.city]
        .some(value => value.toLocaleLowerCase('ko-KR').includes(normalizedQuery));
    const providerMatches = [flight.airline, SOURCE_NAMES[flight.source]]
        .some(value => value.toLocaleLowerCase('ko-KR').startsWith(normalizedQuery));

    return routeMatches || providerMatches;
};

const addDays = (date: Date, days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
};

const dateKey = (date: Date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
].join('-');

const datePeriodBounds = (period: Exclude<DatePeriod, 'all' | 'custom'>, referenceDate: Date) => {
    const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    const mondayOffset = (today.getDay() + 6) % 7;
    const thisMonday = addDays(today, -mondayOffset);

    if (period === 'this-week') {
        return { start: thisMonday, endExclusive: addDays(thisMonday, 7) };
    }
    if (period === 'next-week') {
        return { start: addDays(thisMonday, 7), endExclusive: addDays(thisMonday, 14) };
    }
    if (period === 'this-month') {
        return {
            start: new Date(today.getFullYear(), today.getMonth(), 1),
            endExclusive: new Date(today.getFullYear(), today.getMonth() + 1, 1),
        };
    }
    return {
        start: new Date(today.getFullYear(), today.getMonth() + 1, 1),
        endExclusive: new Date(today.getFullYear(), today.getMonth() + 2, 1),
    };
};

const datePeriodMatches = (
    flight: Flight,
    period: DatePeriod,
    referenceDate: Date,
    customStartDate: Date | null,
    customEndDate: Date | null,
) => {
    if (period === 'all') return true;
    const departureDate = parseDate(flight.departure.date);
    if (!departureDate) return false;

    if (period === 'custom') {
        const departureKey = dateKey(departureDate);
        return (!customStartDate || departureKey >= dateKey(customStartDate))
            && (!customEndDate || departureKey <= dateKey(customEndDate));
    }

    const { start, endExclusive } = datePeriodBounds(period, referenceDate);
    return departureDate >= start && departureDate < endExclusive;
};

const recommendedScore = (flight: Flight) => {
    const discount = Math.max(0, flight.discountRate || 0);
    const seatBonus = flight.availableSeats && flight.availableSeats <= 9 ? 8 : 0;
    return effectivePrice(flight) - discount * 2_500 - seatBonus * 1_000;
};

const seoulDateKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}).format(date);

const millisecondsUntilNextSeoulDay = () => {
    const now = Date.now();
    const kstOffset = 9 * 60 * 60 * 1000;
    const seoulNow = new Date(now + kstOffset);
    const nextMidnight = Date.UTC(
        seoulNow.getUTCFullYear(),
        seoulNow.getUTCMonth(),
        seoulNow.getUTCDate() + 1,
    ) - kstOffset;
    return Math.max(1_000, nextMidnight - now + 1_000);
};

const monthDistance = (first: string, second: string) => {
    const toIndex = (value: string) => {
        const match = value.match(/^(\d{4})-(\d{2})$/);
        return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : Number.NaN;
    };
    const firstIndex = toIndex(first);
    const secondIndex = toIndex(second);
    return Number.isFinite(firstIndex) && Number.isFinite(secondIndex)
        ? Math.abs(firstIndex - secondIndex)
        : Number.POSITIVE_INFINITY;
};

const getAverageDiscountRate = (flight: Flight, benchmarks: InterparkPrices) => {
    const city = stripAirport(flight.arrival.city);
    const departureMonth = flight.departure.date
        ?.replace(/\./g, '-')
        .replace(/\(.*\)/g, '')
        .trim()
        .substring(0, 7);
    const cityPrices = benchmarks[city];
    if (!cityPrices || !departureMonth) return 0;

    let benchmark = cityPrices[departureMonth];
    if (!benchmark) {
        const closestMonth = Object.keys(cityPrices).sort().reduce((best, month) => {
            const difference = monthDistance(month, departureMonth);
            const bestDifference = best ? monthDistance(best, departureMonth) : Infinity;
            return difference < bestDifference ? month : best;
        }, '');
        if (closestMonth) benchmark = cityPrices[closestMonth];
    }
    if (!benchmark?.avg || benchmark.avg <= 0) return 0;

    const displayedPrice = flight.source === 'ttang' ? flight.price : effectivePrice(flight);
    return Math.max(0, Math.round((1 - displayedPrice / benchmark.avg) * 100));
};

const dailyOrderValue = (dateKey: string, value: string) => {
    let hash = 2166136261;
    const input = `${dateKey}:${value}`;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const clockMinutes = (value?: string) => {
    const match = value?.match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
};

const daysBetweenDates = (start?: string, end?: string) => {
    const startDate = start ? parseDate(start) : null;
    const endDate = end ? parseDate(end) : null;
    if (!startDate || !endDate) return null;
    return Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
};

const outboundArrivalTime = (flight: Flight) => (
    flight.modetourDetail?.departureArrivalTime || flight.departure.arrivalTime || ''
);

const returnDepartureTime = (flight: Flight) => (
    flight.modetourDetail?.returnDepartureTime || flight.arrival.time || ''
);

const returnArrivalTime = (flight: Flight) => (
    flight.modetourDetail?.returnArrivalTime || flight.arrival.arrivalTime || ''
);

const onsiteStayMinutes = (flight: Flight) => {
    const tripDays = daysBetweenDates(flight.departure.date, flight.arrival.date);
    const arrivalTime = outboundArrivalTime(flight);
    const returnTime = returnDepartureTime(flight);
    const arrivalMinutes = clockMinutes(arrivalTime);
    const returnMinutes = clockMinutes(returnTime);
    if (tripDays === null || arrivalMinutes === null || returnMinutes === null) return null;

    const timing = calcFlightTiming(
        departureName(flight),
        flight.departure.time,
        flight.departure.date,
        stripAirport(flight.arrival.city),
        arrivalTime,
    );
    const arrivalDayOffset = timing?.arrivalDayOffset
        ?? fallbackArrivalDayOffset(flight.departure.time, arrivalTime);
    const minutes = (tripDays - arrivalDayOffset) * 1_440 + returnMinutes - arrivalMinutes;
    return minutes >= 12 * 60 && minutes <= 10 * 24 * 60 ? minutes : null;
};

const returnArrivalDate = (flight: Flight) => {
    const returnDate = parseDate(flight.arrival.date);
    const departureTime = returnDepartureTime(flight);
    const arrivalTime = returnArrivalTime(flight);
    if (!returnDate || clockMinutes(departureTime) === null || clockMinutes(arrivalTime) === null) return null;
    const timing = calcFlightTiming(
        stripAirport(flight.arrival.city),
        departureTime,
        flight.arrival.date,
        departureName(flight),
        arrivalTime,
    );
    return addDays(returnDate, timing?.arrivalDayOffset ?? fallbackArrivalDayOffset(departureTime, arrivalTime));
};

const isZeroPtoSchedule = (flight: Flight) => {
    const departureDate = parseDate(flight.departure.date);
    const departureMinutes = clockMinutes(flight.departure.time);
    const homeArrivalDate = returnArrivalDate(flight);
    return !!departureDate
        && departureDate.getDay() === 5
        && departureMinutes !== null
        && departureMinutes >= 20 * 60
        && !!homeArrivalDate
        && homeArrivalDate.getDay() === 0;
};

const harshScheduleDetail = (flight: Flight) => {
    const outboundDeparture = clockMinutes(flight.departure.time);
    const outboundArrival = clockMinutes(outboundArrivalTime(flight));
    const inboundDeparture = clockMinutes(returnDepartureTime(flight));
    const inboundArrival = clockMinutes(returnArrivalTime(flight));
    if (outboundDeparture !== null && outboundDeparture < 7 * 60) return `가는 편 ${flight.departure.time} 출발`;
    if (outboundArrival !== null && (outboundArrival < 5 * 60 || outboundArrival >= 23 * 60)) return `가는 편 ${outboundArrivalTime(flight)} 도착`;
    if (inboundDeparture !== null && inboundDeparture < 7 * 60) return `오는 편 ${returnDepartureTime(flight)} 출발`;
    if (inboundArrival !== null && (inboundArrival < 5 * 60 || inboundArrival >= 23 * 60)) return `오는 편 ${returnArrivalTime(flight)} 도착`;
    return null;
};

const describeDropCard = (flight: Flight, averageDiscountRate = 0, trustFirst = true) => {
    const seats = flight.availableSeats || Number.parseInt(flight.seats || '', 10) || 0;
    const departureDate = parseDate(flight.departure.date);
    const today = parseDate(seoulDateKey());
    const destination = stripAirport(flight.arrival.city);
    const displayedPrice = flight.source === 'ttang' ? flight.price : effectivePrice(flight);
    const discountRate = Math.round(Math.max(0, averageDiscountRate));

    if (trustFirst) {
        if (discountRate >= 5) return '동일 목적지 월평균가 대비';
        if (seats > 0) return `현재 ${seats}석`;
        return '가격·일정을 비교해 고른 표';
    }

    const harshDetail = harshScheduleDetail(flight);
    const editorialReactions = [
        '📣 오늘 업무: 이 표 알리기',
        '🫣 이건 묻어두면 혼남',
        '📋 안 보여드리면 업무 태만',
        '🤝 담당자 전원 말없이 고개 끄덕임',
    ];
    const variant = (options: string[]) => {
        const seed = Array.from(`${flight.id}:${seoulDateKey()}`)
            .reduce((sum, character) => sum + character.charCodeAt(0), 0);
        return options[seed % options.length];
    };

    if (isZeroPtoSchedule(flight)) {
        return variant([
            '🏃 0연차 탈출 가능',
            '🗓 연차칸 비우고 출국',
            `🌙 ${flight.departure.time} 퇴근 후 출국`,
        ]);
    }

    if (departureDate && today) {
        const daysUntilDeparture = Math.round((departureDate.getTime() - today.getTime()) / 86_400_000);
        if (daysUntilDeparture === 0) return '🏃 오늘 바로 출국';
        if (daysUntilDeparture > 0 && daysUntilDeparture <= 5) {
            return variant([
                `🏃 ${daysUntilDeparture}일 뒤 출국`,
                '🧳 여행 계획 강제 생성',
                '🚧 막판에 가격이 선 넘음',
                `🧳 D-${daysUntilDeparture}, 이러면 가야 하잖아`,
                `🤷 D-${daysUntilDeparture}, 안 가기엔 너무 싸짐`,
                `🏃 D-${daysUntilDeparture}, 사람 급하게 만드는 가격`,
                `😵‍💫 D-${daysUntilDeparture}, 어쩌자고 이 가격`,
            ]);
        }
    }

    if (seats > 0 && seats <= 4) {
        return variant([
            `🎟 딱 ${seats}석 남음`,
            `🚪 문 닫히기 전 ${seats}자리`,
            '👥 친구 고를 시간 없음',
        ]);
    }

    if (displayedPrice <= 150_000) {
        const priceReactions = [
            `💸 ${compactWon(displayedPrice)}이 ${destination} 됨`,
            '🧾 왕복 맞음. 두 번 봄',
            '✈️ 편도인 척하는 왕복',
            '🤏 예산은 국내, 결과는 해외',
            '👀 왕복인데 이 숫자',
            `🧳 일정 없었는데 ${destination}`,
            '🤨 이 가격이면 얘기가 달라짐',
            '🤷 안 갈 이유가 가격을 못 이김',
            '🧲 안 가려고 해도 가격이 방해함',
            `💸 부산 갈 돈으로 ${destination}`,
            '🚄 KTX 고민하다 출국',
            ...editorialReactions,
        ];
        return variant(priceReactions);
    }

    if (displayedPrice < 170_000) return `💸 부산 갈 돈으로 ${destination}`;

    if (discountRate >= 25) {
        return variant([
            `🚨 평균가 -${discountRate}% 이탈`,
            '🧨 가격표 사고 발생',
            '🧾 숫자 하나 두고 간 듯',
            '🧮 계산기 다시 켜봄',
            '👀 왕복인데 이 숫자',
            ...(!harshDetail ? ['🕰 싼 이유를 시간표에서도 못 찾음'] : []),
            ...editorialReactions,
        ]);
    }

    const departureMinutes = clockMinutes(flight.departure.time);
    if (departureMinutes !== null && departureMinutes >= 18 * 60) {
        return variant([
            `🌙 ${flight.departure.time} 퇴근 후 출국`,
            '🗓 연차칸 비우고 출국',
            '🌙 퇴근은 한국에서, 취침은 해외에서',
        ]);
    }

    if (harshDetail) {
        const homeDate = returnArrivalDate(flight);
        return homeDate?.getDay() === 1 ? '🥱 월요일의 내가 알아서' : '🌙 가격 좋음 · 시간 험함';
    }

    const duration = tripLength(flight);
    if (duration) {
        return variant([
            `🧳 ${duration} 일정 압축`,
            '🧳 여행 계획 강제 생성',
            '📲 단톡방에 먼저 던질 표',
            '🤝 공범 찾으면 출국',
        ]);
    }

    return variant([
        `🧳 일정 없었는데 ${destination}`,
        `🪤 구경하다 ${destination} 잡힘`,
        `📍 검색 안 했는데 ${destination}`,
        '🛫 표가 먼저 가자고 함',
        '🫣 안 가도 일단 공유',
    ]);
};

const compactDropCardMessage = (message: string) => message
    .replace('담당자 전원 말없이 고개 끄덕임', '전원 말없이 고개 끄덕임')
    .replace('퇴근은 한국에서, 취침은 해외에서', '한국서 퇴근, 해외서 취침')
    .replace('싼 이유를 시간표에서도 못 찾음', '싼 이유, 시간표에도 없음')
    .replace('사람 급하게 만드는 가격', '사람 급하게 만듦')
    .replace('안 가려고 해도 가격이 방해함', '안 가려는데 가격이 방해함');

function Icon({ name }: { name: 'sliders' | 'search' | 'star' | 'bookmark' | 'share' | 'close' | 'arrow' | 'plane' | 'up' | 'chevron' }) {
    const paths = {
        sliders: <><line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="15" cy="17" r="2" /></>,
        search: <><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></>,
        star: <polygon points="12 2.8 14.8 8.5 21.1 9.4 16.5 13.9 17.6 20.2 12 17.2 6.4 20.2 7.5 13.9 2.9 9.4 9.2 8.5 12 2.8" />,
        bookmark: <path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v16l-6.5-4-6.5 4V5A1.5 1.5 0 0 1 7 3.5Z" />,
        share: <><path d="M4 12v8h16v-8" /><polyline points="8 7 12 3 16 7" /><line x1="12" y1="3" x2="12" y2="15" /></>,
        close: <><line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" /></>,
        arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="14 7 19 12 14 17" /></>,
        plane: <path d="M22 12c0-.6-.5-1.1-1.1-1.2l-6.4-.9-3.8-6.2C10.4 3.3 10 3 9.4 3H8.1l2.2 7.3-4.8.7-1.8-2H2.2l1 3-1 3h1.5l1.8-2 4.8.7L8.1 21h1.3c.6 0 1-.3 1.3-.7l3.8-6.2 6.4-.9c.6-.1 1.1-.6 1.1-1.2Z" />,
        up: <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="6.5 10.5 12 5 17.5 10.5" /></>,
        chevron: <polyline points="7 9 12 14 17 9" />,
    };
    return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

const SERVICE_UPDATE_NOTICE_KEY = 'tikitikit-service-update-20260901-fuel-surcharge-v2';
// Push alerts stay implemented while the public entry points remain hidden until
// account-linked delivery history and device recovery are ready.
const PUBLIC_DEAL_ALERTS_ENABLED = false;
const GENERAL_SHARE_COPY = [
    '🎫 오늘의 이상한 표',
    '👀 가격이 좀 이상함',
    '👀 이건 한 번 봐야 함',
];
const EMERGENCY_SHARE_COPY = [
    '🚨 비상!! 비상!!',
    '🏆 오늘의 이상한 가격',
    '🕳 가격에 구멍 남',
    '🤯 담당자가 미쳤어요',
];

export default function MobileRedesignPreview({
    previewMode = true,
    beforeFooter,
    rootAs = 'main',
    initialFlights = [],
    initialFlightCount = 0,
    initialLastUpdated = null,
    initialTodayPickId = null,
}: MobileRedesignPreviewProps) {
    const account = useAccount();
    const hasInitialFlights = initialFlights.length > 0;
    const [flights, setFlights] = useState<Flight[]>(initialFlights);
    const [loading, setLoading] = useState(!hasInitialFlights);
    const [initialListSyncing, setInitialListSyncing] = useState(hasInitialFlights);
    const [error, setError] = useState('');
    const [lastUpdated, setLastUpdated] = useState<string | null>(initialLastUpdated);
    const [todayPickId, setTodayPickId] = useState<string | null>(initialTodayPickId);
    const [todayPickRepeatOverride, setTodayPickRepeatOverride] = useState<TodayPickRepeatOverride | null>(null);
    const [priceHistory, setPriceHistory] = useState<PriceHistory>({});
    const [interparkPrices, setInterparkPrices] = useState<InterparkPrices>({});
    const [initialSubsetActive, setInitialSubsetActive] = useState(
        hasInitialFlights && initialFlightCount > initialFlights.length,
    );
    const [passengers, setPassengers] = useState({ adult: 1, child: 0, infant: 0 });
    const [region, setRegion] = useState('전체');
    const [departure, setDeparture] = useState('전체');
    const [sourceFilter, setSourceFilter] = useState<'all' | Flight['source']>('all');
    const [airlineFilter, setAirlineFilter] = useState('all');
    const [datePeriod, setDatePeriod] = useState<DatePeriod>('all');
    const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
    const [customEndDate, setCustomEndDate] = useState<Date | null>(null);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [maxPrice, setMaxPrice] = useState(0);
    const [sort, setSort] = useState<SortMode>('recommended');
    const [sortOpen, setSortOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [recentSearches, setRecentSearches] = useState<string[]>([]);
    const [desktopSearchFocused, setDesktopSearchFocused] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    const [filterPopoverPosition, setFilterPopoverPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
    const [airlineMenuOpen, setAirlineMenuOpen] = useState(false);
    const [desktopFilterOpen, setDesktopFilterOpen] = useState<DesktopFilterKey | null>(null);
    const [regionMoreOpen, setRegionMoreOpen] = useState(false);
    const [showDealAlert, setShowDealAlert] = useState(false);
    const [alertRouteTarget, setAlertRouteTarget] = useState<RouteAlertTarget | null>(null);
    const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [guestFavorites, setGuestFavorites] = useState<Set<string>>(new Set());
    const [flightReport, setFlightReport] = useState<{ flightId: string; status: FlightReportStatus } | null>(null);
    const [recentFlightReports, setRecentFlightReports] = useState<Record<string, number>>({});
    const [visibleCount, setVisibleCount] = useState(18);
    const [toast, setToast] = useState('');
    const [expiredShareNotice, setExpiredShareNotice] = useState<{ arrival: string | null } | null>(null);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [detailHasMoreBelow, setDetailHasMoreBelow] = useState(false);
    const [detailHasScrolled, setDetailHasScrolled] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [isDesktopViewport, setIsDesktopViewport] = useState(false);
    const [filterBarPinned, setFilterBarPinned] = useState(false);
    const [showAccount, setShowAccount] = useState(false);
    const [showContact, setShowContact] = useState(false);
    const [showServiceUpdate, setShowServiceUpdate] = useState(false);
    const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });
    const [contactStatus, setContactStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [contactMessage, setContactMessage] = useState('');
    const [insightDateKey, setInsightDateKey] = useState(() => seoulDateKey());
    const [keyboardNavigation, setKeyboardNavigation] = useState(false);
    const [freshMobilePosition, setFreshMobilePosition] = useState(1);
    const [freshMobileDragOffset, setFreshMobileDragOffset] = useState(0);
    const [freshMobileAnimating, setFreshMobileAnimating] = useState(true);
    const [freshMobileReduceMotion, setFreshMobileReduceMotion] = useState(false);
    const [freshDesktopPosition, setFreshDesktopPosition] = useState(1);
    const [freshDesktopDragOffset, setFreshDesktopDragOffset] = useState(0);
    const [freshDesktopAnimating, setFreshDesktopAnimating] = useState(true);
    const [freshDesktopDragging, setFreshDesktopDragging] = useState(false);
    const [freshRouteResults, setFreshRouteResults] = useState<FreshRouteResults | null>(null);
    const filterBarSlotRef = useRef<HTMLDivElement | null>(null);
    const feedSectionRef = useRef<HTMLElement | null>(null);
    const desktopFilterRef = useRef<HTMLDivElement | null>(null);
    const desktopFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
    const sortMenuRef = useRef<HTMLDivElement | null>(null);
    const sortTriggerRef = useRef<HTMLButtonElement | null>(null);
    const searchButtonRef = useRef<HTMLButtonElement | null>(null);
    const mergedAccountRef = useRef<string | null>(null);
    const favoriteMutationVersionRef = useRef(new Map<string, number>());
    const favoriteIntentRef = useRef(new Map<string, boolean>());
    const confirmedAccountFavoritesRef = useRef(new Set<string>());
    const impressionObserverRef = useRef<IntersectionObserver | null>(null);
    const impressionPayloadsRef = useRef(new Map<Element, gtag.FlightImpressionDetails>());
    const impressionTimersRef = useRef(new Map<Element, ReturnType<typeof setTimeout>>());
    const recordedImpressionsRef = useRef(new Set<string>());
    const lastTrackedDestinationSearchRef = useRef<string | null>(null);
    const historyClosePendingRef = useRef(false);
    const alertClosePendingRef = useRef(false);
    const lastFetchAtRef = useRef(0);
    const urlInitializedRef = useRef(false);
    const freshMobileDragRef = useRef<FreshMobileDragState | null>(null);
    const freshMobileSuppressClickRef = useRef(false);
    const freshDesktopDragRef = useRef<FreshDesktopDragState | null>(null);
    const freshDesktopSuppressClickRef = useRef(false);
    const freshRouteOriginScrollRef = useRef(0);
    const sharedFlightIdRef = useRef<string | null>(null);
    const sharedFlightScheduleRef = useRef<string | null>(null);
    const sharedFallbackArrivalRef = useRef<string | null>(null);
    const filterDialogRef = useRef<HTMLElement | null>(null);
    const detailDialogRef = useRef<HTMLElement | null>(null);
    const contactDialogRef = useRef<HTMLElement | null>(null);
    const serviceUpdateDialogRef = useRef<HTMLElement | null>(null);
    const historyUiStateRef = useRef({
        selectedFlight,
        showDealAlert,
        flights,
        loading,
    });
    historyUiStateRef.current = {
        selectedFlight,
        showDealAlert,
        flights,
        loading,
    };

    const Root = rootAs;
    const activeOverlay = showAccount ? 'account'
        : showServiceUpdate ? 'service-update'
            : showContact ? 'contact'
                : showDealAlert ? 'deal-alert'
                    : selectedFlight ? 'flight'
                        : filterOpen ? 'filter'
                            : null;

    const closeServiceUpdate = useCallback(() => {
        setShowServiceUpdate(false);
    }, []);

    const dismissServiceUpdate = useCallback(() => {
        closeServiceUpdate();
        try {
            window.localStorage.setItem(SERVICE_UPDATE_NOTICE_KEY, 'dismissed');
        } catch { }
    }, [closeServiceUpdate]);

    const openFilter = useCallback(() => {
        showOverlayWithHistory('filter', () => setFilterOpen(true));
    }, []);
    const closeFilter = useCallback(() => {
        dismissOverlayWithHistory('filter', () => setFilterOpen(false));
    }, []);
    const openAccount = useCallback(() => {
        showOverlayWithHistory('account', () => setShowAccount(true));
    }, []);
    const closeAccount = useCallback(() => {
        dismissOverlayWithHistory('account', () => setShowAccount(false));
    }, []);
    const openContact = useCallback(() => {
        setContactStatus('idle');
        setContactMessage('');
        showOverlayWithHistory('contact', () => setShowContact(true));
    }, []);
    const closeContact = useCallback(() => {
        dismissOverlayWithHistory('contact', () => setShowContact(false));
    }, []);

    const rememberSearch = useCallback((value: string) => {
        const search = value.trim();
        if (!search) return;
        const normalizedSearch = normalizeCity(search);
        const matchingFlights = flights.filter(flight => normalizeCity(flight.arrival.city) === normalizedSearch);
        if (matchingFlights.length > 0 && lastTrackedDestinationSearchRef.current !== normalizedSearch) {
            lastTrackedDestinationSearchRef.current = normalizedSearch;
            gtag.trackDestinationSearch(normalizedSearch, matchingFlights.length);
        }
        setRecentSearches(current => {
            const normalized = search.toLocaleLowerCase('ko-KR');
            const next = [
                search,
                ...current.filter(item => item.toLocaleLowerCase('ko-KR') !== normalized),
            ].slice(0, 6);
            try { window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)); } catch { }
            return next;
        });
    }, [flights]);

    const removeRecentSearch = useCallback((value: string) => {
        setRecentSearches(current => {
            const next = current.filter(item => item !== value);
            try {
                if (next.length) window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
                else window.localStorage.removeItem(RECENT_SEARCHES_KEY);
            } catch { }
            return next;
        });
    }, []);

    const clearRecentSearches = useCallback(() => {
        setRecentSearches([]);
        try { window.localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { }
    }, []);

    const closeSelectedFlight = useCallback(() => {
        if (window.history.state?.tikitikitOverlay === 'flight') {
            if (historyClosePendingRef.current) return;
            historyClosePendingRef.current = true;
            window.history.back();
            return;
        }
        setSelectedFlight(null);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('flight');
        nextUrl.searchParams.delete('schedule');
        const nextState = { ...window.history.state };
        delete nextState.tikitikitOverlay;
        window.history.replaceState(nextState, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }, []);

    const openDealAlert = useCallback((target: RouteAlertTarget | null) => {
        setAlertRouteTarget(target);
        if (window.history.state?.tikitikitOverlay !== 'deal-alert') {
            window.history.pushState(
                {
                    ...window.history.state,
                    tikitikitOverlay: 'deal-alert',
                    tikitikitAlertTarget: target,
                },
                '',
                `${window.location.pathname}${window.location.search}${window.location.hash}`,
            );
        }
        setShowDealAlert(true);
    }, []);

    const closeDealAlert = useCallback(() => {
        if (window.history.state?.tikitikitOverlay === 'deal-alert') {
            if (alertClosePendingRef.current) return;
            alertClosePendingRef.current = true;
            window.history.back();
            return;
        }
        setShowDealAlert(false);
        setAlertRouteTarget(null);
    }, []);

    const filterSwipe = useSwipeToDismiss({
        open: filterOpen,
        sheetRef: filterDialogRef,
        onDismiss: closeFilter,
    });
    const detailSwipe = useSwipeToDismiss({
        open: Boolean(selectedFlight),
        sheetRef: detailDialogRef,
        onDismiss: closeSelectedFlight,
    });

    useEffect(() => {
        const detailSheet = detailDialogRef.current;
        if (!selectedFlight || !detailSheet) {
            setDetailHasMoreBelow(false);
            setDetailHasScrolled(false);
            return;
        }

        detailSheet.scrollTop = 0;
        const updateDetailScrollHint = () => {
            const remainingScroll = detailSheet.scrollHeight - detailSheet.scrollTop - detailSheet.clientHeight;
            setDetailHasMoreBelow(remainingScroll > 24);
            setDetailHasScrolled(detailSheet.scrollTop > 8);
        };
        const firstCheck = window.requestAnimationFrame(updateDetailScrollHint);
        const settledCheck = window.setTimeout(updateDetailScrollHint, 120);
        const resizeObserver = new ResizeObserver(updateDetailScrollHint);

        resizeObserver.observe(detailSheet);
        detailSheet.addEventListener('scroll', updateDetailScrollHint, { passive: true });
        window.addEventListener('resize', updateDetailScrollHint);
        return () => {
            window.cancelAnimationFrame(firstCheck);
            window.clearTimeout(settledCheck);
            resizeObserver.disconnect();
            detailSheet.removeEventListener('scroll', updateDetailScrollHint);
            window.removeEventListener('resize', updateDetailScrollHint);
        };
    }, [selectedFlight]);
    const serviceUpdateSwipe = useSwipeToDismiss({
        open: showServiceUpdate,
        sheetRef: serviceUpdateDialogRef,
        onDismiss: closeServiceUpdate,
    });
    const contactSwipe = useSwipeToDismiss({
        open: showContact,
        sheetRef: contactDialogRef,
        onDismiss: closeContact,
    });

    const loadFlights = useCallback(async (background = false) => {
        if (!background) setLoading(true);
        try {
            const flightsApi = previewMode ? '/api/preview-flights' : '/api/flights';
            const response = await fetch(`${flightsApi}?sortBy=price&sortOrder=asc`, { cache: 'no-store' });
            if (!response.ok) throw new Error('항공권을 불러오지 못했습니다.');
            const data = await response.json() as FlightsResponse;
            if (!data.success) throw new Error('항공권을 불러오지 못했습니다.');
            setLastUpdated(data.lastUpdated || null);
            setInsightDateKey(data.lastUpdated ? seoulDateKey(new Date(data.lastUpdated)) : seoulDateKey());
            const hasCurrentTodayPick = data.todayPickDate === seoulDateKey()
                && typeof data.todayPickId === 'string';
            setTodayPickId(hasCurrentTodayPick ? data.todayPickId! : null);
            setTodayPickRepeatOverride(hasCurrentTodayPick ? data.todayPickRepeatOverride || null : null);
            setPriceHistory(data.priceHistory || {});
            setInterparkPrices(data.interparkPrices || {});
            // 추천·DROP 판단에 필요한 기준가를 먼저 넣은 뒤 목록을 연다. 상태 반영이
            // 나뉘는 브라우저에서도 첫 카드가 잠깐 다른 표로 보이지 않게 한다.
            setFlights(data.flights || []);
            setInitialSubsetActive(false);
            setError('');
            lastFetchAtRef.current = Date.now();
        } catch (cause) {
            if (!background) setError(cause instanceof Error ? cause.message : '항공권을 불러오지 못했습니다.');
        } finally {
            // 정적 첫 목록과 운영 API의 필터 결과가 다를 수 있으므로 최초 동기화가
            // 끝나기 전에는 정적 카드 대신 스켈레톤만 보여준다.
            setInitialListSyncing(false);
            if (!background) setLoading(false);
        }
    }, [previewMode]);

    useEffect(() => {
        void loadFlights(hasInitialFlights);
        const refreshTimer = window.setInterval(() => void loadFlights(true), 30 * 60 * 1000);
        const refreshVisiblePage = () => {
            if (document.visibilityState === 'visible' && Date.now() - lastFetchAtRef.current > 5 * 60 * 1000) {
                void loadFlights(true);
            }
        };
        document.addEventListener('visibilitychange', refreshVisiblePage);
        return () => {
            window.clearInterval(refreshTimer);
            document.removeEventListener('visibilitychange', refreshVisiblePage);
        };
    }, [hasInitialFlights, loadFlights]);

    useEffect(() => {
        let midnightTimer = 0;
        const expireTodayPickAtMidnight = () => {
            midnightTimer = window.setTimeout(() => {
                setTodayPickId(null);
                setTodayPickRepeatOverride(null);
                void loadFlights(true);
                expireTodayPickAtMidnight();
            }, millisecondsUntilNextSeoulDay());
        };
        expireTodayPickAtMidnight();
        return () => window.clearTimeout(midnightTimer);
    }, [loadFlights]);

    useEffect(() => {
        if (previewMode) return;
        try {
            if (window.localStorage.getItem(SERVICE_UPDATE_NOTICE_KEY) !== 'dismissed') {
                setShowServiceUpdate(true);
            }
        } catch {
            setShowServiceUpdate(true);
        }
    }, [previewMode]);

    useEffect(() => {
        try {
            const saved = JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
            if (Array.isArray(saved)) {
                setRecentSearches(saved.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 6));
            }
        } catch { }
    }, []);

    useEffect(() => {
        if (!filterOpen) setAirlineMenuOpen(false);
    }, [filterOpen]);

    useEffect(() => {
        if (!searchOpen) return;
        const closeSearchWithKeyboard = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setSearchOpen(false);
            window.requestAnimationFrame(() => searchButtonRef.current?.focus());
        };
        window.addEventListener('keydown', closeSearchWithKeyboard);
        return () => window.removeEventListener('keydown', closeSearchWithKeyboard);
    }, [searchOpen]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const requestedFlight = params.get('flight');
        sharedFlightIdRef.current = requestedFlight;
        sharedFlightScheduleRef.current = params.get('schedule');
        sharedFallbackArrivalRef.current = params.get('arr');

        const departureParam = params.get('dep');
        if (/인천|김포|서울|ICN|GMP|SEL/i.test(departureParam || '')) setDeparture('인천/김포');
        else if (/부산|김해|PUS/i.test(departureParam || '')) setDeparture('부산/김해');
        else if (/대구|TAE/i.test(departureParam || '')) setDeparture('대구');
        else if (/청주|CJJ/i.test(departureParam || '')) setDeparture('청주');
        else if (/제주|CJU/i.test(departureParam || '')) setDeparture('제주');

        const regionParam = params.get('region');
        if (regionParam) setRegion(regionParam === '중국' ? '중화권' : REGION_OPTIONS.includes(regionParam) ? regionParam : '전체');
        const queryParam = params.get('q');
        if (queryParam) setQuery(queryParam);
        const sourceParam = params.get('source');
        if (SOURCE_OPTIONS.some(option => option.value === sourceParam)) setSourceFilter(sourceParam as 'all' | Flight['source']);
        const airlineParam = params.get('airline');
        if (airlineParam) setAirlineFilter(airlineParam);
        const sortParam = params.get('sort');
        if (sortParam === 'price' || sortParam === 'date' || sortParam === 'recommended') setSort(sortParam);
        const maxParam = Number(params.get('max'));
        if (Number.isFinite(maxParam) && maxParam > 0) setMaxPrice(maxParam);

        const startParam = params.get('from');
        const endParam = params.get('to');
        const periodParam = params.get('period') as DatePeriod | null;
        if (startParam) {
            setDatePeriod('custom');
            setCustomStartDate(parseDate(startParam));
            setCustomEndDate(endParam ? parseDate(endParam) : null);
        } else if (periodParam && DATE_PERIOD_OPTIONS.some(option => option.value === periodParam)) {
            setDatePeriod(periodParam);
        }

        if (PUBLIC_DEAL_ALERTS_ENABLED && params.get('dealAlert') === '1') openDealAlert(null);
        const campaign = params.get('utm_campaign') || '';
        if (params.get('utm_source') === 'naver_blog' && /^tikitikit_drop_\d+$/.test(campaign)) {
            const content = params.get('utm_content');
            if (content === 'drop_deal') gtag.trackBlogLinkOpen('flight', campaign);
            if (content === 'alert_cta') gtag.trackBlogLinkOpen('alert', campaign);
        }

        const readyTimer = window.setTimeout(() => { urlInitializedRef.current = true; }, 0);
        return () => window.clearTimeout(readyTimer);
    }, [openDealAlert]);

    useEffect(() => {
        if (loading || !sharedFlightIdRef.current) return;
        // 서버가 먼저 내려준 일부 목록만 보고 딥링크 항공권을 만료 처리하지 않는다.
        // 전체 목록 갱신이 끝난 뒤 정확한 ID와 일정으로 상세를 연다.
        if (initialSubsetActive) return;
        const flightId = sharedFlightIdRef.current;
        const scheduleToken = sharedFlightScheduleRef.current;
        sharedFlightIdRef.current = null;
        sharedFlightScheduleRef.current = null;
        const sharedFlight = flights.find(flight => (
            flight.id === flightId
            && (!scheduleToken || flightScheduleToken(flight) === scheduleToken)
        )) || flights.find(flight => flight.id === flightId);
        if (sharedFlight) {
            gtag.trackDetailOpen(
                `${normalizeCity(sharedFlight.departure.city)}-${normalizeCity(sharedFlight.arrival.city)}`,
                effectivePrice(sharedFlight),
                sharedFlight.source,
                'shared_link',
                {
                    flightId: sharedFlight.id,
                    destination: stripAirport(sharedFlight.arrival.city),
                },
            );
            account.recordRecent(sharedFlight.id);
            setPassengers({ adult: Math.max(1, sharedFlight.minPax || 1), child: 0, infant: 0 });
            setSelectedFlight(sharedFlight);
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const fallbackArrival = sharedFallbackArrivalRef.current || params.get('arr');
        sharedFallbackArrivalRef.current = null;
        if (fallbackArrival) setQuery(fallbackArrival);
        params.delete('flight');
        params.delete('schedule');
        const queryString = params.toString();
        const nextState = { ...window.history.state };
        delete nextState.tikitikitOverlay;
        window.history.replaceState(
            nextState,
            '',
            `${window.location.pathname}${queryString ? `?${queryString}` : ''}${window.location.hash}`,
        );
        setExpiredShareNotice({ arrival: fallbackArrival });
    }, [account, flights, initialSubsetActive, loading]);

    useEffect(() => {
        if (!urlInitializedRef.current) return;
        const current = new URLSearchParams(window.location.search);
        const next = new URLSearchParams();
        for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
            const value = current.get(key);
            if (value) next.set(key, value);
        }
        if (query.trim()) next.set('q', query.trim());
        if (departure !== '전체') next.set('dep', departure.replace('/김포', '').replace('/김해', ''));
        if (region !== '전체') next.set('region', region);
        if (sourceFilter !== 'all') next.set('source', sourceFilter);
        if (airlineFilter !== 'all') next.set('airline', airlineFilter);
        if (sort !== 'recommended') next.set('sort', sort);
        if (maxPrice > 0) next.set('max', String(maxPrice));
        if (datePeriod === 'custom' && customStartDate) {
            next.set('from', dateKey(customStartDate));
            if (customEndDate) next.set('to', dateKey(customEndDate));
        } else if (datePeriod !== 'all') {
            next.set('period', datePeriod);
        }
        if (selectedFlight) {
            next.set('flight', selectedFlight.id);
            next.set('schedule', flightScheduleToken(selectedFlight));
        }
        const queryString = next.toString();
        window.history.replaceState(
            window.history.state,
            '',
            `${window.location.pathname}${queryString ? `?${queryString}` : ''}`,
        );
    }, [airlineFilter, customEndDate, customStartDate, datePeriod, departure, maxPrice, query, region, selectedFlight, sort, sourceFilter]);

    useEffect(() => {
        const syncDetailFromHistory = () => {
            const historyUi = historyUiStateRef.current;
            const overlay = historyOverlay();
            setFilterOpen(overlay === 'filter');
            setShowAccount(overlay === 'account');
            setShowContact(overlay === 'contact');
            if (window.history.state?.tikitikitOverlay === 'deal-alert') {
                alertClosePendingRef.current = false;
                setAlertRouteTarget(window.history.state?.tikitikitAlertTarget || null);
                setShowDealAlert(true);
                return;
            }
            if (historyUi.showDealAlert) {
                alertClosePendingRef.current = false;
                historyClosePendingRef.current = false;
                setShowDealAlert(false);
                setAlertRouteTarget(null);
                return;
            }
            historyClosePendingRef.current = false;
            const params = new URLSearchParams(window.location.search);
            const flightId = params.get('flight');
            const scheduleToken = params.get('schedule');
            if (!flightId) {
                setSelectedFlight(null);
                return;
            }
            const flight = historyUi.flights.find(item => (
                item.id === flightId
                && (!scheduleToken || flightScheduleToken(item) === scheduleToken)
            )) || historyUi.flights.find(item => item.id === flightId);
            if (!flight) {
                if (historyUi.loading) {
                    sharedFlightIdRef.current = flightId;
                    sharedFlightScheduleRef.current = scheduleToken;
                    return;
                }
                setSelectedFlight(null);
                const nextUrl = new URL(window.location.href);
                nextUrl.searchParams.delete('flight');
                nextUrl.searchParams.delete('schedule');
                const nextState = { ...window.history.state };
                delete nextState.tikitikitOverlay;
                window.history.replaceState(nextState, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
                setToast('이 표는 현재 목록에서 내려갔어요.');
                return;
            }
            setPassengers({ adult: Math.max(1, flight.minPax || 1), child: 0, infant: 0 });
            setSelectedFlight(flight);
        };
        window.addEventListener('popstate', syncDetailFromHistory);
        return () => window.removeEventListener('popstate', syncDetailFromHistory);
    }, []);

    useEffect(() => {
        if (!selectedFlight || loading) return;
        const selectedSchedule = flightScheduleIdentity(selectedFlight);
        const refreshedFlight = flights.find(flight => flightScheduleIdentity(flight) === selectedSchedule)
            || flights.find(flight => flight.id === selectedFlight.id);
        if (refreshedFlight) {
            if (refreshedFlight !== selectedFlight) setSelectedFlight(refreshedFlight);
            return;
        }
        if (showDealAlert) {
            closeDealAlert();
            return;
        }
        closeSelectedFlight();
        setToast('이 표는 방금 현재 목록에서 내려갔어요.');
    }, [closeDealAlert, closeSelectedFlight, flights, loading, selectedFlight, showDealAlert]);

    useEffect(() => {
        if (!desktopFilterOpen) return;
        const closeDesktopFilter = (event: PointerEvent) => {
            if (!desktopFilterRef.current?.contains(event.target as Node)) {
                setDesktopFilterOpen(null);
                setCalendarOpen(false);
            }
        };
        const closeDesktopFilterWithKeyboard = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setDesktopFilterOpen(null);
                setCalendarOpen(false);
                window.requestAnimationFrame(() => desktopFilterTriggerRef.current?.focus());
            }
        };
        document.addEventListener('pointerdown', closeDesktopFilter);
        document.addEventListener('keydown', closeDesktopFilterWithKeyboard);
        return () => {
            document.removeEventListener('pointerdown', closeDesktopFilter);
            document.removeEventListener('keydown', closeDesktopFilterWithKeyboard);
        };
    }, [desktopFilterOpen]);

    useEffect(() => {
        if (!sortOpen) return;
        const closeSortMenu = (event: PointerEvent) => {
            if (!sortMenuRef.current?.contains(event.target as Node)) setSortOpen(false);
        };
        const closeSortMenuWithKeyboard = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setSortOpen(false);
                window.requestAnimationFrame(() => sortTriggerRef.current?.focus());
            }
        };
        document.addEventListener('pointerdown', closeSortMenu);
        document.addEventListener('keydown', closeSortMenuWithKeyboard);
        return () => {
            document.removeEventListener('pointerdown', closeSortMenu);
            document.removeEventListener('keydown', closeSortMenuWithKeyboard);
        };
    }, [sortOpen]);

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('favoriteFlights') || '[]');
            if (Array.isArray(saved)) {
                const ids = new Set<string>(saved.filter(id => typeof id === 'string'));
                setGuestFavorites(ids);
            }
        } catch { }
    }, []);

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(RECENT_FLIGHT_REPORTS_KEY) || '{}') as Record<string, number>;
            const cutoff = Date.now() - FLIGHT_REPORT_TTL_MS;
            const recent = Object.fromEntries(Object.entries(saved).filter(([, reportedAt]) => Number(reportedAt) >= cutoff));
            setRecentFlightReports(recent);
            localStorage.setItem(RECENT_FLIGHT_REPORTS_KEY, JSON.stringify(recent));
        } catch { }
    }, []);

    const accountFavoriteKey = account.favoriteIds.slice().sort().join('\u0000');

    useEffect(() => {
        if (account.status !== 'authenticated') {
            if (account.status === 'anonymous' || account.status === 'unavailable') {
                mergedAccountRef.current = null;
                favoriteIntentRef.current.clear();
                favoriteMutationVersionRef.current.clear();
                confirmedAccountFavoritesRef.current.clear();
                setFavorites(new Set());
            }
            return;
        }

        const accountIds = accountFavoriteKey ? accountFavoriteKey.split('\u0000') : [];
        confirmedAccountFavoritesRef.current = new Set(accountIds);
        const applyPendingIntents = (baseIds: string[]) => {
            const next = new Set(baseIds);
            favoriteIntentRef.current.forEach((favorite, flightId) => {
                if (favorite) next.add(flightId);
                else next.delete(flightId);
            });
            return next;
        };
        if (!account.email) return;
        if (mergedAccountRef.current === account.email) {
            setFavorites(applyPendingIntents([...accountIds, ...Array.from(guestFavorites)]));
            return;
        }

        mergedAccountRef.current = account.email;
        const guestIds = Array.from(guestFavorites);
        const mergeAccountEmail = account.email;
        setFavorites(applyPendingIntents([...guestIds, ...accountIds]));
        if (!guestIds.length) return;

        void account.mergeLocalFavorites(guestIds).then(result => {
            if (!result.completed) return;
            if (mergedAccountRef.current !== mergeAccountEmail) return;
            const mergedSet = new Set(result.mergedFlightIds);
            setGuestFavorites(current => {
                const next = new Set(Array.from(current).filter(id => !mergedSet.has(id)));
                try {
                    if (next.size) localStorage.setItem('favoriteFlights', JSON.stringify(Array.from(next)));
                    else localStorage.removeItem('favoriteFlights');
                } catch { }
                return next;
            });
        }).catch(() => {
            mergedAccountRef.current = null;
            setToast('이 기기의 찜을 계정으로 옮기지 못했어요. 잠시 후 다시 시도해주세요.');
        });
    }, [account.email, account.status, accountFavoriteKey, account.mergeLocalFavorites, guestFavorites]);

    useEffect(() => {
        setIsMobile(checkIsMobile());
    }, []);

    useEffect(() => {
        const media = window.matchMedia('(min-width: 960px)');
        const updateViewport = () => setIsDesktopViewport(media.matches);
        updateViewport();
        media.addEventListener('change', updateViewport);
        return () => media.removeEventListener('change', updateViewport);
    }, []);

    useEffect(() => {
        const weekendPreview = window.location.hash === '#weekend-flights-insight';
        setVisibleCount(weekendPreview || window.matchMedia('(min-width: 960px)').matches ? 36 : 18);
    }, [airlineFilter, region, departure, datePeriod, customStartDate, customEndDate, maxPrice, sort, query, sourceFilter]);

    useEffect(() => {
        setFreshRouteResults(null);
    }, [airlineFilter, region, departure, datePeriod, customStartDate, customEndDate, maxPrice, query, sourceFilter]);

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(''), 2400);
        return () => window.clearTimeout(timer);
    }, [toast]);

    useEffect(() => {
        const updateScrollState = () => {
            const scrollY = Math.max(0, window.scrollY);
            setShowScrollTop(scrollY > Math.max(900, window.innerHeight * 1.25));
            const filterTop = filterBarSlotRef.current?.getBoundingClientRect().top;
            const isPastFilters = typeof filterTop === 'number' && filterTop <= 0;
            setFilterBarPinned(isPastFilters);
        };
        updateScrollState();
        window.addEventListener('scroll', updateScrollState, { passive: true });
        window.addEventListener('resize', updateScrollState);
        return () => {
            window.removeEventListener('scroll', updateScrollState);
            window.removeEventListener('resize', updateScrollState);
        };
    }, []);

    const uniqueAirlines = useMemo(() => Array.from(new Set(
        flights.map(flight => normalizeAirline(flight.airline)).filter(Boolean),
    )).sort((a, b) => a.localeCompare(b, 'ko')), [flights]);

    const recommendationScoreState = useMemo(
        () => buildRecommendationScoreState(flights, interparkPrices, Date.now(), priceHistory),
        [flights, interparkPrices, priceHistory],
    );
    const recommendationScores = recommendationScoreState.scores;

    const compareRecommended = useCallback((a: Flight, b: Flight) => {
        return compareRecommendedFlights(
            a,
            b,
            recommendationScores,
            Date.now(),
            recommendationScoreState.explanations,
        );
    }, [recommendationScoreState, recommendationScores]);

    const filteredFlights = useMemo(() => {
        const referenceDate = new Date();
        const result = flights.filter(flight => {
            const matchesQuery = searchQueryMatches(flight, query);
            return matchesQuery
                && regionMatches(flight, region)
                && departureMatches(flight, departure)
                && (sourceFilter === 'all' || flight.source === sourceFilter)
                && (airlineFilter === 'all' || normalizeAirline(flight.airline) === airlineFilter)
                && datePeriodMatches(flight, datePeriod, referenceDate, customStartDate, customEndDate)
                && (!maxPrice || effectivePrice(flight) <= maxPrice);
        });

        return result.sort((a, b) => {
            if (sort === 'price') return effectivePrice(a) - effectivePrice(b);
            if (sort === 'date') return (parseDate(a.departure.date)?.getTime() || 0) - (parseDate(b.departure.date)?.getTime() || 0);
            return compareRecommended(a, b);
        });
    }, [airlineFilter, compareRecommended, customEndDate, customStartDate, datePeriod, departure, flights, maxPrice, query, region, sort, sourceFilter]);

    const isDefaultView = region === '전체'
        && departure === '전체'
        && sourceFilter === 'all'
        && airlineFilter === 'all'
        && datePeriod === 'all'
        && !maxPrice
        && !query.trim()
        && sort === 'recommended';
    const featuredPick = useMemo(() => (
        (() => {
            // API가 KST 날짜를 확인해 오늘 선정된 ID만 내려준다. 선정되지 않았거나
            // 자정이 지나 ID가 사라지면 임의의 항공권으로 DROP 자리를 채우지 않는다.
            const fixedTodayPick = flights.find(item => item.id === todayPickId);
            if (!fixedTodayPick) return null;
            const repeatPriceDropReason = fixedTodayPick
                && todayPickRepeatOverride?.dropAmount
                ? `어제보다 ${todayPickRepeatOverride.dropAmount >= 10_000
                    ? compactWon(todayPickRepeatOverride.dropAmount)
                    : priceText(todayPickRepeatOverride.dropAmount)} 내려 다시 선정`
                : null;
            return {
                flight: fixedTodayPick,
                reason: repeatPriceDropReason || describeDropCard(fixedTodayPick, getAverageDiscountRate(fixedTodayPick, interparkPrices)),
                repeatPriceDrop: Boolean(repeatPriceDropReason),
            };
        })()
    ), [flights, interparkPrices, todayPickId, todayPickRepeatOverride]);
    const displayedFlights = useMemo(() => {
        const pinnedFlight = isDefaultView ? featuredPick?.flight : undefined;
        const presentation = buildRecommendationPresentation(
            filteredFlights,
            recommendationScoreState,
            {
                pinnedFlight,
                diversify: sort === 'recommended' && !query.trim(),
                balanceIncheon: departure === '전체',
            },
        );
        return pinnedFlight
            ? [pinnedFlight, ...presentation.orderedFlights]
            : presentation.orderedFlights;
    }, [departure, featuredPick, filteredFlights, isDefaultView, query, recommendationScoreState, sort]);
    const weeklyDiscoveryFlights = useMemo(() => flights
        .filter(flight => normalizeCity(flight.arrival.city) === '리장' && effectivePrice(flight) > 0)
        .sort((a, b) => effectivePrice(a) - effectivePrice(b) || a.id.localeCompare(b.id)), [flights]);
    const feedInsights = useMemo<FeedInsight[]>(() => {
        if (sort !== 'recommended' || query.trim()) return [];

        type PriceDropCandidate = {
            flight: Flight;
            drop: number;
            previousPrice: number;
            currentPrice: number;
            score: number;
        };
        type InsightLane = 'event' | 'trip' | 'discovery';
        type InsightCandidate = {
            score: number;
            lane: InsightLane;
            loud?: boolean;
            insight: FeedInsight;
        };
        let bestPriceDrop: PriceDropCandidate | null = null;
        const routeHistory = normalizedHistory(priceHistory);
        const historyDates = Array.from(new Set(
            Object.values(routeHistory).flatMap(entries => entries.map(entry => entry.date)),
        )).sort();
        const latestHistoryDate = historyDates.at(-1);
        const previousHistoryDate = historyDates.at(-2);

        if (latestHistoryDate && previousHistoryDate) {
            const cheapestByRoute = new Map<string, Flight>();
            displayedFlights.forEach(flight => {
                const key = normalizedRoute(flight);
                const current = cheapestByRoute.get(key);
                if (!current || effectivePrice(flight) < effectivePrice(current)) cheapestByRoute.set(key, flight);
            });

            const displayRank = new Map(displayedFlights.map((flight, index) => [flight.id, index]));
            const drops = Array.from(cheapestByRoute.entries()).flatMap(([route, flight]) => {
                const entries = routeHistory[route] || [];
                const latest = entries.find(entry => entry.date === latestHistoryDate);
                const previous = entries.find(entry => entry.date === previousHistoryDate);
                if (!latest || !previous || previous.minPrice <= latest.minPrice) return [];

                const drop = previous.minPrice - latest.minPrice;
                const dropRate = drop / previous.minPrice;
                if (drop < 10_000 || dropRate < 0.05 || dropRate > 0.35) return [];
                if (effectivePrice(flight) > 500_000) return [];
                if (latest.count && previous.count) {
                    const countRatio = latest.count / previous.count;
                    if (countRatio < 0.45 || countRatio > 2.2) return [];
                }
                if (Math.abs(effectivePrice(flight) - latest.minPrice) > 1_000) return [];
                const rankPenalty = Math.min(displayRank.get(flight.id) || 0, 30) * 0.12;
                const score = dropRate * 100 + Math.min(drop / 20_000, 5) - rankPenalty;
                return [{ flight, drop, previousPrice: previous.minPrice, currentPrice: latest.minPrice, score }];
            }).sort((a, b) => b.score - a.score);

            const bestDrop = drops[0];
            bestPriceDrop = bestDrop || null;
        }

        const stayCandidates = displayedFlights.flatMap(flight => {
            const minutes = onsiteStayMinutes(flight);
            const nights = daysBetweenDates(flight.departure.date, flight.arrival.date);
            if (minutes === null || nights !== 3 || effectivePrice(flight) > 350_000) return [];
            const hours = Math.round(minutes / 60);
            if (hours < 48) return [];
            return [{ flight, hours, score: hours - effectivePrice(flight) / 20_000 }];
        }).sort((a, b) => b.score - a.score);

        const zeroPtoCandidates = displayedFlights
            .filter(flight => isZeroPtoSchedule(flight) && effectivePrice(flight) <= 350_000)
            .sort((a, b) => effectivePrice(a) - effectivePrice(b));

        const harshCandidates = displayedFlights.flatMap(flight => {
            const detail = harshScheduleDetail(flight);
            const attractive = effectivePrice(flight) <= 220_000 || Math.max(0, flight.discountRate || 0) >= 20;
            return detail && attractive ? [{ flight, detail }] : [];
        }).sort((a, b) => recommendedScore(a.flight) - recommendedScore(b.flight));

        const airportComparisons: Array<{
            cheaper: Flight;
            expensive: Flight;
            saving: number;
            savingRate: number;
        }> = [];
        const cheapestByDestinationAndAirport = new Map<string, Map<string, Flight>>();
        displayedFlights.forEach(flight => {
            const destination = normalizeCity(flight.arrival.city);
            const origin = departureName(flight);
            const byAirport = cheapestByDestinationAndAirport.get(destination) || new Map<string, Flight>();
            const current = byAirport.get(origin);
            if (!current || effectivePrice(flight) < effectivePrice(current)) {
                byAirport.set(origin, flight);
            }
            cheapestByDestinationAndAirport.set(destination, byAirport);
        });

        cheapestByDestinationAndAirport.forEach(byAirport => {
            const originMinimums = Array.from(byAirport.values());
            for (let leftIndex = 0; leftIndex < originMinimums.length; leftIndex += 1) {
                for (let rightIndex = leftIndex + 1; rightIndex < originMinimums.length; rightIndex += 1) {
                    const left = originMinimums[leftIndex];
                    const right = originMinimums[rightIndex];
                    const cheaper = effectivePrice(left) <= effectivePrice(right) ? left : right;
                    const expensive = cheaper === left ? right : left;
                    const saving = effectivePrice(expensive) - effectivePrice(cheaper);
                    const savingRate = saving / effectivePrice(expensive);
                    if (effectivePrice(cheaper) > 500_000 || (saving < 10_000 && savingRate < 0.05)) continue;
                    airportComparisons.push({ cheaper, expensive, saving, savingRate });
                }
            }
        });
        airportComparisons.sort((a, b) => b.savingRate - a.savingRate || b.saving - a.saving);

        const latestDataDate = latestHistoryDate || lastUpdated?.slice(0, 10);
        let verifiedNewFlight: Flight | null = null;
        if (latestDataDate) {
            const latestDate = parseDate(latestDataDate);
            const newSince = latestDate ? dateKey(addDays(latestDate, -2)) : latestDataDate;
            verifiedNewFlight = displayedFlights.filter(flight => {
                if (!flight.firstSeen || flight.firstSeen < newSince) return false;
                const earlierRouteRecord = (routeHistory[normalizedRoute(flight)] || [])
                    .some(entry => entry.date < flight.firstSeen!);
                return !earlierRouteRecord;
            }).sort((a, b) => effectivePrice(a) - effectivePrice(b))[0] || null;
        }

        const editorialCandidates: InsightCandidate[] = [];
        if (bestPriceDrop) {
            const dropRate = bestPriceDrop.drop / bestPriceDrop.previousPrice;
            if (bestPriceDrop.drop >= 30_000 && dropRate >= 0.12) {
                const crossedSelectedBudget = maxPrice > 0
                    && bestPriceDrop.previousPrice > maxPrice
                    && bestPriceDrop.currentPrice <= maxPrice;
                const crossedTwenty = bestPriceDrop.previousPrice >= 200_000
                    && bestPriceDrop.currentPrice < 200_000;
                const collapsed = bestPriceDrop.drop >= 50_000 && dropRate >= 0.2;
                editorialCandidates.push({
                    score: 100 + dropRate * 100,
                    lane: 'event',
                    loud: crossedSelectedBudget || crossedTwenty || collapsed,
                    insight: {
                        id: 'editorial-price-drop',
                        kind: 'price',
                        editorial: true,
                        eyebrow: '가격 변화',
                        title: crossedSelectedBudget
                            ? '💥 예산선 파괴'
                            : crossedTwenty
                                ? '🧨 20만원선 붕괴'
                                : collapsed
                                    ? '🚨 가격 붕괴 감지'
                                    : `💸 ${compactWon(bestPriceDrop.drop)} 증발`,
                        description: '어제 노선 최저가 대비',
                        flight: bestPriceDrop.flight,
                        destination: stripAirport(bestPriceDrop.flight.arrival.city),
                        previousPrice: bestPriceDrop.previousPrice,
                        currentPrice: bestPriceDrop.currentPrice,
                        meta: `${departureName(bestPriceDrop.flight)} 출발 · ${cardDate(bestPriceDrop.flight.departure.date)}`,
                        badge: `${compactWon(bestPriceDrop.drop)} 내림`,
                    },
                });
            }
        }

        if (latestHistoryDate) {
            const latestDate = parseDate(latestHistoryDate);
            const sixtyDaysAgo = latestDate ? dateKey(addDays(latestDate, -59)) : latestHistoryDate;
            const historicalCandidates = displayedFlights.flatMap(flight => {
                const entries = (routeHistory[normalizedRoute(flight)] || [])
                    .filter(entry => entry.date <= latestHistoryDate);
                const latest = entries.find(entry => entry.date === latestHistoryDate);
                if (!latest || Math.abs(effectivePrice(flight) - latest.minPrice) > 1_000) return [];

                const recentEntries = entries.filter(entry => entry.date >= sixtyDaysAgo);
                if (recentEntries.length < 20 || latest.minPrice > 500_000) return [];
                const recentPrices = recentEntries.map(entry => entry.minPrice).sort((a, b) => a - b);
                const allDistinctPrices = Array.from(new Set(entries.map(entry => entry.minPrice))).sort((a, b) => a - b);
                const yearRank = allDistinctPrices.indexOf(latest.minPrice) + 1;
                const percentileRank = recentPrices.filter(price => price < latest.minPrice).length / recentPrices.length;

                if (latest.minPrice === recentPrices[0]) {
                    return [{ flight, title: '🏆 최근 60일 최저가', badge: '60일 최저', score: 104, loud: false }];
                }
                if (entries.length >= 50 && yearRank > 0 && yearRank <= 3) {
                    return [{ flight, title: '🏆 올해 최저가 TOP 3', badge: `TOP ${yearRank}`, score: 101, loud: false }];
                }
                if (recentEntries.length >= 30 && percentileRank <= 0.05) {
                    return [{ flight, title: '🦄 유니콘보다 드문 가격', badge: '하위 5%', score: 96, loud: true }];
                }
                return [];
            }).sort((a, b) => b.score - a.score || recommendedScore(a.flight) - recommendedScore(b.flight));

            const historical = historicalCandidates[0];
            if (historical) {
                editorialCandidates.push({
                    score: historical.score,
                    lane: 'event',
                    loud: historical.loud,
                    insight: {
                        id: `editorial-history-${historical.flight.id}`,
                        kind: 'opportunity',
                        editorial: true,
                        eyebrow: '가격 기록',
                        title: historical.title,
                        description: `${stripAirport(historical.flight.arrival.city)} 노선의 티키티킷 관측 기록 기준`,
                        flight: historical.flight,
                        destination: stripAirport(historical.flight.arrival.city),
                        currentPrice: effectivePrice(historical.flight),
                        meta: `${departureName(historical.flight)} 출발 · ${cardDate(historical.flight.departure.date)}`,
                        badge: historical.badge,
                    },
                });
            }
        }

        const airportComparison = airportComparisons[0];
        if (airportComparison) {
            const cheaperOrigin = departureName(airportComparison.cheaper);
            const expensiveOrigin = departureName(airportComparison.expensive);
            const airportTitle = airportComparison.saving >= 100_000
                ? `💰 공항 바꾸고 ${compactWon(airportComparison.saving)} SAVE`
                : cheaperOrigin === '청주'
                    ? '🚄 청주까지 갈 이유'
                    : `🛅 오늘은 ${expensiveOrigin}보다 ${cheaperOrigin}`;
            editorialCandidates.push({
                score: 92 + airportComparison.savingRate * 100,
                lane: 'trip',
                insight: {
                    id: 'editorial-airport',
                    kind: 'airport',
                    editorial: true,
                    eyebrow: '출발지 비교',
                    title: airportTitle,
                    description: `${stripAirport(airportComparison.cheaper.arrival.city)}행 · ${cheaperOrigin} 출발이 ${compactWon(airportComparison.saving)} 더 저렴`,
                    flight: airportComparison.cheaper,
                    destination: stripAirport(airportComparison.cheaper.arrival.city),
                    currentPrice: effectivePrice(airportComparison.cheaper),
                    meta: `${cheaperOrigin} ${cardDate(airportComparison.cheaper.departure.date)} · ${expensiveOrigin} ${cardDate(airportComparison.expensive.departure.date)}`,
                    badge: `${compactWon(airportComparison.saving)} 차이`,
                },
            });
        }

        const zeroPtoFlight = zeroPtoCandidates[0];
        if (zeroPtoFlight) {
            editorialCandidates.push({
                score: 88 + Math.max(0, 350_000 - effectivePrice(zeroPtoFlight)) / 10_000,
                lane: 'trip',
                insight: {
                    id: 'editorial-zero-pto',
                    kind: 'schedule',
                    editorial: true,
                    eyebrow: '일정 분석',
                    title: '🏃 0연차 탈출 가능',
                    description: `금요일 ${zeroPtoFlight.departure.time} 출발 · 일요일 ${returnArrivalTime(zeroPtoFlight)} 도착`,
                    flight: zeroPtoFlight,
                    destination: stripAirport(zeroPtoFlight.arrival.city),
                    currentPrice: effectivePrice(zeroPtoFlight),
                    meta: `${departureName(zeroPtoFlight)} 출발 · ${tripLength(zeroPtoFlight) || '주말 일정'}`,
                    badge: '연차 0일',
                },
            });
        }

        const stayCandidate = stayCandidates.find(candidate => {
            const departureDate = parseDate(candidate.flight.departure.date);
            const returnDate = parseDate(candidate.flight.arrival.date);
            return !!departureDate && !!returnDate
                && [4, 5, 6].includes(departureDate.getDay())
                && [0, 1, 2].includes(returnDate.getDay());
        });
        if (stayCandidate) {
            editorialCandidates.push({
                score: 80 + Math.max(0, stayCandidate.hours - 60) / 2,
                lane: 'trip',
                insight: {
                    id: 'editorial-stay-time',
                    kind: 'stay',
                    editorial: true,
                    eyebrow: '여행시간 분석',
                    title: '🧳 주말 압축 성공',
                    description: `${stripAirport(stayCandidate.flight.arrival.city)}에서 실제로 쓸 수 있는 시간`,
                    flight: stayCandidate.flight,
                    destination: stripAirport(stayCandidate.flight.arrival.city),
                    currentPrice: effectivePrice(stayCandidate.flight),
                    meta: `${outboundArrivalTime(stayCandidate.flight)} 도착 · ${returnDepartureTime(stayCandidate.flight)} 출발`,
                    badge: `현지 ${stayCandidate.hours}시간`,
                },
            });
        }

        const harshCandidate = harshCandidates[0];
        if (harshCandidate) {
            const returnDate = parseDate(harshCandidate.flight.arrival.date);
            const homeDate = returnArrivalDate(harshCandidate.flight);
            const nextDayArrival = !!returnDate && !!homeDate && homeDate.getTime() > returnDate.getTime();
            editorialCandidates.push({
                score: 76 + Math.max(0, harshCandidate.flight.discountRate || 0),
                lane: 'trip',
                insight: {
                    id: 'editorial-harsh-time',
                    kind: 'timing',
                    editorial: true,
                    eyebrow: '시간 확인',
                    title: nextDayArrival ? '🥱 귀국 다음 날 위험' : '🌙 가격 좋음 · 시간 험함',
                    description: harshCandidate.detail,
                    flight: harshCandidate.flight,
                    destination: stripAirport(harshCandidate.flight.arrival.city),
                    currentPrice: effectivePrice(harshCandidate.flight),
                    meta: `${departureName(harshCandidate.flight)} 출발 · ${cardDate(harshCandidate.flight.departure.date)}`,
                },
            });
        }

        if (verifiedNewFlight && effectivePrice(verifiedNewFlight) <= 250_000) {
            editorialCandidates.push({
                score: 70 + Math.max(0, 250_000 - effectivePrice(verifiedNewFlight)) / 10_000,
                lane: 'event',
                insight: {
                    id: 'editorial-new',
                    kind: 'new',
                    editorial: true,
                    eyebrow: '새로 등장',
                    title: '🎟 새 일정 투하',
                    description: '이전 기록에는 없던 일정이에요',
                    flight: verifiedNewFlight,
                    destination: stripAirport(verifiedNewFlight.arrival.city),
                    currentPrice: effectivePrice(verifiedNewFlight),
                    meta: `${departureName(verifiedNewFlight)} 출발 · ${cardDate(verifiedNewFlight.departure.date)}`,
                    badge: 'NEW',
                },
            });
        }

        const destinationCandidate = displayedFlights.find(flight => getDestinationContext(flight.arrival.city));
        const destinationContext = destinationCandidate
            ? getDestinationContext(destinationCandidate.arrival.city)
            : null;
        if (destinationCandidate && destinationContext) {
            editorialCandidates.push({
                score: 72,
                lane: 'discovery',
                insight: {
                    id: `editorial-destination-${normalizeCity(destinationCandidate.arrival.city)}`,
                    kind: 'discovery',
                    editorial: true,
                    eyebrow: '여행지 발견',
                    title: `🧭 ${stripAirport(destinationCandidate.arrival.city)} 입문`,
                    description: destinationContext.location,
                    flight: destinationCandidate,
                    destination: stripAirport(destinationCandidate.arrival.city),
                    currentPrice: effectivePrice(destinationCandidate),
                    meta: `${departureName(destinationCandidate)} 출발 · ${tripLength(destinationCandidate) || cardDate(destinationCandidate.departure.date)}`,
                    badge: '처음 보는 도시',
                },
            });
        }

        editorialCandidates.sort((a, b) => b.score - a.score);
        const selectedInsights: FeedInsight[] = [];
        const selectedKinds = new Set<FeedInsight['kind']>();
        const selectedDestinations = new Set<string>();
        let loudSelected = false;
        const selectCandidate = (candidate: InsightCandidate) => {
            const destination = normalizeCity(candidate.insight.flight.arrival.city);
            if (selectedKinds.has(candidate.insight.kind) || selectedDestinations.has(destination)) return false;
            if (candidate.loud && loudSelected) return false;
            selectedInsights.push(candidate.insight);
            selectedKinds.add(candidate.insight.kind);
            selectedDestinations.add(destination);
            if (candidate.loud) loudSelected = true;
            return true;
        };

        const dailyCandidatesForLane = (lane: InsightLane) => {
            const candidates = editorialCandidates.filter(candidate => candidate.lane === lane);
            const bestScore = candidates[0]?.score ?? 0;
            return candidates
                .filter(candidate => candidate.score >= bestScore - 16)
                .sort((a, b) => (
                    dailyOrderValue(insightDateKey, a.insight.id)
                    - dailyOrderValue(insightDateKey, b.insight.id)
                ));
        };

        const dailyCandidates = new Map<InsightLane, InsightCandidate[]>([
            ['event', dailyCandidatesForLane('event')],
            ['trip', dailyCandidatesForLane('trip')],
            ['discovery', dailyCandidatesForLane('discovery')],
        ]);
        const laneOrder: InsightLane[] = ['event', 'trip', 'discovery', 'event', 'trip'];
        for (const lane of laneOrder) {
            for (const candidate of dailyCandidates.get(lane) || []) {
                if (selectCandidate(candidate)) break;
            }
        }
        for (const candidate of editorialCandidates) {
            if (selectedInsights.length >= 5) break;
            selectCandidate(candidate);
        }
        return selectedInsights.slice(0, 5);
    }, [displayedFlights, insightDateKey, lastUpdated, maxPrice, priceHistory, query, sort]);

    const freshFlightsInsight = useMemo(() => {
        if (sort !== 'recommended' || query.trim()) return null;

        const datedFlights = displayedFlights.filter(flight => flight.firstSeen && effectivePrice(flight) > 0);
        const todayKey = seoulDateKey();
        const latestSeen = datedFlights.reduce((latest, flight) => (
            (flight.firstSeen || '') > latest ? flight.firstSeen || '' : latest
        ), '');
        let targetDate = todayKey;
        let targetFlights = datedFlights.filter(flight => flight.firstSeen === targetDate);

        const countRoutes = (items: Flight[]) => new Set(
            items.map(flight => normalizedRoute(flight)),
        ).size;
        if (countRoutes(targetFlights) === 0) {
            targetDate = latestSeen;
            targetFlights = datedFlights.filter(flight => flight.firstSeen === targetDate);
        }
        if (!targetDate || targetFlights.length === 0) return null;

        const flightsByRoute = new Map<string, Flight[]>();
        targetFlights.forEach(flight => {
            const route = normalizedRoute(flight);
            flightsByRoute.set(route, [...(flightsByRoute.get(route) || []), flight]);
        });

        const scheduleCountByFlightId = new Map<string, number>();
        const freshFlights = Array.from(flightsByRoute.values())
            .map(routeFlights => {
                const lowestPrice = Math.min(...routeFlights.map(flight => effectivePrice(flight)));
                const lowestPriceSchedules = uniqueFlightSchedules(
                    routeFlights.filter(flight => effectivePrice(flight) === lowestPrice),
                )
                    .sort((a, b) => (
                        a.departure.date.localeCompare(b.departure.date)
                        || a.arrival.date.localeCompare(b.arrival.date)
                        || a.departure.time.localeCompare(b.departure.time)
                        || a.source.localeCompare(b.source)
                    ));
                const representative = lowestPriceSchedules[0];
                scheduleCountByFlightId.set(representative.id, lowestPriceSchedules.length);
                return representative;
            })
            .sort((a, b) => (
                effectivePrice(a) - effectivePrice(b)
                || normalizedRoute(a).localeCompare(normalizedRoute(b), 'ko')
            ));

        const pairs = Array.from({ length: Math.ceil(freshFlights.length / 2) }, (_, index) => (
            freshFlights.slice(index * 2, index * 2 + 2)
        ));

        return {
            copyPrefix: targetDate === todayKey ? '오늘' : '최근',
            targetDate,
            targetFlights,
            flights: freshFlights,
            pairs,
            scheduleCountByFlightId,
        };
    }, [displayedFlights, query, sort]);

    const weekendFlights = useMemo(() => {
        if (sort !== 'recommended' || query.trim()) return [];
        const routeFlights = new Map<string, Flight>();

        displayedFlights
            .filter(flight => effectivePrice(flight) > 0 && tripSpansFullWeekend(flight))
            .forEach(flight => {
                const route = normalizedRoute(flight);
                const current = routeFlights.get(route);
                if (!current
                    || effectivePrice(flight) < effectivePrice(current)
                    || (effectivePrice(flight) === effectivePrice(current)
                        && flight.departure.date.localeCompare(current.departure.date) < 0)) {
                    routeFlights.set(route, flight);
                }
            });

        return Array.from(routeFlights.values())
            .sort((a, b) => (
                effectivePrice(a) - effectivePrice(b)
                || a.departure.date.localeCompare(b.departure.date)
                || normalizedRoute(a).localeCompare(normalizedRoute(b), 'ko')
            ))
            .slice(0, 12);
    }, [displayedFlights, query, sort]);

    const freshRouteResultFlights = useMemo(() => {
        if (!freshRouteResults) return [];
        const result = flights.filter(flight => (
            flight.firstSeen === freshRouteResults.targetDate
            && normalizedRoute(flight) === freshRouteResults.route
            && effectivePrice(flight) > 0
        ));

        return result.sort((a, b) => {
            if (sort === 'price') return effectivePrice(a) - effectivePrice(b);
            if (sort === 'date') {
                return (parseDate(a.departure.date)?.getTime() || 0) - (parseDate(b.departure.date)?.getTime() || 0)
                    || effectivePrice(a) - effectivePrice(b);
            }
            return compareRecommended(a, b)
                || (parseDate(a.departure.date)?.getTime() || 0) - (parseDate(b.departure.date)?.getTime() || 0);
        });
    }, [compareRecommended, flights, freshRouteResults, sort]);
    const feedFlights = freshRouteResults ? freshRouteResultFlights : displayedFlights;
    const resultCount = initialSubsetActive && isDefaultView
        ? initialFlightCount
        : filteredFlights.length;
    const listLoading = loading || initialListSyncing;

    const openFreshRouteResults = useCallback((flight: Flight) => {
        if (!freshFlightsInsight) return;
        freshRouteOriginScrollRef.current = window.scrollY;
        setFreshRouteResults({
            route: normalizedRoute(flight),
            departure: departureName(flight),
            arrival: stripAirport(flight.arrival.city),
            targetDate: freshFlightsInsight.targetDate,
            copyPrefix: freshFlightsInsight.copyPrefix,
        });
        setVisibleCount(window.matchMedia('(min-width: 960px)').matches ? 36 : 18);
        gtag.event('insight_click', {
            insight_type: 'new_flights',
            insight_format: 'search_results',
            destination: normalizeCity(flight.arrival.city),
            flight_id: flight.id,
        });
        window.requestAnimationFrame(() => {
            feedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }, [freshFlightsInsight]);

    const closeFreshRouteResults = useCallback(() => {
        const previousScroll = freshRouteOriginScrollRef.current;
        setFreshRouteResults(null);
        window.requestAnimationFrame(() => {
            window.scrollTo({ top: previousScroll, behavior: 'smooth' });
        });
    }, []);

    const freshDesktopPairs = useMemo(() => freshFlightsInsight?.pairs || [], [freshFlightsInsight]);
    const freshDesktopPairCount = freshDesktopPairs.length;
    const freshDesktopLoopingPairs = useMemo(() => {
        if (freshDesktopPairCount <= 1) return freshDesktopPairs;
        return [
            freshDesktopPairs[freshDesktopPairCount - 1],
            ...freshDesktopPairs,
            freshDesktopPairs[0],
        ];
    }, [freshDesktopPairCount, freshDesktopPairs]);
    const freshMobileFlights = useMemo(() => freshFlightsInsight?.flights || [], [freshFlightsInsight]);
    const freshMobileFlightCount = freshMobileFlights.length;
    const freshMobileLoopingFlights = useMemo(() => {
        if (freshMobileFlightCount <= 1) return freshMobileFlights;
        return [
            freshMobileFlights[freshMobileFlightCount - 1],
            ...freshMobileFlights,
            freshMobileFlights[0],
        ];
    }, [freshMobileFlightCount, freshMobileFlights]);

    useEffect(() => {
        setFreshMobilePosition(freshMobileFlightCount > 1 ? 1 : 0);
        setFreshMobileDragOffset(0);
    }, [freshMobileFlightCount]);

    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updatePreference = () => setFreshMobileReduceMotion(media.matches);
        updatePreference();
        media.addEventListener('change', updatePreference);
        return () => media.removeEventListener('change', updatePreference);
    }, []);

    const moveFreshMobileTicket = useCallback((direction: -1 | 1) => {
        if (freshMobileFlightCount <= 1) return;
        setFreshMobileAnimating(!freshMobileReduceMotion);
        setFreshMobileDragOffset(0);
        setFreshMobilePosition(current => current + direction);
    }, [freshMobileFlightCount, freshMobileReduceMotion]);

    useEffect(() => {
        if (freshMobileFlightCount <= 1 || freshMobileReduceMotion || freshMobileDragRef.current) return;
        const timer = window.setTimeout(() => moveFreshMobileTicket(1), FRESH_MOBILE_AUTO_ADVANCE_MS);
        return () => window.clearTimeout(timer);
    }, [freshMobileFlightCount, freshMobilePosition, freshMobileReduceMotion, moveFreshMobileTicket]);

    useEffect(() => {
        if (freshMobileFlightCount <= 1) return;
        const isLeadingClone = freshMobilePosition <= 0;
        const isTrailingClone = freshMobilePosition >= freshMobileFlightCount + 1;
        if (!isLeadingClone && !isTrailingClone) return;

        const isExpectedClone = freshMobilePosition === 0 || freshMobilePosition === freshMobileFlightCount + 1;
        const timer = window.setTimeout(() => {
            setFreshMobileAnimating(false);
            setFreshMobilePosition(isLeadingClone ? freshMobileFlightCount : 1);
        }, isExpectedClone && !freshMobileReduceMotion ? 760 : 0);
        return () => window.clearTimeout(timer);
    }, [freshMobileFlightCount, freshMobilePosition, freshMobileReduceMotion]);

    const handleFreshMobilePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (freshMobileFlightCount <= 1 || (event.pointerType === 'mouse' && event.button !== 0)) return;
        freshMobileDragRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startedAt: performance.now(),
        };
        freshMobileSuppressClickRef.current = false;
        setFreshMobileAnimating(false);
        setFreshMobileDragOffset(0);
    };

    const handleFreshMobilePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = freshMobileDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const nextOffset = Math.max(-64, Math.min(64, event.clientY - drag.startY));
        if (Math.abs(nextOffset) >= 4 && !event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        setFreshMobileDragOffset(nextOffset);
    };

    const handleFreshMobilePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = freshMobileDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const distance = event.clientY - drag.startY;
        const elapsed = Math.max(1, performance.now() - drag.startedAt);
        const velocity = Math.abs(distance) / elapsed;
        freshMobileDragRef.current = null;

        if (Math.abs(distance) >= 30 || velocity >= 0.42) {
            freshMobileSuppressClickRef.current = true;
            window.setTimeout(() => {
                freshMobileSuppressClickRef.current = false;
            }, 320);
            moveFreshMobileTicket(distance < 0 ? 1 : -1);
        } else {
            setFreshMobileAnimating(!freshMobileReduceMotion);
            setFreshMobileDragOffset(0);
        }
    };

    const freshMobileActiveIndex = freshMobileFlightCount
        ? ((freshMobilePosition - 1 + freshMobileFlightCount) % freshMobileFlightCount)
        : 0;

    useEffect(() => {
        setFreshDesktopPosition(freshDesktopPairCount > 1 ? 1 : 0);
        setFreshDesktopDragOffset(0);
        setFreshDesktopDragging(false);
    }, [freshDesktopPairCount]);

    const moveFreshDesktopPair = useCallback((direction: -1 | 1) => {
        if (freshDesktopPairCount <= 1) return;
        setFreshDesktopAnimating(!freshMobileReduceMotion);
        setFreshDesktopDragOffset(0);
        setFreshDesktopPosition(current => current + direction);
    }, [freshDesktopPairCount, freshMobileReduceMotion]);

    useEffect(() => {
        if (freshDesktopPairCount <= 1 || freshMobileReduceMotion || freshDesktopDragging) return;
        const timer = window.setTimeout(() => {
            if (!freshDesktopDragRef.current) moveFreshDesktopPair(1);
        }, FRESH_DESKTOP_AUTO_ADVANCE_MS);
        return () => window.clearTimeout(timer);
    }, [freshDesktopDragging, freshDesktopPairCount, freshDesktopPosition, freshMobileReduceMotion, moveFreshDesktopPair]);

    useEffect(() => {
        if (freshDesktopPairCount <= 1) return;
        const isLeadingClone = freshDesktopPosition <= 0;
        const isTrailingClone = freshDesktopPosition >= freshDesktopPairCount + 1;
        if (!isLeadingClone && !isTrailingClone) return;

        const isExpectedClone = freshDesktopPosition === 0 || freshDesktopPosition === freshDesktopPairCount + 1;
        const timer = window.setTimeout(() => {
            setFreshDesktopAnimating(false);
            setFreshDesktopPosition(isLeadingClone ? freshDesktopPairCount : 1);
        }, isExpectedClone && !freshMobileReduceMotion ? 760 : 0);
        return () => window.clearTimeout(timer);
    }, [freshDesktopPairCount, freshDesktopPosition, freshMobileReduceMotion]);

    const handleFreshDesktopPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (freshDesktopPairCount <= 1 || (event.pointerType === 'mouse' && event.button !== 0)) return;
        freshDesktopDragRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startedAt: performance.now(),
        };
        freshDesktopSuppressClickRef.current = false;
        setFreshDesktopDragging(true);
        setFreshDesktopAnimating(false);
        setFreshDesktopDragOffset(0);
    };

    const handleFreshDesktopPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = freshDesktopDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const nextOffset = Math.max(-82, Math.min(82, event.clientY - drag.startY));
        if (Math.abs(nextOffset) >= 4 && !event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        setFreshDesktopDragOffset(nextOffset);
    };

    const handleFreshDesktopPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = freshDesktopDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const distance = event.clientY - drag.startY;
        const elapsed = Math.max(1, performance.now() - drag.startedAt);
        const velocity = Math.abs(distance) / elapsed;
        freshDesktopDragRef.current = null;
        setFreshDesktopDragging(false);

        if (Math.abs(distance) >= 36 || velocity >= 0.42) {
            freshDesktopSuppressClickRef.current = true;
            window.setTimeout(() => {
                freshDesktopSuppressClickRef.current = false;
            }, 320);
            moveFreshDesktopPair(distance < 0 ? 1 : -1);
        } else {
            setFreshDesktopAnimating(!freshMobileReduceMotion);
            setFreshDesktopDragOffset(0);
        }
    };

    const departureFilterLabel = departure === '전체'
        ? '출발지'
        : departure.replace('/김포', '').replace('/김해', '');
    const destinationFilterLabel = region === '전체' ? '목적지' : region;
    const dateFilterLabel = datePeriod === 'custom'
        ? customStartDate
            ? `${customStartDate.getMonth() + 1}.${customStartDate.getDate()}${customEndDate ? `~${customEndDate.getMonth() + 1}.${customEndDate.getDate()}` : '~'}`
            : '날짜'
        : datePeriod === 'all'
            ? '날짜'
            : DATE_PERIOD_OPTIONS.find(item => item.value === datePeriod)?.label || '날짜';
    const firstInsightCard = 9;
    const subsequentInsightInterval = 12;
    const weeklyDiscoveryInsightCard = firstInsightCard + subsequentInsightInterval;
    const weekendFlightsInsightCard = weeklyDiscoveryInsightCard + subsequentInsightInterval;
    const hasAdvancedFilter = departure !== '전체'
        || datePeriod !== 'all'
        || maxPrice > 0
        || sourceFilter !== 'all'
        || airlineFilter !== 'all';
    const updatedLabel = lastUpdated
        ? `${new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(new Date(lastUpdated))} 기준`
        : '최근 기준';
    const selectedHotelTrackingId = selectedFlight
        ? getTripcomTrackingId(
            selectedFlight.arrival.city,
            selectedFlight.departure.date,
            selectedFlight.arrival.date,
            selectedFlight.arrival.airport,
            selectedFlight.departure.city,
            selectedFlight.departure.airport,
        )
        : '';
    const selectedHotelUrl = selectedFlight
        ? getTripcomHotelUrl(
            selectedFlight.arrival.city,
            selectedFlight.departure.date,
            selectedFlight.arrival.date,
            selectedFlight.arrival.airport,
            selectedFlight.departure.city,
            selectedFlight.departure.airport,
        )
        : null;
    const selectedBookingUrl = selectedFlight
        ? getFlightBookingUrl(selectedFlight, passengers, isMobile)
        : '';
    const selectedNaverUrl = selectedFlight && !(selectedFlight.source === 'myrealtrip' && !selectedFlight.routeAirports)
        ? getNaverFlightUrl(
            selectedFlight.departure.city,
            selectedFlight.arrival.city,
            selectedFlight.departure.date,
            selectedFlight.arrival.date,
            selectedFlight.departure.airport,
            selectedFlight.arrival.airport,
            selectedFlight.routeAirports,
        )
        : null;
    const emptyRouteAlertTarget = useMemo<RouteAlertTarget | null>(() => {
        const term = query.trim();
        if (!term || loading || error || filteredFlights.length > 0) return null;
        const arrivalCity = normalizeCity(term);
        if (!CITY_TO_AIRPORT[term] && !CITY_TO_AIRPORT[arrivalCity]) return null;
        const hasUnfilteredFlight = flights.some(flight => normalizeCity(flight.arrival.city) === arrivalCity);
        if (hasUnfilteredFlight) return null;

        const months = Object.values(interparkPrices[arrivalCity] || {});
        const suggestedPrice = months.length
            ? Math.round(months.reduce((sum, month) => sum + month.avg, 0) / months.length / 10_000) * 10_000
            : undefined;
        return {
            departureCity: departure === '전체' ? '인천' : departure.replace('/김포', '').replace('/김해', ''),
            arrivalCity,
            suggestedPrice,
        };
    }, [departure, error, filteredFlights.length, flights, interparkPrices, loading, query]);

    const emptyDiagnosis = useMemo(() => {
        if (loading || error || filteredFlights.length > 0) return null;
        const matchesQuery = (flight: Flight) => searchQueryMatches(flight, query);
        const queryFlights = flights.filter(matchesQuery);
        if (queryFlights.length === 0) {
            return { kind: 'no-deals' as const, available: 0, blockers: [] };
        }

        const referenceDate = new Date();
        const activeFilters: Array<{ id: EmptyFilterId; label: string }> = [];
        if (region !== '전체') activeFilters.push({ id: 'region', label: `도착 지역 · ${region}` });
        if (departure !== '전체') activeFilters.push({ id: 'departure', label: `출발지 · ${departure}` });
        if (datePeriod !== 'all') {
            const label = datePeriod === 'custom'
                ? `${customStartDate ? cardDate(dateKey(customStartDate)) : '시작일'}~${customEndDate ? cardDate(dateKey(customEndDate)) : ''}`
                : DATE_PERIOD_OPTIONS.find(item => item.value === datePeriod)?.label || '선택 날짜';
            activeFilters.push({ id: 'date', label: `출발일 · ${label}` });
        }
        if (maxPrice) {
            activeFilters.push({
                id: 'price',
                label: `가격 · ${PRICE_OPTIONS.find(item => item.value === maxPrice)?.label || priceText(maxPrice)}`,
            });
        }
        if (sourceFilter !== 'all') activeFilters.push({ id: 'source', label: `여행사 · ${SOURCE_NAMES[sourceFilter]}` });
        if (airlineFilter !== 'all') activeFilters.push({ id: 'airline', label: `항공사 · ${airlineFilter}` });

        const matchesAllExcept = (flight: Flight, except: EmptyFilterId) => (
            (except === 'region' || regionMatches(flight, region))
            && (except === 'departure' || departureMatches(flight, departure))
            && (except === 'date' || datePeriodMatches(flight, datePeriod, referenceDate, customStartDate, customEndDate))
            && (except === 'price' || !maxPrice || effectivePrice(flight) <= maxPrice)
            && (except === 'source' || sourceFilter === 'all' || flight.source === sourceFilter)
            && (except === 'airline' || airlineFilter === 'all' || normalizeAirline(flight.airline) === airlineFilter)
        );
        const measured = activeFilters.map(filter => ({
            ...filter,
            revealedCount: queryFlights.filter(flight => matchesAllExcept(flight, filter.id)).length,
        }));
        const recoverable = measured.filter(filter => filter.revealedCount > 0);

        return {
            kind: 'filtered' as const,
            available: queryFlights.length,
            blockers: recoverable.length ? recoverable : measured,
        };
    }, [
        airlineFilter, customEndDate, customStartDate, datePeriod, departure, error,
        filteredFlights.length, flights, loading, maxPrice, query, region, sourceFilter,
    ]);
    const guestFavoriteSnapshots = useMemo(
        () => flights.filter(flight => guestFavorites.has(flight.id)).map(toAccountSnapshot),
        [flights, guestFavorites],
    );

    const selectDepartureFilter = (value: string) => {
        if (departure !== value) gtag.trackFilterChange('departure', value);
        setDeparture(value);
    };

    const selectRegionFilter = (value: string) => {
        if (region !== value) gtag.trackFilterChange('region', value);
        setRegion(value);
    };

    const selectPriceFilter = (value: number) => {
        if (maxPrice !== value) gtag.trackFilterChange('max_price', value ? String(value) : 'all');
        setMaxPrice(value);
    };

    const selectSourceFilter = (value: 'all' | Flight['source']) => {
        if (sourceFilter !== value) gtag.trackFilterChange('source', value);
        setSourceFilter(value);
    };

    const selectAirlineFilter = (value: string) => {
        if (airlineFilter !== value) gtag.trackFilterChange('airline', value);
        setAirlineFilter(value);
    };

    const selectSort = (value: SortMode) => {
        if (sort !== value) gtag.trackFilterChange('sort', value);
        setSort(value);
    };

    const selectDatePeriod = (value: Exclude<DatePeriod, 'custom'>) => {
        if (datePeriod !== value) gtag.trackFilterChange('date_period', value);
        setDatePeriod(value);
        setCustomStartDate(null);
        setCustomEndDate(null);
        setCalendarOpen(false);
        if (value !== 'all') {
            const { start, endExclusive } = datePeriodBounds(value, new Date());
            gtag.trackDateFilter(dateKey(start), dateKey(addDays(endExclusive, -1)), {
                method: 'preset',
                presetLabel: DATE_PERIOD_OPTIONS.find(item => item.value === value)?.label,
            });
        }
    };

    const selectCustomDateRange = (update: [Date | null, Date | null]) => {
        const [start, end] = update;
        setCustomStartDate(start);
        setCustomEndDate(end);
        setDatePeriod(start ? 'custom' : 'all');
        if (start && end) {
            gtag.trackFilterChange('date_period', 'custom');
            gtag.trackDateFilter(dateKey(start), dateKey(end), { method: 'calendar' });
        }
    };

    const clearEmptyBlocker = (id: EmptyFilterId) => {
        if (id === 'region') selectRegionFilter('전체');
        else if (id === 'departure') selectDepartureFilter('전체');
        else if (id === 'date') selectDatePeriod('all');
        else if (id === 'price') selectPriceFilter(0);
        else if (id === 'source') selectSourceFilter('all');
        else selectAirlineFilter('all');
    };

    const toggleFavorite = (flight: Flight) => {
        const willFavorite = !favorites.has(flight.id);
        if (account.status !== 'authenticated') {
            openAccount();
            setToast(account.status === 'unavailable'
                ? '지금은 로그인 기능을 불러오지 못했어요. 잠시 후 다시 시도해주세요.'
                : '찜은 로그인하면 저장할 수 있어요.');
            return;
        }
        const mutationVersion = (favoriteMutationVersionRef.current.get(flight.id) || 0) + 1;
        favoriteMutationVersionRef.current.set(flight.id, mutationVersion);
        favoriteIntentRef.current.set(flight.id, willFavorite);
        const next = new Set(favorites);
        if (willFavorite) next.add(flight.id);
        else next.delete(flight.id);
        setFavorites(next);

        if (!willFavorite && guestFavorites.has(flight.id)) {
            const nextGuestFavorites = new Set(guestFavorites);
            nextGuestFavorites.delete(flight.id);
            setGuestFavorites(nextGuestFavorites);
            try { localStorage.setItem('favoriteFlights', JSON.stringify(Array.from(nextGuestFavorites))); } catch { }
        }
        setToast(willFavorite
            ? `${stripAirport(flight.arrival.city)} 항공권을 내 여행에 저장했어요.`
            : '찜에서 뺐어요.');
        void account.setFavorite(flight.id, willFavorite).then(() => {
            if (favoriteMutationVersionRef.current.get(flight.id) !== mutationVersion) return;
            gtag.trackFavoriteChange(willFavorite ? 'add' : 'remove', {
                flightId: flight.id,
                route: normalizedRoute(flight),
                destination: stripAirport(flight.arrival.city),
                source: flight.source,
                price: effectivePrice(flight),
            });
            favoriteIntentRef.current.delete(flight.id);
        }).catch(() => {
            if (favoriteMutationVersionRef.current.get(flight.id) !== mutationVersion) return;
            favoriteIntentRef.current.delete(flight.id);
            setFavorites(current => {
                const restored = new Set(current);
                if (confirmedAccountFavoritesRef.current.has(flight.id)) restored.add(flight.id);
                else restored.delete(flight.id);
                return restored;
            });
            setToast('계정에 저장하지 못해 이전 상태로 되돌렸어요.');
        });
    };

    const submitFlightReport = async (flight: Flight, reportType: 'price_changed' | 'unavailable') => {
        if (flightReport?.status === 'sending') return;
        if (recentFlightReports[flight.id]) {
            setToast('이미 신고가 접수된 항공권이에요.');
            return;
        }
        setFlightReport({ flightId: flight.id, status: 'sending' });
        try {
            const response = await fetch('/api/flight-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    reportType,
                    flight: { id: flight.id, source: flight.source },
                }),
            });
            const result = await response.json().catch(() => ({})) as {
                duplicate?: boolean;
                autoHidden?: boolean;
                error?: string;
            };
            if (!response.ok) throw new Error(result.error || '신고 접수에 실패했습니다.');
            const reportedAt = Date.now();
            const nextReports = { ...recentFlightReports, [flight.id]: reportedAt };
            setRecentFlightReports(nextReports);
            try { localStorage.setItem(RECENT_FLIGHT_REPORTS_KEY, JSON.stringify(nextReports)); } catch { }
            setFlightReport({ flightId: flight.id, status: 'sent' });
            if (result.autoHidden) {
                setFlights(current => current.filter(item => item.id !== flight.id));
                closeSelectedFlight();
                setToast('신고가 여러 건 모여 확인하는 동안 이 표를 잠시 숨겼어요.');
            } else {
                setToast(result.duplicate
                    ? '이미 신고가 처리된 항공권이에요.'
                    : '신고를 접수했어요. 같은 신고가 더 모이면 표를 잠시 숨겨요.');
            }
        } catch (cause) {
            setFlightReport({ flightId: flight.id, status: 'error' });
            setToast(cause instanceof Error ? cause.message : '신고 접수에 실패했습니다.');
        }
    };

    const openFlight = (flight: Flight, entry = 'card_body') => {
        if (
            selectedFlight
            && flightScheduleIdentity(selectedFlight) === flightScheduleIdentity(flight)
            && window.history.state?.tikitikitOverlay === 'flight'
        ) return;
        gtag.trackDetailOpen(
            `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`,
            effectivePrice(flight),
            flight.source,
            entry,
            {
                flightId: flight.id,
                destination: stripAirport(flight.arrival.city),
            },
        );
        account.recordRecent(flight.id);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('flight', flight.id);
        nextUrl.searchParams.set('schedule', flightScheduleToken(flight));
        const historyMethod = window.history.state?.tikitikitOverlay === 'flight'
            ? 'replaceState'
            : 'pushState';
        window.history[historyMethod](
            { ...window.history.state, tikitikitOverlay: 'flight' },
            '',
            `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
        );
        setPassengers({ adult: Math.max(1, flight.minPax || 1), child: 0, infant: 0 });
        setSelectedFlight(flight);
    };

    const openFreshFlight = (flight: Flight) => {
        if (!freshFlightsInsight) return;
        const route = normalizedRoute(flight);
        const sameDateFlights = freshFlightsInsight.targetFlights.filter(candidate => (
            normalizedRoute(candidate) === route
            && candidate.departure.date === flight.departure.date
            && effectivePrice(candidate) > 0
        ));

        if (sameDateFlights.length === 1) {
            gtag.event('insight_click', {
                insight_type: 'new_flights',
                insight_format: 'flight_detail',
                destination: normalizeCity(flight.arrival.city),
                flight_id: flight.id,
            });
            openFlight(sameDateFlights[0], 'insight_new_flights');
            return;
        }

        openFreshRouteResults(flight);
    };

    const openWeekendFlight = (flight: Flight) => {
        gtag.event('insight_click', {
            insight_type: 'weekend_flights',
            insight_format: 'flight_detail',
            destination: normalizeCity(flight.arrival.city),
            flight_id: flight.id,
        });
        openFlight(flight, 'insight_weekend_flights');
    };

    const openInsight = (insight: FeedInsight) => {
        gtag.event('insight_click', {
            insight_type: insight.kind,
            insight_format: insight.editorial ? 'editorial' : 'fact',
            destination: normalizeCity(insight.flight.arrival.city),
            flight_id: insight.flight.id,
        });
        openFlight(insight.flight, `insight_${insight.kind}`);
    };

    const saveAlertSearchCondition = async (condition: AlertSearchCondition) => {
        if (account.status !== 'authenticated') return;
        const destination = condition.arrivalCity
            || (condition.region === 'all' ? '아무데나' : condition.region === '중국' ? '중화권' : condition.region)
            || '아무데나';
        const filters: AccountSearchFilters = {
            searchTerm: condition.arrivalCity || '',
            sortBy: 'discount',
            sortOrder: 'asc',
            sourceFilter: 'all',
            regionFilter: condition.arrivalCity
                ? 'all'
                : condition.region === '중국' ? '중화권' : condition.region || 'all',
            startDate: '',
            endDate: '',
            departureFilter: condition.departureCity,
            airlineFilter: 'all',
            maxPrice: condition.maxPrice,
            datePeriod: 'all',
        };
        const alreadySaved = account.savedSearches.some(item => (
            item.filters.searchTerm === filters.searchTerm
            && item.filters.regionFilter === filters.regionFilter
            && item.filters.departureFilter === filters.departureFilter
            && item.filters.maxPrice === filters.maxPrice
            && (item.filters.datePeriod || 'all') === 'all'
        ));
        if (alreadySaved) return;
        await account.saveSearch(
            `${condition.departureCity} 출발 · ${destination} · ${Math.round(condition.maxPrice / 10_000)}만원 이하`,
            filters,
        );
        gtag.trackAccountAction('save_search');
    };

    const applyAccountSearch = (filters: AccountSearchFilters) => {
        setQuery(filters.searchTerm);
        setSort(filters.sortBy === 'price' ? 'price' : filters.sortBy === 'date' ? 'date' : 'recommended');
        setRegion(filters.regionFilter === 'all'
            ? '전체'
            : filters.regionFilter === '중국'
                ? '중화권'
                : filters.regionFilter);
        setDeparture(filters.departureFilter === 'all' ? '전체'
            : filters.departureFilter === '인천' ? '인천/김포'
                : filters.departureFilter === '부산' ? '부산/김해'
                    : filters.departureFilter);
        setMaxPrice(filters.maxPrice || 0);
        setSourceFilter(SOURCE_OPTIONS.some(option => option.value === filters.sourceFilter)
            ? filters.sourceFilter as 'all' | Flight['source']
            : 'all');
        setAirlineFilter(filters.airlineFilter || 'all');
        if (filters.startDate) {
            setDatePeriod('custom');
            setCustomStartDate(parseDate(filters.startDate));
            setCustomEndDate(filters.endDate ? parseDate(filters.endDate) : null);
        } else {
            setDatePeriod((filters.datePeriod || 'all') as DatePeriod);
            setCustomStartDate(null);
            setCustomEndDate(null);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const openAccountFlight = (flightId: string) => {
        setShowAccount(false);
        const flight = flights.find(item => item.id === flightId);
        if (!flight) {
            setToast('이 표는 현재 목록에서 내려갔어요.');
            return;
        }
        openFlight(flight);
    };

    const shareFlight = async (flight: Flight) => {
        const url = `${window.location.origin}/s/${encodeURIComponent(encodeShareId(flight.id))}`;
        const discountRate = getAverageDiscountRate(flight, interparkPrices);
        const isEmergencyShare = discountRate >= 30
            || (flight.id === featuredPick?.flight.id && discountRate >= 20);
        const routeEntries = (normalizedHistory(priceHistory)[normalizedRoute(flight)] || [])
            .slice(-60);
        const isSixtyDayLow = routeEntries.length >= 20
            && effectivePrice(flight) <= Math.min(...routeEntries.map(entry => entry.minPrice));
        const contextualCopy: string[] = [];
        if (isSixtyDayLow) contextualCopy.push('🏆 최근 60일 중 가장 낮은 가격');
        if (isZeroPtoSchedule(flight)) contextualCopy.push('🏃 0연차 탈출 가능');

        const departureDate = parseDate(flight.departure.date);
        const departureMinutes = clockMinutes(flight.departure.time);
        if (departureDate
            && departureDate.getDay() >= 1
            && departureDate.getDay() <= 5
            && departureMinutes !== null
            && departureMinutes >= 20 * 60) {
            contextualCopy.push(`🌙 ${flight.departure.time} 퇴근 후 출국`);
        }

        const seats = flight.availableSeats || Number.parseInt(flight.seats || '', 10) || 0;
        if (seats > 0 && seats <= 6) contextualCopy.push(`🪑 마지막 ${seats}석 생존`);

        const copyPool = [
            ...(isEmergencyShare ? EMERGENCY_SHARE_COPY : GENERAL_SHARE_COPY),
            ...contextualCopy,
        ];
        const text = `${copyPool[Math.floor(Math.random() * copyPool.length)]} | 티키티킷`;
        const route = normalizedRoute(flight);
        try {
            await navigator.clipboard.writeText(`${text}\n${url}`);
            gtag.trackShare(route, 'clipboard', {
                flightId: flight.id,
                destination: stripAirport(flight.arrival.city),
            });
            setToast('항공권 링크를 복사했어요.');
        } catch {
            setToast('링크를 복사하지 못했어요. 다시 시도해주세요.');
        }
    };

    const resetFilters = () => {
        if (departure !== '전체' || region !== '전체' || datePeriod !== 'all' || maxPrice || sourceFilter !== 'all' || airlineFilter !== 'all') {
            gtag.trackFilterChange('reset', 'all');
        }
        setDeparture('전체');
        setRegion('전체');
        setDatePeriod('all');
        setCustomStartDate(null);
        setCustomEndDate(null);
        setCalendarOpen(false);
        setMaxPrice(0);
        setSourceFilter('all');
        setAirlineFilter('all');
        setAirlineMenuOpen(false);
        setDesktopFilterOpen(null);
        setFreshRouteResults(null);
    };

    const impressionSurface: gtag.FlightImpressionDetails['surface'] = query.trim()
        ? 'search_results'
        : freshRouteResults || !isDefaultView
            ? 'filtered_results'
            : 'recommendation';

    const observeFlightCard = useCallback((
        node: HTMLElement | null,
        flight: Flight,
        position: number,
        surface: gtag.FlightImpressionDetails['surface'],
    ) => {
        if (!node || typeof IntersectionObserver === 'undefined') return;
        const key = `${surface}:${flight.id}`;
        if (node.dataset.impressionKey === key) return;
        node.dataset.impressionKey = key;
        impressionPayloadsRef.current.set(node, {
            flightId: flight.id,
            route: normalizedRoute(flight),
            destination: stripAirport(flight.arrival.city),
            source: flight.source,
            price: effectivePrice(flight),
            position,
            surface,
        });
        if (!impressionObserverRef.current) {
            impressionObserverRef.current = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    const activeTimer = impressionTimersRef.current.get(entry.target);
                    if (!entry.isIntersecting || entry.intersectionRatio < 0.5) {
                        if (activeTimer) clearTimeout(activeTimer);
                        impressionTimersRef.current.delete(entry.target);
                        return;
                    }
                    if (activeTimer) return;
                    const timer = setTimeout(() => {
                        impressionTimersRef.current.delete(entry.target);
                        const payload = impressionPayloadsRef.current.get(entry.target);
                        if (!payload) return;
                        const impressionKey = `${payload.surface}:${payload.flightId}`;
                        if (!recordedImpressionsRef.current.has(impressionKey)) {
                            recordedImpressionsRef.current.add(impressionKey);
                            gtag.trackFlightImpression(payload);
                        }
                        impressionObserverRef.current?.unobserve(entry.target);
                    }, 1000);
                    impressionTimersRef.current.set(entry.target, timer);
                });
            }, { threshold: [0, 0.5, 1] });
        }
        impressionObserverRef.current.observe(node);
    }, []);

    useEffect(() => () => {
        impressionObserverRef.current?.disconnect();
        impressionTimersRef.current.forEach(timer => clearTimeout(timer));
        impressionTimersRef.current.clear();
        impressionPayloadsRef.current.clear();
    }, []);

    const submitContact = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!contactForm.message.trim() || contactStatus === 'sending') return;
        setContactStatus('sending');
        setContactMessage('');
        try {
            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(contactForm),
            });
            if (!response.ok) throw new Error('문의 전송에 실패했어요.');
            setContactStatus('sent');
            setContactMessage('문의가 전송됐어요. 확인 후 답변드릴게요.');
            setContactForm({ name: '', email: '', message: '' });
        } catch (cause) {
            setContactStatus('error');
            setContactMessage(cause instanceof Error ? cause.message : '문의 전송에 실패했어요.');
        }
    };

    return (
        <Root
            className={styles.previewPage}
            data-keyboard-navigation={keyboardNavigation ? 'true' : 'false'}
            onPointerDownCapture={() => setKeyboardNavigation(false)}
            onKeyDownCapture={event => {
                if (event.key === 'Tab') setKeyboardNavigation(true);
            }}
        >
            <div className={styles.phoneCanvas}>
                <header className={styles.header}>
                    <a href={previewMode ? '/preview/mobile-redesign' : '/'} className={styles.logoLink} aria-label="티키티킷 홈">
                        <Logo size={0.84} />
                    </a>
                    <div className={styles.headerActions}>
                        <div
                            className={styles.desktopSearch}
                            role="search"
                            onFocus={() => setDesktopSearchFocused(true)}
                            onBlur={event => {
                                if (event.currentTarget.contains(event.relatedTarget)) return;
                                rememberSearch(query);
                                setDesktopSearchFocused(false);
                            }}
                        >
                            <Icon name="search" />
                            <input
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') {
                                        rememberSearch(query);
                                        setDesktopSearchFocused(false);
                                    }
                                }}
                                placeholder="도시·항공사 검색"
                                aria-label="도시·항공사 검색"
                                autoComplete="off"
                                maxLength={40}
                            />
                            {query && (
                                <button type="button" className={styles.desktopSearchClear} onClick={() => setQuery('')} aria-label="검색어 지우기">
                                    <Icon name="close" />
                                </button>
                            )}
                            {desktopSearchFocused && recentSearches.length > 0 && (
                                <div className={styles.desktopRecentSearches} aria-label="최근 검색어">
                                    <div className={styles.desktopRecentHeader}>
                                        <strong>최근 검색</strong>
                                        <button type="button" onClick={clearRecentSearches}>전체 삭제</button>
                                    </div>
                                    <div className={styles.desktopRecentList}>
                                        {recentSearches
                                            .filter(item => !query.trim() || item.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR')))
                                            .map(item => (
                                                <div className={styles.desktopRecentItem} key={item}>
                                                    <button
                                                        type="button"
                                                        className={styles.desktopRecentTerm}
                                                        onClick={() => {
                                                            setQuery(item);
                                                            rememberSearch(item);
                                                            setDesktopSearchFocused(false);
                                                        }}
                                                    >
                                                        <Icon name="search" />
                                                        <span>{item}</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.desktopRecentRemove}
                                                        onClick={() => removeRecentSearch(item)}
                                                        aria-label={`${item} 검색 기록 삭제`}
                                                    >
                                                        <Icon name="close" />
                                                    </button>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <button ref={searchButtonRef} type="button" className={`${styles.iconButton} ${styles.mobileSearchButton}`} onClick={() => setSearchOpen(value => !value)} aria-label="검색">
                            <Icon name="search" />
                        </button>
                        {PUBLIC_DEAL_ALERTS_ENABLED && (
                            <button type="button" className={styles.alertButton} onClick={() => openDealAlert(null)}>특가 알림</button>
                        )}
                        <button type="button" className={styles.accountIconButton} onClick={() => { gtag.trackAccountAction('open', previewMode ? 'preview' : 'main'); openAccount(); }} aria-label={account.status === 'authenticated' ? '내 여행 열기' : '로그인'}>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 19c.6-3.5 3-5.4 6.5-5.4s5.9 1.9 6.5 5.4" /></svg>
                            <span className={styles.accountLabel}>{account.status === 'authenticated' ? '내 여행' : '로그인'}</span>
                        </button>
                    </div>
                </header>

                {searchOpen && (
                    <div className={styles.searchRow}>
                        <Icon name="search" />
                        <input
                            autoFocus
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            onBlur={() => rememberSearch(query)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') rememberSearch(query);
                            }}
                            placeholder="도시나 항공사 검색"
                            aria-label="도시나 항공사 검색"
                        />
                        {query && <button type="button" onClick={() => setQuery('')}>지우기</button>}
                    </div>
                )}

                <section className={styles.feedIntro}>
                    <div>
                        <p>전국 여행사의 땡처리 항공권을 한눈에! 🚀</p>
                        <h1>지금 나온 땡처리 항공권</h1>
                    </div>
                </section>

                <div className={styles.conditionFilterAnchor} ref={filterBarSlotRef}>
                    <div className={`${styles.conditionFilterSlot} ${filterBarPinned ? styles.conditionFilterSlotPinned : ''}`}>
                        <div className={styles.desktopFilterPanel} aria-label="항공권 필터" ref={desktopFilterRef}>
                            <div className={styles.desktopFilterControl}>
                                <button
                                    type="button"
                                    className={`${styles.desktopFilterSummary} ${departure !== '전체' ? styles.desktopFilterSummaryActive : ''}`}
                                    aria-expanded={desktopFilterOpen === 'departure'}
                                    onClick={event => {
                                        desktopFilterTriggerRef.current = event.currentTarget;
                                        setDesktopFilterOpen(open => open === 'departure' ? null : 'departure');
                                    }}
                                >
                                    <span>출발지</span>
                                    <strong>{departure === '전체' ? '전체' : departureFilterLabel}</strong>
                                    <span className={`${styles.desktopFilterChevron} ${desktopFilterOpen === 'departure' ? styles.desktopFilterChevronOpen : ''}`}><Icon name="chevron" /></span>
                                </button>
                                {desktopFilterOpen === 'departure' && (
                                    <div className={styles.desktopFilterPopover}>
                                        {DEPARTURE_OPTIONS.map(item => (
                                            <button
                                                type="button"
                                                key={item}
                                                className={departure === item ? styles.desktopFilterOptionActive : ''}
                                                aria-pressed={departure === item}
                                                onClick={() => {
                                                    selectDepartureFilter(item);
                                                    setDesktopFilterOpen(null);
                                                }}
                                            >
                                                {item}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className={styles.desktopFilterControl}>
                                <button
                                    type="button"
                                    className={`${styles.desktopFilterSummary} ${region !== '전체' ? styles.desktopFilterSummaryActive : ''}`}
                                    aria-expanded={desktopFilterOpen === 'region'}
                                    onClick={event => {
                                        desktopFilterTriggerRef.current = event.currentTarget;
                                        setDesktopFilterOpen(open => open === 'region' ? null : 'region');
                                    }}
                                >
                                    <span>도착지</span>
                                    <strong>{region}</strong>
                                    <span className={`${styles.desktopFilterChevron} ${desktopFilterOpen === 'region' ? styles.desktopFilterChevronOpen : ''}`}><Icon name="chevron" /></span>
                                </button>
                                {desktopFilterOpen === 'region' && (
                                    <div className={`${styles.desktopFilterPopover} ${styles.desktopFilterPopoverWide}`}>
                                        {REGION_OPTIONS.map(item => (
                                            <button
                                                type="button"
                                                key={item}
                                                className={region === item ? styles.desktopFilterOptionActive : ''}
                                                aria-pressed={region === item}
                                                onClick={() => {
                                                    selectRegionFilter(item);
                                                    setDesktopFilterOpen(null);
                                                }}
                                            >
                                                {item}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className={styles.desktopFilterControl}>
                                <button
                                    type="button"
                                    className={`${styles.desktopFilterSummary} ${datePeriod !== 'all' ? styles.desktopFilterSummaryActive : ''}`}
                                    aria-expanded={desktopFilterOpen === 'date'}
                                    onClick={event => {
                                        desktopFilterTriggerRef.current = event.currentTarget;
                                        setDesktopFilterOpen(open => open === 'date' ? null : 'date');
                                        setCalendarOpen(false);
                                    }}
                                >
                                    <span>날짜</span>
                                    <strong>{dateFilterLabel === '날짜' ? '전체' : dateFilterLabel}</strong>
                                    <span className={`${styles.desktopFilterChevron} ${desktopFilterOpen === 'date' ? styles.desktopFilterChevronOpen : ''}`}><Icon name="chevron" /></span>
                                </button>
                                {desktopFilterOpen === 'date' && (
                                    <div className={`${styles.desktopFilterPopover} ${styles.desktopFilterDatePopover}`}>
                                        <div className={styles.desktopFilterDateOptions}>
                                            {DATE_PERIOD_OPTIONS.map(item => (
                                                <button
                                                    type="button"
                                                    key={item.value}
                                                    className={datePeriod === item.value ? styles.desktopFilterOptionActive : ''}
                                                    aria-pressed={datePeriod === item.value}
                                                    onClick={() => {
                                                        selectDatePeriod(item.value);
                                                        setDesktopFilterOpen(null);
                                                    }}
                                                >
                                                    {item.label}
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                className={datePeriod === 'custom' ? styles.desktopFilterOptionActive : ''}
                                                aria-pressed={datePeriod === 'custom'}
                                                onClick={() => setCalendarOpen(open => !open)}
                                            >
                                                날짜 직접 선택
                                            </button>
                                        </div>
                                        {calendarOpen && (
                                            <div className={`${styles.dateCalendarWrap} ${styles.desktopDateCalendarWrap}`}>
                                                <DatePicker
                                                    selectsRange
                                                    startDate={customStartDate}
                                                    endDate={customEndDate}
                                                    onChange={(update: [Date | null, Date | null]) => {
                                                        const [, end] = update;
                                                        selectCustomDateRange(update);
                                                        if (end) {
                                                            window.setTimeout(() => {
                                                                setCalendarOpen(false);
                                                                setDesktopFilterOpen(null);
                                                            }, 250);
                                                        }
                                                    }}
                                                    locale={ko}
                                                    inline
                                                    minDate={new Date()}
                                                    calendarClassName={styles.dateCalendar}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className={styles.desktopFilterControl}>
                                <button
                                    type="button"
                                    className={`${styles.desktopFilterSummary} ${maxPrice > 0 ? styles.desktopFilterSummaryActive : ''}`}
                                    aria-expanded={desktopFilterOpen === 'price'}
                                    onClick={event => {
                                        desktopFilterTriggerRef.current = event.currentTarget;
                                        setDesktopFilterOpen(open => open === 'price' ? null : 'price');
                                    }}
                                >
                                    <span>가격</span>
                                    <strong>{maxPrice ? PRICE_OPTIONS.find(item => item.value === maxPrice)?.label : '전체'}</strong>
                                    <span className={`${styles.desktopFilterChevron} ${desktopFilterOpen === 'price' ? styles.desktopFilterChevronOpen : ''}`}><Icon name="chevron" /></span>
                                </button>
                                {desktopFilterOpen === 'price' && (
                                    <div className={styles.desktopFilterPopover}>
                                        {PRICE_OPTIONS.map(item => (
                                            <button
                                                type="button"
                                                key={item.value}
                                                className={maxPrice === item.value ? styles.desktopFilterOptionActive : ''}
                                                aria-pressed={maxPrice === item.value}
                                                onClick={() => {
                                                    selectPriceFilter(item.value);
                                                    setDesktopFilterOpen(null);
                                                }}
                                            >
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <button
                                type="button"
                                className={`${styles.desktopAdvancedFilter} ${(sourceFilter !== 'all' || airlineFilter !== 'all') ? styles.desktopAdvancedFilterActive : ''}`}
                                onClick={event => {
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    const panelWidth = Math.min(640, window.innerWidth - 48);
                                    const top = rect.bottom + 8;
                                    setFilterPopoverPosition({
                                        top,
                                        left: Math.max(24, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 24)),
                                        maxHeight: Math.max(280, window.innerHeight - top - 24),
                                    });
                                    openFilter();
                                }}
                            >
                                <Icon name="sliders" />
                                <span className={styles.desktopAdvancedFilterLabel}>상세 조건</span>
                                {(sourceFilter !== 'all' || airlineFilter !== 'all') && <i aria-hidden="true" />}
                            </button>
                            <button
                                type="button"
                                className={styles.desktopFilterReset}
                                disabled={!hasAdvancedFilter && region === '전체'}
                                onClick={resetFilters}
                            >
                                초기화
                            </button>
                        </div>
                        <div className={styles.quickFilterRow}>
                        <button type="button" className={`${styles.filterButton} ${hasAdvancedFilter ? styles.filterHasValue : ''}`} onClick={openFilter}>
                            <Icon name="sliders" />
                            필터
                        </button>
                        <nav className={`${styles.quickFilters} ${styles.regionChipRail}`} aria-label="도착 지역 빠른 선택">
                            {QUICK_REGION_OPTIONS.map(item => (
                                <button
                                    type="button"
                                    key={item}
                                    className={region === item ? styles.activeFilter : ''}
                                    aria-label={`도착 지역 ${item}`}
                                    aria-pressed={region === item}
                                    onClick={() => {
                                        selectRegionFilter(item);
                                        setRegionMoreOpen(false);
                                    }}
                                >
                                    {item}
                                </button>
                            ))}
                            <button
                                type="button"
                                className={`${styles.moreRegionButton} ${MORE_REGION_OPTIONS.includes(region) ? styles.activeFilter : ''}`}
                                aria-label="다른 도착 지역 선택"
                                aria-expanded={regionMoreOpen}
                                onClick={() => setRegionMoreOpen(open => !open)}
                            >
                                {MORE_REGION_OPTIONS.includes(region) ? region : '···'}
                            </button>
                        </nav>
                        {regionMoreOpen && (
                            <nav className={styles.moreRegionInline} aria-label="추가 도착 지역">
                                {MORE_REGION_OPTIONS.map(item => (
                                    <button
                                        type="button"
                                        key={item}
                                        className={region === item ? styles.moreRegionActive : ''}
                                        aria-pressed={region === item}
                                        onClick={() => {
                                            selectRegionFilter(item);
                                            setRegionMoreOpen(false);
                                        }}
                                    >
                                        {item}
                                    </button>
                                ))}
                            </nav>
                        )}
                        </div>
                        <nav
                            className={`${styles.conditionFilterBar} ${styles.conditionFilterBarPinned} ${filterBarPinned ? styles.conditionFilterBarVisible : ''}`}
                            aria-label="현재 항공권 조건"
                            aria-hidden={!filterBarPinned}
                        >
                            <div className={styles.conditionSummaryRow}>
                                <button type="button" tabIndex={filterBarPinned ? 0 : -1} className={departure !== '전체' ? styles.conditionActive : ''} onClick={openFilter}>
                                    <span aria-hidden="true">✈️</span>
                                    출발 {departureFilterLabel === '출발지' ? '전체' : departureFilterLabel}
                                    <span className={styles.conditionChevron} aria-hidden="true"><Icon name="chevron" /></span>
                                </button>
                                <button type="button" tabIndex={filterBarPinned ? 0 : -1} className={region !== '전체' ? styles.conditionActive : ''} onClick={openFilter}>
                                    <span aria-hidden="true">📍</span>
                                    도착 {destinationFilterLabel === '목적지' ? '전체' : destinationFilterLabel}
                                    <span className={styles.conditionChevron} aria-hidden="true"><Icon name="chevron" /></span>
                                </button>
                                <button type="button" tabIndex={filterBarPinned ? 0 : -1} className={datePeriod !== 'all' ? styles.conditionActive : ''} onClick={openFilter}>
                                    <span aria-hidden="true">📅</span>
                                    {dateFilterLabel === '날짜' ? '일정 전체' : dateFilterLabel}
                                    <span className={styles.conditionChevron} aria-hidden="true"><Icon name="chevron" /></span>
                                </button>
                            </div>
                        </nav>
                    </div>
                </div>

                <section className={styles.feedSection} ref={feedSectionRef}>
                    <div className={`${styles.feedHeading} ${freshRouteResults ? styles.freshRouteHeading : ''}`}>
                        <div>
                            <h2>{freshRouteResults
                                ? `${freshRouteResults.departure} → ${freshRouteResults.arrival}`
                                : query ? `'${query}' 검색 결과` : region === '전체' ? '전체 항공권' : `${region} 항공권`}</h2>
                            <span>{listLoading
                                ? '항공권 불러오는 중'
                                : freshRouteResults
                                    ? `${freshRouteResults.copyPrefix} 들어온 항공권 ${feedFlights.length.toLocaleString('ko-KR')}개`
                                    : `${resultCount.toLocaleString('ko-KR')}개 · ${updatedLabel}`}</span>
                        </div>
                        <div className={styles.feedHeadingActions}>
                            {freshRouteResults && (
                                <button type="button" className={styles.freshRouteResultBack} onClick={closeFreshRouteResults}>
                                    <span aria-hidden="true">←</span> 전체 항공권
                                </button>
                            )}
                            <div className={styles.sortSelect} ref={sortMenuRef}>
                                <button
                                    ref={sortTriggerRef}
                                    type="button"
                                    className={styles.sortTrigger}
                                    aria-label="항공권 정렬"
                                    aria-controls="flight-sort-options"
                                    aria-expanded={sortOpen}
                                    onClick={() => setSortOpen(value => !value)}
                                >
                                    {SORT_OPTIONS.find(option => option.value === sort)?.label}
                                    <span className={`${styles.sortChevron} ${sortOpen ? styles.sortChevronOpen : ''}`} aria-hidden="true"><Icon name="chevron" /></span>
                                </button>
                                {sortOpen && (
                                    <div id="flight-sort-options" className={styles.sortMenu} role="group" aria-label="정렬 방식">
                                        {SORT_OPTIONS.map(option => (
                                            <button
                                                type="button"
                                                aria-pressed={sort === option.value}
                                                className={`${styles.sortOption} ${sort === option.value ? styles.sortOptionSelected : ''}`}
                                                key={option.value}
                                                onClick={() => {
                                                    selectSort(option.value);
                                                    setSortOpen(false);
                                                }}
                                            >
                                                <span>{option.label}</span>
                                                {sort === option.value && <span className={styles.sortCheck} aria-hidden="true">✓</span>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {expiredShareNotice
                        && (!expiredShareNotice.arrival
                            || normalizeCity(query.trim()) === normalizeCity(expiredShareNotice.arrival))
                        && (
                            <div className={styles.expiredShareNotice} role="status">
                                <span className={styles.expiredShareNoticeIcon} aria-hidden="true">😅</span>
                                <div className={styles.expiredShareNoticeCopy}>
                                    <strong>아, 조금 늦었네요.</strong>
                                    <span>
                                        공유된 표는 판매가 종료됐어요.<br />
                                        {expiredShareNotice.arrival
                                            ? `${stripAirport(expiredShareNotice.arrival)}의 현재 항공권을 대신 보여드려요.`
                                            : '지금 예약할 수 있는 항공권을 대신 보여드려요.'}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className={styles.expiredShareNoticeClose}
                                    aria-label="판매 종료 안내 닫기"
                                    onClick={() => setExpiredShareNotice(null)}
                                >
                                    <Icon name="close" />
                                </button>
                            </div>
                        )}

                    {listLoading && (
                        <div className={styles.loadingList} aria-label="항공권 불러오는 중">
                            {[0, 1, 2].map(item => <div className={styles.skeletonCard} key={item} />)}
                        </div>
                    )}

                    {error && (
                        <div className={styles.emptyState} role="alert">
                            <strong>잠시 불러오지 못했어요.</strong>
                            <span>{error}</span>
                            <button type="button" onClick={() => void loadFlights()}>다시 불러오기</button>
                        </div>
                    )}

                    {!listLoading && !error && (freshRouteResults ? feedFlights.length === 0 : filteredFlights.length === 0) && (
                        <div className={styles.emptyState}>
                            {freshRouteResults ? (
                                <>
                                    <strong>조금 전 본 표가 목록에서 내려갔어요.</strong>
                                    <span>현재 예약할 수 있는 전체 항공권을 다시 보여드릴게요.</span>
                                </>
                            ) : emptyDiagnosis?.kind === 'filtered' ? (
                                <>
                                    <strong>
                                        {query.trim()
                                            ? `${query.trim()} 표는 ${emptyDiagnosis.available.toLocaleString('ko-KR')}개 있어요.`
                                            : '표는 있지만 조건이 서로 겹쳤어요.'}
                                    </strong>
                                    <span>아래 조건을 하나씩 풀어보세요.</span>
                                    {emptyDiagnosis.blockers.length > 0 && (
                                        <div className={styles.emptyBlockers}>
                                            {emptyDiagnosis.blockers.map(blocker => (
                                                <button
                                                    type="button"
                                                    key={blocker.id}
                                                    onClick={() => clearEmptyBlocker(blocker.id)}
                                                >
                                                    {blocker.label}
                                                    {blocker.revealedCount > 0 && <small>{blocker.revealedCount.toLocaleString('ko-KR')}개 보기</small>}
                                                    <b aria-hidden="true">×</b>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <strong>조건에 맞는 표가 없어요.</strong>
                                    <span>다른 목적지를 검색하거나 조건을 조금 넓혀보세요.</span>
                                </>
                            )}
                            <div className={styles.emptyStateActions}>
                                <button type="button" onClick={freshRouteResults ? closeFreshRouteResults : resetFilters}>
                                    {freshRouteResults ? '전체 항공권 보기' : '필터 초기화'}
                                </button>
                                {!freshRouteResults && PUBLIC_DEAL_ALERTS_ENABLED && emptyRouteAlertTarget && (
                                    <button
                                        type="button"
                                        onClick={() => openDealAlert(emptyRouteAlertTarget)}
                                    >{emptyRouteAlertTarget.arrivalCity} 표 나오면 알림</button>
                                )}
                            </div>
                        </div>
                    )}

                    {!listLoading && !error && <div className={styles.cardList}>
                        {feedFlights.slice(0, visibleCount).map((flight, index) => {
                            const seats = flight.availableSeats || Number.parseInt(flight.seats || '', 10) || 0;
                            const duration = tripLength(flight);
                            const destination = stripAirport(flight.arrival.city);
                            const price = effectivePrice(flight);
                            const averageDiscountRate = getAverageDiscountRate(flight, interparkPrices);
                            const isTodayPick = !freshRouteResults && isDefaultView && featuredPick?.flight.id === flight.id;
                            const cardNumber = index + 1;
                            return (
                                <Fragment key={flight.id}>
                                    <div className={styles.cardEntry}>
                                        <article
                                            ref={node => observeFlightCard(node, flight, cardNumber, impressionSurface)}
                                            className={`${styles.flightCard} ${isTodayPick ? styles.todayPickCard : ''}`}
                                            data-flight-id={flight.id}
                                            data-source={flight.source}
                                            data-tikit-drop={isTodayPick ? 'true' : undefined}
                                        >
                                            <button
                                                type="button"
                                                className={styles.cardBody}
                                                onClick={() => openFlight(flight, freshRouteResults ? 'insight_new_flights_result' : 'card_body')}
                                            >
                                                {isTodayPick && (
                                                    <span className={styles.todayPickStrip}>
                                                        <strong>TIKIT DROP</strong>
                                                    </span>
                                                )}
                                                <div className={styles.cardTopline}>
                                                    <div>
                                                        <span className={`${styles.sourceBadge} ${styles[flight.source]}`}>{SOURCE_NAMES[flight.source]}</span>
                                                        <span className={styles.airline}>{flight.airline || '항공사 확인'}</span>
                                                    </div>
                                                </div>

                                                <div className={styles.routeGrid}>
                                                    <div className={styles.routeEndpoint}>
                                                        <strong>{departureName(flight)}</strong>
                                                        <div className={styles.routeTiming}>
                                                            <b>{cardDate(flight.departure.date)}</b>
                                                            <em>{flight.departure.time || '시간 확인'}</em>
                                                        </div>
                                                    </div>
                                                    <div className={styles.routeConnector} aria-hidden="true">
                                                        <Icon name="plane" />
                                                        {duration && <span>{duration}</span>}
                                                    </div>
                                                    <div className={`${styles.routeEndpoint} ${styles.routeEndpointArrival}`}>
                                                        <strong>{destination}</strong>
                                                        <div className={styles.routeTiming}>
                                                            <b>{cardDate(flight.arrival.date)}</b>
                                                            <em>{flight.arrival.time || '시간 확인'}</em>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className={styles.ticketDivider} aria-hidden="true" />

                                                <div className={styles.cardFooter}>
                                                    <div className={styles.availabilityGroup}>
                                                        {isTodayPick ? (
                                                            <span className={`${styles.footerStatus} ${styles.todayPickStatus}`}>
                                                                <span className={styles.dropMessageMobile}>{compactDropCardMessage(featuredPick?.reason || '')}</span>
                                                                <span className={styles.dropMessageDesktop}>{featuredPick?.reason}</span>
                                                                {!featuredPick?.repeatPriceDrop && averageDiscountRate >= 5 && (
                                                                    <span
                                                                        className={styles.dropDiscountInline}
                                                                        aria-label={`${averageDiscountRate}% 낮음`}
                                                                    >
                                                                        <span aria-hidden="true">↓</span>{averageDiscountRate}%
                                                                    </span>
                                                                )}
                                                            </span>
                                                        ) : seats > 0 && (
                                                            <span className={`${styles.footerStatus} ${seats <= 4 ? styles.footerStatusLow : ''}`}>
                                                                {seats}석 남음
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className={styles.priceBlock}>
                                                        <div className={styles.priceLine}>
                                                            {!isTodayPick && averageDiscountRate >= 5 && (
                                                                <span
                                                                    className={styles.priceDiscountBadge}
                                                                    aria-label={`동일 목적지 월평균가보다 ${averageDiscountRate}% 낮은 가격`}
                                                                >
                                                                    -{averageDiscountRate}%
                                                                </span>
                                                            )}
                                                            <strong>
                                                                {(flight.source === 'ttang' ? flight.price : price).toLocaleString('ko-KR')}
                                                                <small>원</small>
                                                            </strong>
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                            <button
                                                type="button"
                                                className={`${styles.favoriteButton} ${favorites.has(flight.id) ? styles.favoriteActive : ''}`}
                                                onClick={() => toggleFavorite(flight)}
                                                aria-label={favorites.has(flight.id)
                                                    ? '찜 해제'
                                                    : account.status === 'authenticated' ? '찜하기' : '로그인하고 찜하기'}
                                            >
                                                <Icon name="bookmark" />
                                            </button>
                                        </article>
                                    </div>
                                    {!freshRouteResults && cardNumber === firstInsightCard && freshFlightsInsight && (
                                        <div className={styles.freshFlightsEntry}>
                                            <section
                                                className={styles.freshFlightsBar}
                                                aria-labelledby="fresh-flights-title"
                                                data-fresh-route-count={freshMobileFlightCount}
                                            >
                                                <div className={styles.freshFlightsMobileTopline}>
                                                    <span>새로 발견</span>
                                                    {freshMobileFlightCount > 1 && (
                                                        <span aria-hidden="true">
                                                            {freshMobileActiveIndex + 1} / {freshMobileFlightCount}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className={styles.freshFlightsCopy}>
                                                    <span className={styles.freshFlightsDesktopEyebrow}>새로 발견</span>
                                                    <strong id="fresh-flights-title">{freshFlightsInsight.copyPrefix} 새로 뜬 항공권</strong>
                                                    <p>{freshFlightsInsight.copyPrefix} 처음 포착된 항공권을 보여드려요.</p>
                                                </div>
                                                <div
                                                    className={styles.freshFlightsMobileViewport}
                                                    aria-label={`${freshFlightsInsight.copyPrefix} 처음 포착된 항공권. 위아래로 밀어 다른 항공권 보기`}
                                                    onPointerDown={handleFreshMobilePointerDown}
                                                    onPointerMove={handleFreshMobilePointerMove}
                                                    onPointerUp={handleFreshMobilePointerEnd}
                                                    onPointerCancel={handleFreshMobilePointerEnd}
                                                >
                                                    <div
                                                        className={`${styles.freshFlightsMobileTrack} ${freshMobileAnimating ? styles.freshFlightsMobileTrackAnimated : ''}`}
                                                        style={{ transform: `translateY(${(-freshMobilePosition * FRESH_MOBILE_ITEM_HEIGHT) + freshMobileDragOffset}px)` }}
                                                    >
                                                        {freshMobileLoopingFlights.map((freshFlight, ticketIndex) => (
                                                            <button
                                                                type="button"
                                                                className={styles.freshFlightsMobileTicket}
                                                                key={`${freshFlight.id}-mobile-${ticketIndex}`}
                                                                data-fresh-flight-id={freshFlight.id}
                                                                data-fresh-schedule-count={freshFlightsInsight.scheduleCountByFlightId.get(freshFlight.id) || 1}
                                                                onClick={(event) => {
                                                                    if (freshMobileSuppressClickRef.current) {
                                                                        event.preventDefault();
                                                                        freshMobileSuppressClickRef.current = false;
                                                                        return;
                                                                    }
                                                                    openFreshFlight(freshFlight);
                                                                }}
                                                            >
                                                                <span className={styles.freshFlightsMobileTicketMain}>
                                                                    <span className={styles.freshFlightsMobilePlace}>
                                                                        <small>{departureName(freshFlight)} 출발</small>
                                                                        <strong>{stripAirport(freshFlight.arrival.city)}</strong>
                                                                    </span>
                                                                    <span className={styles.freshFlightsMobilePrice}>
                                                                        <small>왕복 총액</small>
                                                                        <strong>{effectivePrice(freshFlight).toLocaleString('ko-KR')}<i>원</i></strong>
                                                                    </span>
                                                                </span>
                                                                <span className={styles.freshFlightsMobileSchedule}>
                                                                    <span>{cardDate(freshFlight.departure.date)} — {cardDate(freshFlight.arrival.date)}</span>
                                                                    <small>
                                                                        {[
                                                                            tripLength(freshFlight),
                                                                            (freshFlightsInsight.scheduleCountByFlightId.get(freshFlight.id) || 1) > 1
                                                                                ? `같은 가격 일정 ${freshFlightsInsight.scheduleCountByFlightId.get(freshFlight.id)}개`
                                                                                : null,
                                                                        ].filter(Boolean).join(' · ')}
                                                                    </small>
                                                                </span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div
                                                    className={styles.freshFlightsViewport}
                                                    aria-label={`${freshFlightsInsight.copyPrefix} 처음 포착된 항공권. 마우스로 위아래로 드래그해 다른 항공권 보기`}
                                                    onPointerDown={handleFreshDesktopPointerDown}
                                                    onPointerMove={handleFreshDesktopPointerMove}
                                                    onPointerUp={handleFreshDesktopPointerEnd}
                                                    onPointerCancel={handleFreshDesktopPointerEnd}
                                                >
                                                    <div
                                                        className={`${styles.freshFlightsTrack} ${freshDesktopAnimating ? styles.freshFlightsTrackAnimated : ''}`}
                                                        style={{ transform: `translateY(${(-freshDesktopPosition * FRESH_DESKTOP_PAIR_HEIGHT) + freshDesktopDragOffset}px)` }}
                                                    >
                                                        {freshDesktopLoopingPairs.map((pair, pairIndex) => (
                                                            <div
                                                                className={`${styles.freshFlightsPair} ${pair.length === 1 ? styles.freshFlightsPairSingle : ''}`}
                                                                key={`fresh-flights-pair-${pairIndex}`}
                                                            >
                                                                {pair.map((freshFlight, ticketIndex) => (
                                                                    <button
                                                                        type="button"
                                                                        className={styles.freshFlightsTicket}
                                                                        key={`${freshFlight.id}-${pairIndex}-${ticketIndex}`}
                                                                        data-fresh-flight-id={freshFlight.id}
                                                                        data-fresh-schedule-count={freshFlightsInsight.scheduleCountByFlightId.get(freshFlight.id) || 1}
                                                                        onClick={(event) => {
                                                                            if (freshDesktopSuppressClickRef.current) {
                                                                                event.preventDefault();
                                                                                freshDesktopSuppressClickRef.current = false;
                                                                                return;
                                                                            }
                                                                            openFreshFlight(freshFlight);
                                                                        }}
                                                                    >
                                                                        <span className={styles.freshFlightsTicketMain}>
                                                                            <span className={styles.freshFlightsPlace}>
                                                                                <small>{departureName(freshFlight)} 출발</small>
                                                                                <strong>{stripAirport(freshFlight.arrival.city)}</strong>
                                                                            </span>
                                                                            <span className={styles.freshFlightsPrice}>
                                                                                <small>왕복 총액</small>
                                                                                <strong>{effectivePrice(freshFlight).toLocaleString('ko-KR')}<i>원</i></strong>
                                                                            </span>
                                                                        </span>
                                                                        <span className={styles.freshFlightsSchedule}>
                                                                            <span>{cardDate(freshFlight.departure.date)} — {cardDate(freshFlight.arrival.date)}</span>
                                                                            <small>
                                                                                {[
                                                                                    tripLength(freshFlight),
                                                                                    (freshFlightsInsight.scheduleCountByFlightId.get(freshFlight.id) || 1) > 1
                                                                                        ? `같은 가격 일정 ${freshFlightsInsight.scheduleCountByFlightId.get(freshFlight.id)}개`
                                                                                        : null,
                                                                                ].filter(Boolean).join(' · ')}
                                                                            </small>
                                                                        </span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </section>
                                        </div>
                                    )}
                                    {!freshRouteResults
                                        && isDefaultView
                                        && cardNumber === weeklyDiscoveryInsightCard
                                        && weeklyDiscoveryFlights.length > 0 && (
                                            <WeeklyDiscoveryInsight
                                                flights={weeklyDiscoveryFlights}
                                                onOpen={closeSelectedFlight}
                                            />
                                        )}
                                    {!freshRouteResults
                                        && isDefaultView
                                        && cardNumber === weekendFlightsInsightCard
                                        && weekendFlights.length > 0 && (
                                            <WeekendFlightsInsight
                                                flights={weekendFlights}
                                                onOpen={openWeekendFlight}
                                            />
                                        )}
                                </Fragment>
                            );
                        })}
                    </div>}

                    {!listLoading && !error && visibleCount < feedFlights.length && (
                        <button
                            type="button"
                            className={styles.moreButton}
                            onClick={() => setVisibleCount(count => count + (window.matchMedia('(min-width: 960px)').matches ? 36 : 18))}
                        >
                            특가 더 보기
                        </button>
                    )}

                    {isDefaultView && !freshRouteResults && feedFlights.length > 0 && (
                        <RedesignAdSlot preview={previewMode} />
                    )}
                </section>

                {beforeFooter}
                <div className={styles.footerSpacer} aria-hidden="true" />
                <footer className={styles.siteFooter}>
                    <div className={styles.siteFooterGrid}>
                        <section className={styles.siteFooterBrand}>
                            <Logo size={0.68} />
                            <p>좋은 표 하나가, 주말을 여행으로.</p>
                            <div>
                                <a href="/drop">TIKIT DROP</a>
                                <a href="/tips">가격 기록과 여행 팁</a>
                                <a href="/about">티키티킷 안내</a>
                            </div>
                        </section>
                        <section>
                            <strong>여행사 바로가기</strong>
                            <div className={styles.siteFooterLinks}>
                                <a href="https://www.hanatour.com" target="_blank" rel="noopener noreferrer">하나투어</a>
                                <a href="https://www.modetour.com" target="_blank" rel="noopener noreferrer">모두투어</a>
                                <a href="https://www.ybtour.co.kr" target="_blank" rel="noopener noreferrer">노랑풍선</a>
                                <a href="https://www.onlinetour.co.kr" target="_blank" rel="noopener noreferrer">온라인투어</a>
                                <a href="https://www.ttang.com" target="_blank" rel="noopener noreferrer">땡처리닷컴</a>
                                <a href="https://www.myrealtrip.com" target="_blank" rel="noopener noreferrer">마이리얼트립</a>
                            </div>
                        </section>
                        <section>
                            <strong>어디로 갈까요?</strong>
                            <div className={styles.siteFooterDestinations}>
                                {['오사카', '도쿄', '후쿠오카', '다낭', '방콕', '세부', '괌', '타이베이'].map(city => (
                                    <button type="button" key={city} onClick={() => { setQuery(city); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{city}</button>
                                ))}
                            </div>
                        </section>
                    </div>
                    <p className={styles.siteFooterDisclaimer}>
                        티키티킷은 여행사별 특가 정보를 비교해 보여주는 서비스이며 통신판매의 당사자가 아닙니다.
                        가격·좌석·운항 일정은 예약 시점에 달라질 수 있고, 예약·결제·취소·환불은 각 여행사에서 진행됩니다.
                        일부 링크는 제휴 링크로, 예약이 완료되면 티키티킷이 수수료를 받을 수 있지만 이용자 가격은 달라지지 않습니다.
                    </p>
                    <div className={styles.siteFooterBottom}>
                        <span>© 2026 티키티킷</span>
                        <nav aria-label="서비스 안내">
                            <a href="/terms">이용약관</a>
                            <a href="/privacy">개인정보처리방침</a>
                            <button type="button" onClick={openContact}>문의하기</button>
                        </nav>
                    </div>
                    {previewMode && (
                        <div className={styles.previewModeNote}>
                            <span>새 디자인 미리보기</span>
                            <a href="/">현재 티키티킷으로 돌아가기</a>
                        </div>
                    )}
                </footer>
            </div>

            {showScrollTop && !filterOpen && !selectedFlight && (
                <div className={styles.floatingActions}>
                    <button
                        type="button"
                        className={styles.scrollTopButton}
                        aria-label="맨 위로 이동"
                        title="맨 위로"
                        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    >
                        <Icon name="up" />
                    </button>
                </div>
            )}

            {filterOpen && (
                <OverlayDialog
                    open={filterOpen}
                    active={activeOverlay === 'filter'}
                    dialogRef={filterDialogRef}
                    onClose={closeFilter}
                    overlayClassName={`${styles.sheetOverlay} ${styles.filterOverlay}`}
                    dialogClassName={styles.bottomSheet}
                    ariaLabel="항공권 필터"
                    ariaLabelledBy="flight-filter-title"
                    dialogStyle={filterPopoverPosition && !isMobile ? {
                            top: filterPopoverPosition.top,
                            left: filterPopoverPosition.left,
                            maxHeight: filterPopoverPosition.maxHeight,
                        } : undefined}
                >
                        <div className={styles.sheetHandle} aria-hidden="true" {...filterSwipe} />
                        <div className={styles.sheetHeader}>
                            <h2 id="flight-filter-title">표 골라보기</h2>
                            <button type="button" onClick={resetFilters}>초기화</button>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>출발지</h3>
                            <div className={styles.optionGrid}>
                                {DEPARTURE_OPTIONS.map(item => (
                                    <button type="button" key={item} className={departure === item ? styles.optionActive : ''} aria-pressed={departure === item} onClick={() => selectDepartureFilter(item)}>{item}</button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>도착 지역</h3>
                            <div className={styles.optionGrid}>
                                {REGION_OPTIONS.map(item => (
                                    <button type="button" key={item} className={region === item ? styles.optionActive : ''} aria-pressed={region === item} onClick={() => selectRegionFilter(item)}>{item}</button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>가격</h3>
                            <div className={styles.optionGrid}>
                                {PRICE_OPTIONS.map(item => (
                                    <button type="button" key={item.value} className={maxPrice === item.value ? styles.optionActive : ''} aria-pressed={maxPrice === item.value} onClick={() => selectPriceFilter(item.value)}>{item.label}</button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>출발 시기</h3>
                            <div className={styles.optionGrid}>
                                {DATE_PERIOD_OPTIONS.map(item => (
                                    <button
                                        type="button"
                                        key={item.value}
                                        className={datePeriod === item.value ? styles.optionActive : ''}
                                        aria-pressed={datePeriod === item.value}
                                        onClick={() => selectDatePeriod(item.value)}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                className={`${styles.dateDirectButton} ${datePeriod === 'custom' ? styles.dateDirectActive : ''}`}
                                aria-pressed={datePeriod === 'custom'}
                                onClick={() => setCalendarOpen(open => !open)}
                            >
                                <span>📅</span>
                                <strong>
                                    {customStartDate
                                        ? `${customStartDate.getMonth() + 1}.${customStartDate.getDate()}.${customEndDate ? ` ~ ${customEndDate.getMonth() + 1}.${customEndDate.getDate()}.` : ' 부터'}`
                                        : '날짜 직접 선택'}
                                </strong>
                            </button>
                            {calendarOpen && (
                                <div className={styles.dateCalendarWrap}>
                                    <DatePicker
                                        selectsRange
                                        startDate={customStartDate}
                                        endDate={customEndDate}
                                        onChange={(update: [Date | null, Date | null]) => {
                                            const [, end] = update;
                                            selectCustomDateRange(update);
                                            if (end) window.setTimeout(() => setCalendarOpen(false), 250);
                                        }}
                                        locale={ko}
                                        inline
                                        minDate={new Date()}
                                        calendarClassName={styles.dateCalendar}
                                    />
                                    <p>출발일 범위를 선택하세요.</p>
                                </div>
                            )}
                        </div>

                        <div className={`${styles.filterGroup} ${styles.advancedFilterGroup}`}>
                            <h3>여행사</h3>
                            <div className={styles.optionGrid}>
                                {SOURCE_OPTIONS.map(item => (
                                    <button
                                        type="button"
                                        key={item.value}
                                        className={sourceFilter === item.value ? styles.optionActive : ''}
                                        onClick={() => selectSourceFilter(item.value)}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                            <label className={`${styles.filterSelectRow} ${styles.mobileAirlineSelect}`}>
                                <span>항공사</span>
                                <select value={airlineFilter} onChange={event => selectAirlineFilter(event.target.value)}>
                                    <option value="all">전체 항공사</option>
                                    {uniqueAirlines.map(airline => <option value={airline} key={airline}>{airline}</option>)}
                                </select>
                            </label>
                            <h3 className={styles.desktopAirlineHeading}>항공사</h3>
                            <div className={styles.desktopAirlineSelect}>
                                <div className={`${styles.desktopAirlineSelectControl} ${airlineMenuOpen ? styles.desktopAirlineSelectControlOpen : ''}`}>
                                    <button
                                        type="button"
                                        aria-haspopup="listbox"
                                        aria-expanded={airlineMenuOpen}
                                        aria-label={`항공사 선택: ${airlineFilter === 'all' ? '전체 항공사' : airlineFilter}`}
                                        onClick={() => setAirlineMenuOpen(open => !open)}
                                    >
                                        <strong>{airlineFilter === 'all' ? '전체 항공사' : airlineFilter}</strong>
                                        <span className={`${styles.desktopAirlineChevron} ${airlineMenuOpen ? styles.desktopAirlineChevronOpen : ''}`}>
                                            <Icon name="chevron" />
                                        </span>
                                    </button>
                                </div>
                                {airlineMenuOpen && (
                                    <div className={styles.desktopAirlineMenu} role="listbox" aria-label="항공사 선택">
                                        {['all', ...uniqueAirlines].map(airline => {
                                            const label = airline === 'all' ? '전체 항공사' : airline;
                                            const active = airlineFilter === airline;
                                            return (
                                                <button
                                                    type="button"
                                                    role="option"
                                                    aria-selected={active}
                                                    className={active ? styles.desktopAirlineOptionActive : ''}
                                                    key={airline}
                                                    onClick={() => {
                                                        selectAirlineFilter(airline);
                                                        setAirlineMenuOpen(false);
                                                    }}
                                                >
                                                    <span>{label}</span>
                                                    {active && <span aria-hidden="true">✓</span>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <button type="button" className={`${styles.applyButton} ${(calendarOpen || airlineMenuOpen) ? styles.applyButtonCalendarOpen : ''}`} onClick={closeFilter}>
                            {filteredFlights.length.toLocaleString('ko-KR')}개 항공권 보기
                        </button>
                </OverlayDialog>
            )}

            {selectedFlight && (() => {
                const outbound = legDetails(selectedFlight, 'outbound');
                const inbound = legDetails(selectedFlight, 'return');
                const stay = tripLength(selectedFlight);
                const detailSeats = selectedFlight.availableSeats || Number.parseInt(selectedFlight.seats || '', 10) || 0;
                const reportPending = flightReport?.flightId === selectedFlight.id && flightReport.status === 'sending';
                const reportCompleted = Boolean(recentFlightReports[selectedFlight.id])
                    || (flightReport?.flightId === selectedFlight.id && flightReport.status === 'sent');
                return (
                <>
                <OverlayDialog
                    open={Boolean(selectedFlight)}
                    active={activeOverlay === 'flight'}
                    modal={!isDesktopViewport}
                    dialogRef={detailDialogRef}
                    onClose={closeSelectedFlight}
                    overlayClassName={`${styles.sheetOverlay} ${styles.detailOverlay}`}
                    dialogClassName={`${styles.bottomSheet} ${styles.detailSheet}`}
                    ariaLabel="항공권 상세"
                    ariaLabelledBy="flight-detail-title"
                >
                        <div className={`${styles.detailStickyHeader} ${detailHasScrolled ? styles.detailStickyHeaderScrolled : ''}`}>
                            <div className={styles.sheetHandle} aria-hidden="true" {...detailSwipe} />
                        <div className={styles.detailHeader}>
                            <div className={styles.detailAgencyLine}>
                                <span className={`${styles.sourceBadge} ${styles[selectedFlight.source]}`}>{SOURCE_NAMES[selectedFlight.source]}</span>
                                <span className={styles.detailAirline}>{selectedFlight.airline || '항공사 확인'}</span>
                                {detailSeats > 0 && <span className={styles.detailSeatCount}>{detailSeats}석 남음</span>}
                            </div>
                            <div className={styles.detailHeaderActions}>
                                <button
                                    className={styles.detailHeaderShareButton}
                                    type="button"
                                    onClick={() => shareFlight(selectedFlight)}
                                >
                                    <Icon name="share" />
                                    <span>공유</span>
                                </button>
                                <button className={styles.detailCloseButton} type="button" onClick={closeSelectedFlight} aria-label="닫기"><Icon name="close" /></button>
                            </div>
                            </div>
                        </div>

                        <div className={styles.detailTitle}>
                            <div>
                                <h2 id="flight-detail-title">{departureName(selectedFlight)} ↔ {stripAirport(selectedFlight.arrival.city)}</h2>
                            </div>
                            <div>
                                <strong>{priceText(selectedFlight.source === 'ttang' ? selectedFlight.price : effectivePrice(selectedFlight))}</strong>
                                <span>(유류/제세공과금 포함)</span>
                                {selectedFlight.minPax && selectedFlight.minPax > 1 && (
                                    <small className={styles.detailAvailabilityText}>{selectedFlight.minPax}인부터 예약</small>
                                )}
                            </div>
                        </div>

                        <div className={styles.detailSchedule}>
                            <section className={styles.detailFlightLeg}>
                                <header className={styles.detailLegHeader}>
                                    <div>
                                        <strong>가는 항공편</strong>
                                    </div>
                                    <small>{outbound.duration ? `비행시간 ${outbound.duration}` : '비행시간 확인 필요'}</small>
                                </header>
                                <div className={styles.detailVerticalRoute}>
                                    <div className={styles.detailRouteStop}>
                                        <span aria-hidden="true" />
                                        <div>
                                            <div className={`${styles.detailRouteTime} ${outbound.departureTime === '시간 확인' ? styles.detailRouteTimeUnknown : ''}`}>
                                                <em>{outbound.departureTime}</em>
                                                <span>{outbound.departureDate}</span>
                                            </div>
                                            <strong>{outbound.origin}</strong>
                                        </div>
                                    </div>
                                    <div className={styles.detailRouteStop}>
                                        <span aria-hidden="true" />
                                        <div>
                                            <div className={`${styles.detailRouteTime} ${outbound.arrivalTime === '시간 확인' ? styles.detailRouteTimeUnknown : ''}`}>
                                                <em>{outbound.arrivalTime}</em>
                                                <span>{outbound.arrivalDate}</span>
                                            </div>
                                            <strong>{outbound.destination}</strong>
                                        </div>
                                    </div>
                                </div>
                            </section>
                            {stay && <div className={styles.detailStayDivider}><span>{stay}</span></div>}
                            <section className={styles.detailFlightLeg}>
                                <header className={styles.detailLegHeader}>
                                    <div>
                                        <strong>오는 항공편</strong>
                                    </div>
                                    <small>{inbound.duration ? `비행시간 ${inbound.duration}` : '비행시간 확인 필요'}</small>
                                </header>
                                <div className={styles.detailVerticalRoute}>
                                    <div className={styles.detailRouteStop}>
                                        <span aria-hidden="true" />
                                        <div>
                                            <div className={`${styles.detailRouteTime} ${inbound.departureTime === '시간 확인' ? styles.detailRouteTimeUnknown : ''}`}>
                                                <em>{inbound.departureTime}</em>
                                                <span>{inbound.departureDate}</span>
                                            </div>
                                            <strong>{inbound.origin}</strong>
                                        </div>
                                    </div>
                                    <div className={styles.detailRouteStop}>
                                        <span aria-hidden="true" />
                                        <div>
                                            <div className={`${styles.detailRouteTime} ${inbound.arrivalTime === '시간 확인' ? styles.detailRouteTimeUnknown : ''}`}>
                                                <em>{inbound.arrivalTime}</em>
                                                <span>{inbound.arrivalDate}</span>
                                            </div>
                                            <strong>{inbound.destination}</strong>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>

                        {selectedFlight.source !== 'modetour'
                            && selectedFlight.source !== 'onlinetour'
                            && selectedFlight.source !== 'ttang' && (
                            <details className={styles.passengerPicker} open>
                                <summary>
                                    <span>탑승 인원</span>
                                    <strong>
                                        성인 {passengers.adult}명
                                        {passengers.child > 0 ? ` · 소아 ${passengers.child}명` : ''}
                                        {passengers.infant > 0 ? ` · 유아 ${passengers.infant}명` : ''}
                                    </strong>
                                    <Icon name="chevron" />
                                </summary>
                                <div className={styles.passengerRows}>
                                    {([
                                        { key: 'adult', label: '성인', age: '만 12세 이상', min: 1, max: 9 },
                                        { key: 'child', label: '소아', age: '만 2~11세', min: 0, max: 9 },
                                        { key: 'infant', label: '유아', age: '만 2세 미만', min: 0, max: Math.min(4, passengers.adult) },
                                    ] as const).map(item => {
                                        const seatPassengers = passengers.adult + passengers.child;
                                        const minimumPassengers = Math.max(1, selectedFlight.minPax || 1);
                                        const decrementDisabled = passengers[item.key] <= item.min
                                            || (item.key !== 'infant' && seatPassengers <= minimumPassengers);
                                        return (
                                        <div className={styles.passengerRow} key={item.key}>
                                            <span><strong>{item.label}</strong><small>{item.age}</small></span>
                                            <div>
                                                <button
                                                    type="button"
                                                    aria-label={`${item.label} 한 명 줄이기`}
                                                    disabled={decrementDisabled}
                                                    onClick={() => setPassengers(current => {
                                                        const nextValue = current[item.key] - 1;
                                                        return item.key === 'adult'
                                                            ? { ...current, adult: nextValue, infant: Math.min(current.infant, nextValue) }
                                                            : { ...current, [item.key]: nextValue };
                                                    })}
                                                >−</button>
                                                <strong>{passengers[item.key]}</strong>
                                                <button
                                                    type="button"
                                                    aria-label={`${item.label} 한 명 늘리기`}
                                                    disabled={passengers[item.key] >= item.max}
                                                    onClick={() => setPassengers(current => ({ ...current, [item.key]: current[item.key] + 1 }))}
                                                >+</button>
                                            </div>
                                        </div>
                                        );
                                    })}
                                    {passengers.child + passengers.infant > 0 && (
                                        <p>소아·유아 요금은 성인과 달라요. 정확한 금액은 예약 페이지에서 확인해주세요.</p>
                                    )}
                                </div>
                            </details>
                        )}
                        {(selectedFlight.source === 'modetour'
                            || selectedFlight.source === 'onlinetour'
                            || selectedFlight.source === 'ttang') && (
                            <div className={styles.passengerAgencyNotice}>
                                <span>탑승 인원</span>
                                <strong>여행사 예약 화면에서 선택해요</strong>
                            </div>
                        )}

                        <div className={styles.priceNotice}>
                            <span>
                                {selectedFlight.source === 'ttang' ? (
                                    <>
                                        땡처리닷컴에서는 예약·결제 단계에서 발권수수료
                                        <strong> {priceText(TTANG_TICKETING_FEE)}</strong>이 추가될 수 있어요.
                                    </>
                                ) : (
                                    <>가격과 좌석은 바뀔 수 있어요. 예약 전에 여행사에서 한 번 더 확인해주세요.</>
                                )}
                            </span>
                            <div className={styles.reportTools}>
                                {reportCompleted ? (
                                    <span className={styles.reportReceived}>신고 접수됨</span>
                                ) : reportPending ? (
                                    <span className={styles.reportReceived}>접수 중…</span>
                                ) : (
                                    <>
                                        <button type="button" onClick={() => void submitFlightReport(selectedFlight, 'price_changed')}>가격이 달라요</button>
                                        <span aria-hidden="true">·</span>
                                        <button type="button" onClick={() => void submitFlightReport(selectedFlight, 'unavailable')}>예약이 안 돼요</button>
                                    </>
                                )}
                            </div>
                        </div>

                        {(PUBLIC_DEAL_ALERTS_ENABLED || selectedNaverUrl) && (
                            <div className={styles.detailUtilityRow}>
                                {PUBLIC_DEAL_ALERTS_ENABLED && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            openDealAlert({
                                                flightId: selectedFlight.id,
                                                departureCity: departureName(selectedFlight),
                                                arrivalCity: stripAirport(selectedFlight.arrival.city),
                                                currentPrice: selectedFlight.source === 'ttang'
                                                    ? selectedFlight.price
                                                    : effectivePrice(selectedFlight),
                                            });
                                        }}
                                    >
                                        이 노선 가격 알림
                                    </button>
                                )}
                                {selectedNaverUrl && (
                                    <a
                                        href={selectedNaverUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={() => {
                                            const route = normalizedRoute(selectedFlight);
                                            const price = effectivePrice(selectedFlight);
                                            gtag.trackCompareClick('naver', route, price);
                                            gtag.trackCompareOutboundClick('naver', route, price);
                                        }}
                                    >
                                        네이버에서 같은 일정 비교
                                    </a>
                                )}
                            </div>
                        )}

                        <div className={styles.detailPrimaryActions}>
                            <button
                                className={styles.detailMobileShareButton}
                                type="button"
                                onClick={() => shareFlight(selectedFlight)}
                            >
                                <Icon name="share" />
                                <span>공유</span>
                            </button>
                            <a
                                className={styles.bookingButton}
                                href={selectedBookingUrl}
                                target="_blank"
                                rel={selectedFlight.source === 'myrealtrip' ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}
                                onClick={() => gtag.trackBookingClick(
                                    selectedFlight.source,
                                    normalizedRoute(selectedFlight),
                                    effectivePrice(selectedFlight),
                                    {
                                        flightId: selectedFlight.id,
                                        departureDate: selectedFlight.departure.date,
                                        returnDate: selectedFlight.arrival.date,
                                        departureAirport: selectedFlight.routeAirports?.outboundDeparture || selectedFlight.departure.airport,
                                        arrivalAirport: selectedFlight.routeAirports?.outboundArrival || selectedFlight.arrival.airport,
                                        airline: selectedFlight.airline,
                                        destination: stripAirport(selectedFlight.arrival.city),
                                    },
                                )}
                            >
                                {SOURCE_NAMES[selectedFlight.source]}에서 확인하기 <Icon name="arrow" />
                            </a>
                        </div>
                        {selectedFlight.source === 'myrealtrip' && (
                            <p className={styles.affiliateDisclosure}>제휴 링크를 통해 예약되면 티키티킷이 수수료를 받을 수 있어요.</p>
                        )}
                        <div className={styles.detailSecondaryActions}>
                            {selectedHotelUrl && (
                                <a
                                    className={styles.hotelCompareButton}
                                    href={selectedHotelUrl}
                                    target="_blank"
                                    rel="sponsored noopener noreferrer"
                                    title="트립닷컴에서 호텔 검색"
                                    onClick={() => gtag.trackHotelAffiliateClick(
                                        `${departureName(selectedFlight)}-${stripAirport(selectedFlight.arrival.city)}`,
                                        selectedFlight.price,
                                        {
                                            departureDate: selectedFlight.departure.date,
                                            returnDate: selectedFlight.arrival.date,
                                            departureAirport: selectedFlight.departure.airport,
                                            arrivalAirport: selectedFlight.arrival.airport,
                                            airline: selectedFlight.airline,
                                            destination: stripAirport(selectedFlight.arrival.city),
                                            trackingId: selectedHotelTrackingId,
                                        },
                                    )}
                                >
                                    <span className={styles.hotelIcon}>🏨</span>
                                    <span className={styles.hotelButtonText}>
                                        <strong>{stripAirport(selectedFlight.arrival.city)} 호텔도 비교</strong>
                                        <small>트립닷컴 · 제휴</small>
                                    </span>
                                    <Icon name="arrow" />
                                </a>
                            )}
                        </div>
                </OverlayDialog>
                <div
                    className={detailHasMoreBelow
                        ? styles.detailScrollFade
                        : `${styles.detailScrollFade} ${styles.detailScrollFadeHidden}`}
                    data-detail-scroll-hint
                    aria-hidden="true"
                />
                </>
                );
            })()}

            {showServiceUpdate && (
                <OverlayDialog
                    open={showServiceUpdate}
                    active={activeOverlay === 'service-update'}
                    dialogRef={serviceUpdateDialogRef}
                    onClose={closeServiceUpdate}
                    overlayClassName={`${styles.sheetOverlay} ${styles.serviceUpdateOverlay}`}
                    dialogClassName={`${styles.bottomSheet} ${styles.serviceUpdateSheet}`}
                    ariaLabelledBy="service-update-title"
                >
                        <div className={styles.sheetHandle} aria-hidden="true" {...serviceUpdateSwipe} />
                        <p className={styles.serviceUpdateEyebrow}>9월 발권 안내</p>
                        <div className={styles.serviceUpdateNotice}>
                            <h2 id="service-update-title">⛽ 9월 유류할증료가 올랐어요</h2>
                            <p>항공유 가격 상승으로 국내선·국제선 모두 4개월 만에 인상됐어요. 9월 1일 이후 발권분에 적용되며, 항공사·노선별 금액은 예약 단계에서 확인해 주세요.</p>
                        </div>
                        <div className={styles.serviceUpdateActions}>
                            <button type="button" className={styles.serviceUpdateClose} onClick={closeServiceUpdate}>닫기</button>
                            <button type="button" className={styles.serviceUpdateConfirm} onClick={dismissServiceUpdate}>다시 보지 않기</button>
                        </div>
                </OverlayDialog>
            )}

            {showContact && (
                <OverlayDialog
                    open={showContact}
                    active={activeOverlay === 'contact'}
                    dialogRef={contactDialogRef}
                    onClose={closeContact}
                    overlayClassName={`${styles.sheetOverlay} ${styles.contactOverlay}`}
                    dialogClassName={`${styles.bottomSheet} ${styles.contactSheet}`}
                    ariaLabelledBy="contact-title"
                >
                        <div className={styles.sheetHandle} aria-hidden="true" {...contactSwipe} />
                        <div className={styles.contactHeader}>
                            <div>
                                <span>티키티킷에 말해주세요</span>
                                <h2 id="contact-title">문의하기</h2>
                            </div>
                            <button type="button" onClick={closeContact} aria-label="닫기"><Icon name="close" /></button>
                        </div>
                        {contactStatus === 'sent' ? (
                            <div className={styles.contactSuccess}>
                                <strong>잘 받았습니다.</strong>
                                <span>{contactMessage}</span>
                                <button type="button" onClick={closeContact}>확인</button>
                            </div>
                        ) : (
                            <form className={styles.contactForm} onSubmit={submitContact}>
                                <label>
                                    <span>이름 <small>선택</small></span>
                                    <input value={contactForm.name} onChange={event => setContactForm(current => ({ ...current, name: event.target.value }))} autoComplete="name" />
                                </label>
                                <label>
                                    <span>답변받을 이메일 <small>선택</small></span>
                                    <input type="email" value={contactForm.email} onChange={event => setContactForm(current => ({ ...current, email: event.target.value }))} autoComplete="email" />
                                </label>
                                <label>
                                    <span>문의 내용</span>
                                    <textarea required rows={5} value={contactForm.message} onChange={event => setContactForm(current => ({ ...current, message: event.target.value }))} />
                                </label>
                                {contactMessage && <p className={styles.contactError} role="alert">{contactMessage}</p>}
                                <button type="submit" className={styles.contactSubmit} disabled={!contactForm.message.trim() || contactStatus === 'sending'}>
                                    {contactStatus === 'sending' ? '보내는 중…' : '문의 보내기'}
                                </button>
                            </form>
                        )}
                </OverlayDialog>
            )}

            <AccountSheet
                open={showAccount}
                active={activeOverlay === 'account'}
                onClose={closeAccount}
                account={account}
                onApplySearch={applyAccountSearch}
                onOpenFlight={openAccountFlight}
                onOpenAlert={() => {
                    setShowAccount(false);
                    openDealAlert(null);
                }}
                dealAlertsEnabled={PUBLIC_DEAL_ALERTS_ENABLED}
                guestFavorites={guestFavoriteSnapshots}
                onFavoriteRemoved={flightId => {
                    if (!favorites.has(flightId)) return;
                    const mutationVersion = (favoriteMutationVersionRef.current.get(flightId) || 0) + 1;
                    favoriteMutationVersionRef.current.set(flightId, mutationVersion);
                    favoriteIntentRef.current.set(flightId, false);
                    setFavorites(current => {
                        const next = new Set(current);
                        next.delete(flightId);
                        return next;
                    });
                    if (account.status !== 'authenticated') {
                        favoriteIntentRef.current.delete(flightId);
                        setGuestFavorites(current => {
                            const next = new Set(current);
                            next.delete(flightId);
                            try { localStorage.setItem('favoriteFlights', JSON.stringify(Array.from(next))); } catch { }
                            return next;
                        });
                    } else {
                        void account.setFavorite(flightId, false).then(() => {
                            if (favoriteMutationVersionRef.current.get(flightId) !== mutationVersion) return;
                            favoriteIntentRef.current.delete(flightId);
                        }).catch(() => {
                            if (favoriteMutationVersionRef.current.get(flightId) !== mutationVersion) return;
                            favoriteIntentRef.current.delete(flightId);
                            setFavorites(current => {
                                const restored = new Set(current);
                                if (confirmedAccountFavoritesRef.current.has(flightId)) restored.add(flightId);
                                else restored.delete(flightId);
                                return restored;
                            });
                            setToast('계정에서 찜을 해제하지 못했어요. 이전 상태로 되돌렸어요.');
                        });
                    }
                    setToast('찜에서 뺐어요.');
                }}
            />

            {PUBLIC_DEAL_ALERTS_ENABLED && (
                <MobileDealAlertSheet
                    open={showDealAlert}
                    active={activeOverlay === 'deal-alert'}
                    initialDeparture={departure}
                    initialRegion={region}
                    initialMaxPrice={maxPrice || 200_000}
                    initialRoute={alertRouteTarget}
                    onSaveSearchCondition={account.status === 'authenticated' ? saveAlertSearchCondition : undefined}
                    onClose={closeDealAlert}
                />
            )}

            {toast && <div className={styles.toast} role="status">{toast}</div>}
        </Root>
    );
}
