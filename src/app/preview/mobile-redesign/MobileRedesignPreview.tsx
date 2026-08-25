'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ko } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import Logo from '@/components/Logo';
import * as gtag from '@/lib/analytics';
import { getDestinationContext } from '@/lib/destination-contexts';
import { calcFlightTiming, normalizeCity } from '@/lib/utils/flight-helpers';
import { getTripcomHotelUrl, getTripcomTrackingId } from '@/lib/utils/tripcom-helpers';
import type { Flight } from '@/types/flight';
import AccountSheet from '@/components/account/AccountSheet';
import { useAccount, type AccountFlightSnapshot, type AccountSearchFilters } from '@/components/account/useAccount';
import MobileDealAlertSheet from './MobileDealAlertSheet';
import styles from './page.module.css';

type SortMode = 'recommended' | 'price' | 'date';
type DatePeriod = 'all' | 'this-week' | 'next-week' | 'this-month' | 'next-month' | 'custom';
type DesktopFilterKey = 'departure' | 'region' | 'date' | 'price';
type FlightReportStatus = 'sending' | 'sent' | 'error';

const RECENT_FLIGHT_REPORTS_KEY = 'tikitikit_recent_flight_reports';
const FLIGHT_REPORT_TTL_MS = 24 * 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DatePicker: any = dynamic(() => import('react-datepicker').then((mod: any) => mod.default), { ssr: false });

interface FlightsResponse {
    success: boolean;
    count: number;
    flights: Flight[];
    lastUpdated?: string | null;
    todayPickId?: string | null;
    priceHistory?: PriceHistory;
}

interface PriceHistoryEntry {
    date: string;
    minPrice: number;
    avgPrice?: number;
    count?: number;
}

type PriceHistory = Record<string, PriceHistoryEntry[]>;

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

const TTANG_TICKETING_FEE = 20_000;

const REGION_OPTIONS = ['전체', '일본', '동남아', '중화권', '남태평양', '유럽', '미주', '기타'];
const QUICK_REGION_OPTIONS = REGION_OPTIONS.slice(0, 4);
const MORE_REGION_OPTIONS = REGION_OPTIONS.slice(4);
const DEPARTURE_OPTIONS = ['전체', '인천/김포', '부산/김해', '대구', '청주', '제주'];
const DATE_PERIOD_OPTIONS: Array<{ label: string; value: DatePeriod }> = [
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

const diversifyFlights = (items: Flight[], topWindow = 24, maxPerDestination = 2, maxConsecutive = 2) => {
    if (items.length <= maxConsecutive) return items;
    const remaining = [...items];
    const result: Flight[] = [];
    const topCounts = new Map<string, number>();

    const breaksConsecutiveRun = (flight: Flight) => {
        if (result.length < maxConsecutive) return true;
        const destination = normalizeCity(flight.arrival.city);
        return result.slice(-maxConsecutive).some(item => normalizeCity(item.arrival.city) !== destination);
    };

    while (remaining.length > 0) {
        const protectTopMix = result.length < topWindow;
        let candidateIndex = remaining.findIndex(flight => {
            const destination = normalizeCity(flight.arrival.city);
            return breaksConsecutiveRun(flight)
                && (!protectTopMix || (topCounts.get(destination) || 0) < maxPerDestination);
        });
        if (candidateIndex < 0) candidateIndex = remaining.findIndex(breaksConsecutiveRun);
        if (candidateIndex < 0) candidateIndex = 0;

        const [next] = remaining.splice(candidateIndex, 1);
        result.push(next);
        if (result.length <= topWindow) {
            const destination = normalizeCity(next.arrival.city);
            topCounts.set(destination, (topCounts.get(destination) || 0) + 1);
        }
    }
    return result;
};

const airportLabel = (city: string, airport?: string) => (
    airport ? `${city}(${airport})` : city
);

const agencyFlightDuration = (value?: string) => {
    const parsed = value?.match(/^(\d{1,2}):(\d{2})/);
    if (!parsed) return null;
    const hours = Number(parsed[1]);
    const minutes = Number(parsed[2]);
    return `${hours}시간${minutes > 0 ? ` ${minutes}분` : ''}`;
};

const legDetails = (flight: Flight, leg: 'outbound' | 'return') => {
    const detail = flight.modetourDetail;
    const departureCity = departureName(flight);
    const arrivalCity = stripAirport(flight.arrival.city);

    if (leg === 'outbound') {
        const arrivalTime = detail?.departureArrivalTime || flight.departure.arrivalTime || '';
        const timing = calcFlightTiming(departureCity, flight.departure.time, flight.departure.date, arrivalCity, arrivalTime);
        const fallbackDayOffset = fallbackArrivalDayOffset(flight.departure.time, arrivalTime);
        return {
            origin: airportLabel(departureCity, flight.departure.airport),
            destination: airportLabel(arrivalCity, flight.arrival.airport),
            departureTime: flight.departure.time || '시간 확인',
            arrivalTime: arrivalTime || '시간 확인',
            departureDate: shortDate(flight.departure.date),
            arrivalDate: shortDateWithOffset(flight.departure.date, timing?.arrivalDayOffset ?? fallbackDayOffset),
            duration: timing?.duration || agencyFlightDuration(detail?.flyingTime),
        };
    }

    const departureTime = detail?.returnDepartureTime || flight.arrival.time || '';
    const arrivalTime = detail?.returnArrivalTime || flight.arrival.arrivalTime || '';
    const timing = calcFlightTiming(arrivalCity, departureTime, flight.arrival.date, departureCity, arrivalTime);
    const fallbackDayOffset = fallbackArrivalDayOffset(departureTime, arrivalTime);
    return {
        origin: airportLabel(arrivalCity, detail?.returnDepartureAirport || flight.arrival.airport),
        destination: airportLabel(departureCity, detail?.returnArrivalAirport || flight.departure.airport),
        departureTime: departureTime || '시간 확인',
        arrivalTime: arrivalTime || '시간 확인',
        departureDate: shortDate(flight.arrival.date),
        arrivalDate: shortDateWithOffset(flight.arrival.date, timing?.arrivalDayOffset ?? fallbackDayOffset),
        duration: timing?.duration || agencyFlightDuration(detail?.returnFlyingTime),
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

    const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    const mondayOffset = (today.getDay() + 6) % 7;
    const thisMonday = addDays(today, -mondayOffset);
    let start: Date;
    let end: Date;

    if (period === 'this-week') {
        start = thisMonday;
        end = addDays(thisMonday, 7);
    } else if (period === 'next-week') {
        start = addDays(thisMonday, 7);
        end = addDays(thisMonday, 14);
    } else if (period === 'this-month') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    } else {
        start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        end = new Date(today.getFullYear(), today.getMonth() + 2, 1);
    }

    return departureDate >= start && departureDate < end;
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
        && departureMinutes >= 18 * 60
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

// 상단 경보는 평범한 오늘의 표가 아니라, 가격과 할인폭이 함께 드문 경우에만 켠다.
const isTickerWorthyDrop = (flight: Flight) => {
    const price = effectivePrice(flight);
    const discount = Math.max(0, flight.discountRate || 0);
    return price <= 140_000 || (price <= 180_000 && discount >= 25);
};

const describeDropCard = (flight: Flight) => {
    const seats = flight.availableSeats || Number.parseInt(flight.seats || '', 10) || 0;
    const departureDate = parseDate(flight.departure.date);
    const today = parseDate(seoulDateKey());
    const destination = stripAirport(flight.arrival.city);
    const displayedPrice = flight.source === 'ttang' ? flight.price : effectivePrice(flight);
    const discountRate = Math.round(Math.max(0, flight.discountRate || 0));
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
            '🪑 고민보다 좌석이 적음',
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

function Icon({ name }: { name: 'sliders' | 'search' | 'star' | 'share' | 'close' | 'arrow' | 'plane' | 'up' | 'chevron' }) {
    const paths = {
        sliders: <><line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="15" cy="17" r="2" /></>,
        search: <><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></>,
        star: <polygon points="12 2.8 14.8 8.5 21.1 9.4 16.5 13.9 17.6 20.2 12 17.2 6.4 20.2 7.5 13.9 2.9 9.4 9.2 8.5 12 2.8" />,
        share: <><path d="M4 12v8h16v-8" /><polyline points="8 7 12 3 16 7" /><line x1="12" y1="3" x2="12" y2="15" /></>,
        close: <><line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" /></>,
        arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="14 7 19 12 14 17" /></>,
        plane: <path d="M22 12c0-.6-.5-1.1-1.1-1.2l-6.4-.9-3.8-6.2C10.4 3.3 10 3 9.4 3H8.1l2.2 7.3-4.8.7-1.8-2H2.2l1 3-1 3h1.5l1.8-2 4.8.7L8.1 21h1.3c.6 0 1-.3 1.3-.7l3.8-6.2 6.4-.9c.6-.1 1.1-.6 1.1-1.2Z" />,
        up: <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="6.5 10.5 12 5 17.5 10.5" /></>,
        chevron: <polyline points="7 9 12 14 17 9" />,
    };
    return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function MobileRedesignPreview() {
    const account = useAccount();
    const [flights, setFlights] = useState<Flight[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [todayPickId, setTodayPickId] = useState<string | null>(null);
    const [priceHistory, setPriceHistory] = useState<PriceHistory>({});
    const [region, setRegion] = useState('전체');
    const [departure, setDeparture] = useState('전체');
    const [datePeriod, setDatePeriod] = useState<DatePeriod>('all');
    const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
    const [customEndDate, setCustomEndDate] = useState<Date | null>(null);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [maxPrice, setMaxPrice] = useState(0);
    const [sort, setSort] = useState<SortMode>('recommended');
    const [sortOpen, setSortOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    const [desktopFilterOpen, setDesktopFilterOpen] = useState<DesktopFilterKey | null>(null);
    const [regionMoreOpen, setRegionMoreOpen] = useState(false);
    const [showDealAlert, setShowDealAlert] = useState(false);
    const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [flightReport, setFlightReport] = useState<{ flightId: string; status: FlightReportStatus } | null>(null);
    const [recentFlightReports, setRecentFlightReports] = useState<Record<string, number>>({});
    const [visibleCount, setVisibleCount] = useState(18);
    const [toast, setToast] = useState('');
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [filterBarPinned, setFilterBarPinned] = useState(false);
    const [showAccount, setShowAccount] = useState(false);
    const [insightDateKey, setInsightDateKey] = useState(() => seoulDateKey());
    const filterBarSlotRef = useRef<HTMLDivElement | null>(null);
    const desktopFilterRef = useRef<HTMLDivElement | null>(null);
    const sortMenuRef = useRef<HTMLDivElement | null>(null);
    const lastScrollYRef = useRef(0);
    const scrollDirectionRef = useRef<'up' | 'down' | null>(null);
    const scrollDirectionAnchorRef = useRef(0);
    const mergedAccountRef = useRef<string | null>(null);

    useEffect(() => {
        let active = true;
        fetch('/api/flights?sortBy=price&sortOrder=asc')
            .then(response => {
                if (!response.ok) throw new Error('항공권을 불러오지 못했습니다.');
                return response.json() as Promise<FlightsResponse>;
            })
            .then(data => {
                if (!active) return;
                if (!data.success) throw new Error('항공권을 불러오지 못했습니다.');
                setFlights(data.flights || []);
                setLastUpdated(data.lastUpdated || null);
                setInsightDateKey(data.lastUpdated ? seoulDateKey(new Date(data.lastUpdated)) : seoulDateKey());
                setTodayPickId(typeof data.todayPickId === 'string' ? data.todayPickId : null);
                setPriceHistory(data.priceHistory || {});
            })
            .catch(cause => {
                if (active) setError(cause instanceof Error ? cause.message : '항공권을 불러오지 못했습니다.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        document.body.style.overflow = selectedFlight || filterOpen || showAccount || showDealAlert ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [selectedFlight, filterOpen, showAccount, showDealAlert]);

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
            if (event.key === 'Escape') setSortOpen(false);
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
            if (Array.isArray(saved)) setFavorites(new Set(saved.filter(id => typeof id === 'string')));
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

    useEffect(() => {
        if (account.status !== 'authenticated') {
            if (account.status === 'anonymous') mergedAccountRef.current = null;
            return;
        }
        if (!account.email || mergedAccountRef.current === account.email) return;
        mergedAccountRef.current = account.email;
        let localIds: string[] = [];
        try {
            const saved = JSON.parse(localStorage.getItem('favoriteFlights') || '[]');
            if (Array.isArray(saved)) localIds = saved.filter(id => typeof id === 'string');
        } catch { }
        const combined = Array.from(new Set([...localIds, ...account.favoriteIds]));
        setFavorites(new Set(combined));
        try { localStorage.setItem('favoriteFlights', JSON.stringify(combined)); } catch { }
        if (localIds.length) void account.mergeLocalFavorites(localIds).catch(() => undefined);
    }, [account, account.email, account.status]);

    useEffect(() => {
        setVisibleCount(window.matchMedia('(min-width: 960px)').matches ? 36 : 18);
    }, [region, departure, datePeriod, customStartDate, customEndDate, maxPrice, sort, query]);

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
            const isDesktop = window.matchMedia('(min-width: 960px)').matches;
            const lastScrollY = lastScrollYRef.current;
            const nextDirection = scrollY > lastScrollY ? 'down' : scrollY < lastScrollY ? 'up' : null;

            if (!isPastFilters) {
                setFilterBarPinned(false);
                scrollDirectionRef.current = nextDirection;
                scrollDirectionAnchorRef.current = scrollY;
            } else if (isDesktop) {
                setFilterBarPinned(true);
            } else if (nextDirection) {
                if (scrollDirectionRef.current !== nextDirection) {
                    scrollDirectionRef.current = nextDirection;
                    scrollDirectionAnchorRef.current = lastScrollY;
                }
                const directionDistance = Math.abs(scrollY - scrollDirectionAnchorRef.current);
                if (nextDirection === 'up' && directionDistance >= 18) setFilterBarPinned(true);
                if (nextDirection === 'down' && directionDistance >= 12) setFilterBarPinned(false);
            }

            lastScrollYRef.current = scrollY;
        };
        lastScrollYRef.current = Math.max(0, window.scrollY);
        scrollDirectionAnchorRef.current = lastScrollYRef.current;
        updateScrollState();
        window.addEventListener('scroll', updateScrollState, { passive: true });
        window.addEventListener('resize', updateScrollState);
        return () => {
            window.removeEventListener('scroll', updateScrollState);
            window.removeEventListener('resize', updateScrollState);
        };
    }, []);

    const filteredFlights = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        const referenceDate = new Date();
        const result = flights.filter(flight => {
            const matchesQuery = !normalizedQuery || [
                flight.departure.city,
                flight.arrival.city,
                flight.airline,
                SOURCE_NAMES[flight.source],
            ].some(value => value.toLowerCase().includes(normalizedQuery));
            return matchesQuery
                && regionMatches(flight, region)
                && departureMatches(flight, departure)
                && datePeriodMatches(flight, datePeriod, referenceDate, customStartDate, customEndDate)
                && (!maxPrice || effectivePrice(flight) <= maxPrice);
        });

        return result.sort((a, b) => {
            if (sort === 'price') return effectivePrice(a) - effectivePrice(b);
            if (sort === 'date') return (parseDate(a.departure.date)?.getTime() || 0) - (parseDate(b.departure.date)?.getTime() || 0);
            return recommendedScore(a) - recommendedScore(b);
        });
    }, [customEndDate, customStartDate, datePeriod, departure, flights, maxPrice, query, region, sort]);

    const isDefaultView = region === '전체'
        && departure === '전체'
        && datePeriod === 'all'
        && !maxPrice
        && !query.trim()
        && sort === 'recommended';
    const todayPick = useMemo(() => {
        const flight = flights.find(item => item.id === todayPickId)
            || flights.slice().sort((a, b) => recommendedScore(a) - recommendedScore(b))[0];
        return flight ? { flight, reason: describeDropCard(flight) } : null;
    }, [flights, todayPickId]);
    const dropAlertFlight = useMemo(() => (
        flights
            .filter(isTickerWorthyDrop)
            .sort((a, b) => recommendedScore(a) - recommendedScore(b))[0] || null
    ), [flights]);
    const featuredPick = useMemo(() => (
        dropAlertFlight
            ? { flight: dropAlertFlight, reason: describeDropCard(dropAlertFlight) }
            : todayPick
    ), [dropAlertFlight, todayPick]);
    const displayedFlights = useMemo(() => {
        const base = isDefaultView && featuredPick
            ? [featuredPick.flight, ...filteredFlights.filter(flight => flight.id !== featuredPick.flight.id)]
            : filteredFlights;
        return sort === 'recommended' && !query.trim() ? diversifyFlights(base) : base;
    }, [featuredPick, filteredFlights, isDefaultView, query, sort]);
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
    const insightInterval = 18;
    const hasAdvancedFilter = departure !== '전체' || datePeriod !== 'all' || maxPrice > 0;
    const updatedLabel = lastUpdated
        ? `${new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(new Date(lastUpdated)).replace(/\.\s*$/, '')} 기준`
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
    const guestFavoriteSnapshots = useMemo(
        () => flights.filter(flight => favorites.has(flight.id)).map(toAccountSnapshot),
        [favorites, flights],
    );

    const toggleFavorite = (flight: Flight) => {
        const willFavorite = !favorites.has(flight.id);
        const next = new Set(favorites);
        if (willFavorite) next.add(flight.id);
        else next.delete(flight.id);
        setFavorites(next);
        try { localStorage.setItem('favoriteFlights', JSON.stringify(Array.from(next))); } catch { }
        setToast(willFavorite
            ? account.status === 'authenticated'
                ? `${stripAirport(flight.arrival.city)} 표를 내 여행에 저장했어요.`
                : `${stripAirport(flight.arrival.city)} 표를 찜했어요. 로그인하면 다른 기기에서도 볼 수 있어요.`
            : '찜에서 뺐어요.');
        void account.setFavorite(flight.id, willFavorite).catch(() => {
            const restored = new Set(next);
            if (willFavorite) restored.delete(flight.id);
            else restored.add(flight.id);
            setFavorites(restored);
            try { localStorage.setItem('favoriteFlights', JSON.stringify(Array.from(restored))); } catch { }
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
                setSelectedFlight(null);
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
        gtag.trackDetailOpen(
            `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`,
            effectivePrice(flight),
            flight.source,
            entry,
        );
        account.recordRecent(flight.id);
        setSelectedFlight(flight);
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

    const currentAccountSearch: AccountSearchFilters = {
        searchTerm: query,
        sortBy: sort === 'price' ? 'price' : sort === 'date' ? 'date' : 'discount',
        sortOrder: 'asc',
        sourceFilter: 'all',
        regionFilter: region === '전체' ? 'all' : region,
        startDate: datePeriod === 'custom' && customStartDate ? dateKey(customStartDate) : '',
        endDate: datePeriod === 'custom' && customEndDate ? dateKey(customEndDate) : '',
        departureFilter: departure === '전체' ? 'all' : departure.replace('/김포', '').replace('/김해', ''),
        airlineFilter: 'all',
        ...(maxPrice ? { maxPrice } : {}),
        datePeriod,
    };

    const applyAccountSearch = (filters: AccountSearchFilters) => {
        setQuery(filters.searchTerm);
        setSort(filters.sortBy === 'price' ? 'price' : filters.sortBy === 'date' ? 'date' : 'recommended');
        setRegion(filters.regionFilter === 'all' ? '전체' : filters.regionFilter);
        setDeparture(filters.departureFilter === 'all' ? '전체'
            : filters.departureFilter === '인천' ? '인천/김포'
                : filters.departureFilter === '부산' ? '부산/김해'
                    : filters.departureFilter);
        setMaxPrice(filters.maxPrice || 0);
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
        const flight = flights.find(item => item.id === flightId);
        if (!flight) {
            setToast('이 표는 현재 목록에서 내려갔어요.');
            return;
        }
        setShowAccount(false);
        openFlight(flight);
    };

    const shareFlight = async (flight: Flight) => {
        const url = `${window.location.origin}/share/${encodeURIComponent(flight.id)}`;
        const text = `${departureName(flight)}에서 ${stripAirport(flight.arrival.city)}, 왕복 ${priceText(effectivePrice(flight))}`;
        try {
            if (navigator.share) await navigator.share({ title: '티키티킷 항공권', text, url });
            else {
                await navigator.clipboard.writeText(`${text}\n${url}`);
                setToast('항공권 주소를 복사했어요.');
            }
        } catch {
            // 사용자가 공유 창을 닫은 경우에는 아무 안내도 띄우지 않는다.
        }
    };

    const resetFilters = () => {
        setDeparture('전체');
        setRegion('전체');
        setDatePeriod('all');
        setCustomStartDate(null);
        setCustomEndDate(null);
        setCalendarOpen(false);
        setMaxPrice(0);
        setDesktopFilterOpen(null);
    };

    return (
        <main className={styles.previewPage}>
            {isDefaultView && dropAlertFlight && (
                <div
                    className={`${styles.dropTicker} ${styles.desktopDropTicker}`}
                    role="status"
                    aria-label={`특가 경보. ${stripAirport(dropAlertFlight.arrival.city)} 왕복 ${priceText(dropAlertFlight.price)}`}
                >
                    <div className={styles.dropTickerTrack}>
                        {[0, 1, 2, 3].map(copyIndex => (
                            <div className={styles.dropTickerContent} aria-hidden={copyIndex > 0 || undefined} key={copyIndex}>
                                <span className={styles.tickerEmergency}><i aria-hidden="true">🚨</i><b>비상!! 비상!!</b></span>
                                <span>{stripAirport(dropAlertFlight.arrival.city)} 왕복 {priceText(dropAlertFlight.price)}</span>
                                <span>🤯 담당자가 미쳤어요</span>
                                <span>{stripAirport(dropAlertFlight.arrival.city)} 왕복 {priceText(dropAlertFlight.price)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className={styles.phoneCanvas}>
                <header className={`${styles.header} ${isDefaultView && dropAlertFlight ? styles.headerWithMobileTicker : ''}`}>
                    <a href="/preview/mobile-redesign" className={styles.logoLink} aria-label="티키티킷 모바일 디자인 미리보기 홈">
                        <Logo size={0.84} />
                    </a>
                    <div className={styles.headerActions}>
                        <button type="button" className={styles.iconButton} onClick={() => setSearchOpen(value => !value)} aria-label="검색">
                            <Icon name="search" />
                        </button>
                        <button type="button" className={styles.alertButton} onClick={() => setShowDealAlert(true)}>특가 알림</button>
                        <button type="button" className={styles.accountIconButton} onClick={() => { gtag.trackAccountAction('open', 'preview'); setShowAccount(true); }} aria-label={account.status === 'authenticated' ? '내 여행 열기' : '로그인'}>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 19c.6-3.5 3-5.4 6.5-5.4s5.9 1.9 6.5 5.4" /></svg>
                            <span className={styles.accountLabel}>{account.status === 'authenticated' ? '내 여행' : '로그인'}</span>
                            {account.status === 'authenticated' && <i className={styles.accountStatusDot} aria-hidden="true" />}
                        </button>
                    </div>
                </header>

                {isDefaultView && dropAlertFlight && (
                    <div
                        className={`${styles.dropTicker} ${styles.mobileDropTicker}`}
                        role="status"
                        aria-label={`특가 경보. ${stripAirport(dropAlertFlight.arrival.city)} 왕복 ${priceText(dropAlertFlight.price)}`}
                    >
                        <div className={styles.dropTickerTrack}>
                            {[0, 1, 2, 3].map(copyIndex => (
                                <div className={styles.dropTickerContent} aria-hidden={copyIndex > 0 || undefined} key={copyIndex}>
                                    <span className={styles.tickerEmergency}><i aria-hidden="true">🚨</i><b>비상!! 비상!!</b></span>
                                    <span>{stripAirport(dropAlertFlight.arrival.city)} 왕복 {priceText(dropAlertFlight.price)}</span>
                                    <span>🤯 담당자가 미쳤어요</span>
                                    <span>{stripAirport(dropAlertFlight.arrival.city)} 왕복 {priceText(dropAlertFlight.price)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {searchOpen && (
                    <div className={styles.searchRow}>
                        <Icon name="search" />
                        <input
                            autoFocus
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder="도시나 항공사 검색"
                            aria-label="도시나 항공사 검색"
                        />
                        {query && <button type="button" onClick={() => setQuery('')}>지우기</button>}
                    </div>
                )}

                <section className={styles.feedIntro}>
                    <div>
                        <p>좋은 표 하나가, 주말을 여행으로.</p>
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
                                    onClick={() => setDesktopFilterOpen(open => open === 'departure' ? null : 'departure')}
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
                                                onClick={() => {
                                                    setDeparture(item);
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
                                    onClick={() => setDesktopFilterOpen(open => open === 'region' ? null : 'region')}
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
                                                onClick={() => {
                                                    setRegion(item);
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
                                    onClick={() => {
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
                                                    onClick={() => {
                                                        setDatePeriod(item.value);
                                                        setCustomStartDate(null);
                                                        setCustomEndDate(null);
                                                        setCalendarOpen(false);
                                                        setDesktopFilterOpen(null);
                                                    }}
                                                >
                                                    {item.label}
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                className={datePeriod === 'custom' ? styles.desktopFilterOptionActive : ''}
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
                                                        const [start, end] = update;
                                                        setCustomStartDate(start);
                                                        setCustomEndDate(end);
                                                        setDatePeriod(start ? 'custom' : 'all');
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
                                    onClick={() => setDesktopFilterOpen(open => open === 'price' ? null : 'price')}
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
                                                onClick={() => {
                                                    setMaxPrice(item.value);
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
                                className={styles.desktopFilterReset}
                                disabled={!hasAdvancedFilter && region === '전체'}
                                onClick={resetFilters}
                            >
                                초기화
                            </button>
                        </div>
                        <div className={styles.quickFilterRow}>
                        <button type="button" className={`${styles.filterButton} ${hasAdvancedFilter ? styles.filterHasValue : ''}`} onClick={() => setFilterOpen(true)}>
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
                                    onClick={() => {
                                        setRegion(item);
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
                                        onClick={() => {
                                            setRegion(item);
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
                                <button type="button" tabIndex={filterBarPinned ? 0 : -1} className={datePeriod !== 'all' ? styles.conditionActive : ''} onClick={() => setFilterOpen(true)}>
                                    <span aria-hidden="true">📅</span>
                                    {dateFilterLabel === '날짜' ? '날짜 전체' : dateFilterLabel}
                                    <span className={styles.conditionChevron} aria-hidden="true"><Icon name="chevron" /></span>
                                </button>
                                <button type="button" tabIndex={filterBarPinned ? 0 : -1} className={departure !== '전체' ? styles.conditionActive : ''} onClick={() => setFilterOpen(true)}>
                                    <span aria-hidden="true">✈️</span>
                                    출발 {departureFilterLabel === '출발지' ? '전체' : departureFilterLabel}
                                    <span className={styles.conditionChevron} aria-hidden="true"><Icon name="chevron" /></span>
                                </button>
                                <button type="button" tabIndex={filterBarPinned ? 0 : -1} className={region !== '전체' ? styles.conditionActive : ''} onClick={() => setFilterOpen(true)}>
                                    <span aria-hidden="true">📍</span>
                                    도착 {destinationFilterLabel === '목적지' ? '전체' : destinationFilterLabel}
                                    <span className={styles.conditionChevron} aria-hidden="true"><Icon name="chevron" /></span>
                                </button>
                            </div>
                        </nav>
                    </div>
                </div>

                <section className={styles.feedSection}>
                    <div className={styles.feedHeading}>
                        <div>
                            <h2>{query ? `'${query}' 검색 결과` : region === '전체' ? '전체 항공권' : `${region} 항공권`}</h2>
                            <span>{filteredFlights.length.toLocaleString('ko-KR')}개 · {updatedLabel}</span>
                        </div>
                        <div className={styles.sortSelect} ref={sortMenuRef}>
                            <button
                                type="button"
                                className={styles.sortTrigger}
                                aria-label="항공권 정렬"
                                aria-haspopup="listbox"
                                aria-expanded={sortOpen}
                                onClick={() => setSortOpen(value => !value)}
                            >
                                {SORT_OPTIONS.find(option => option.value === sort)?.label}
                                <span className={`${styles.sortChevron} ${sortOpen ? styles.sortChevronOpen : ''}`} aria-hidden="true"><Icon name="chevron" /></span>
                            </button>
                            {sortOpen && (
                                <div className={styles.sortMenu} role="listbox" aria-label="정렬 방식">
                                    {SORT_OPTIONS.map(option => (
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={sort === option.value}
                                            className={`${styles.sortOption} ${sort === option.value ? styles.sortOptionSelected : ''}`}
                                            key={option.value}
                                            onClick={() => {
                                                setSort(option.value);
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

                    {loading && (
                        <div className={styles.loadingList} aria-label="항공권 불러오는 중">
                            {[0, 1, 2].map(item => <div className={styles.skeletonCard} key={item} />)}
                        </div>
                    )}

                    {error && <div className={styles.emptyState}><strong>잠시 불러오지 못했어요.</strong><span>{error}</span></div>}

                    {!loading && !error && filteredFlights.length === 0 && (
                        <div className={styles.emptyState}>
                            <strong>조건에 맞는 표가 없어요.</strong>
                            <span>필터를 조금 넓혀보세요.</span>
                            <button type="button" onClick={resetFilters}>필터 초기화</button>
                        </div>
                    )}

                    <div className={styles.cardList}>
                        {displayedFlights.slice(0, visibleCount).map((flight, index) => {
                            const seats = flight.availableSeats || Number.parseInt(flight.seats || '', 10) || 0;
                            const duration = tripLength(flight);
                            const destination = stripAirport(flight.arrival.city);
                            const price = effectivePrice(flight);
                            const discountRate = Math.round(Math.max(0, flight.discountRate || 0));
                            const isTodayPick = isDefaultView && featuredPick?.flight.id === flight.id;
                            const cardNumber = index + 1;
                            const insightIndex = cardNumber >= firstInsightCard && (cardNumber - firstInsightCard) % insightInterval === 0
                                ? Math.floor((cardNumber - firstInsightCard) / insightInterval)
                                : -1;
                            const insight = insightIndex >= 0 ? feedInsights[insightIndex] : null;
                            return (
                                <Fragment key={flight.id}>
                                    <div className={styles.cardEntry}>
                                        <article className={`${styles.flightCard} ${isTodayPick ? styles.todayPickCard : ''}`}>
                                            <button type="button" className={styles.cardBody} onClick={() => openFlight(flight)}>
                                                {isTodayPick && (
                                                    <span className={styles.todayPickStrip}>
                                                        <strong>TIKIT DROP</strong>
                                                        <span>오늘 발견</span>
                                                    </span>
                                                )}
                                                <div className={styles.cardTopline}>
                                                    <div>
                                                        {isTodayPick && <span className={styles.todayPickInline}>TIKIT DROP</span>}
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
                                                            </span>
                                                        ) : seats > 0 && (
                                                            <span className={`${styles.footerStatus} ${seats <= 4 ? styles.footerStatusLow : ''}`}>
                                                                {seats}석 남음
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className={styles.priceBlock}>
                                                        <div className={styles.priceLine}>
                                                            {discountRate >= 5 && <span className={styles.priceDiscountBadge}>-{discountRate}%</span>}
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
                                                aria-label={favorites.has(flight.id) ? '찜 해제' : '찜하기'}
                                            >
                                                <Icon name="star" />
                                            </button>
                                        </article>
                                    </div>
                                    {insight && (
                                        <button
                                            type="button"
                                            className={`${styles.insightBar} ${insight.editorial ? styles.insightEditorial : styles.insightFact} ${styles[`insight${insight.kind[0].toUpperCase()}${insight.kind.slice(1)}`] || ''}`}
                                            onClick={() => openInsight(insight)}
                                            aria-label={`${insight.title}: ${insight.destination} ${priceText(insight.currentPrice)}`}
                                        >
                                            <span className={styles.insightTopline}>
                                                <span className={styles.insightEyebrow}>{insight.eyebrow}</span>
                                                <Icon name="arrow" />
                                            </span>
                                            {insight.editorial ? (
                                                <>
                                                    <strong className={styles.insightTitle}>{insight.title}</strong>
                                                    {insight.description && <span className={styles.insightDescription}>{insight.description}</span>}
                                                    <span className={styles.insightMetric}>
                                                        <strong className={styles.insightDestination}>{insight.destination}</strong>
                                                        <span className={styles.insightPriceTrail}>
                                                            {insight.previousPrice && (
                                                                <>
                                                                    <span className={styles.insightPreviousPrice}>{priceText(insight.previousPrice)}</span>
                                                                    <span className={styles.insightPriceArrow}>→</span>
                                                                </>
                                                            )}
                                                            <strong className={styles.insightCurrentPrice}>{priceText(insight.currentPrice)}</strong>
                                                        </span>
                                                    </span>
                                                    <span className={styles.insightFooter}>
                                                        <span>{insight.meta}</span>
                                                        {insight.badge && <em>{insight.badge}</em>}
                                                    </span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className={styles.insightFactHeadline}>
                                                        <strong>{insight.title}</strong>
                                                        <span>{insight.destination}</span>
                                                    </span>
                                                    {insight.description && <span className={styles.insightDescription}>{insight.description}</span>}
                                                    <span className={styles.insightFactFooter}>
                                                        <span>{insight.meta}</span>
                                                        <span className={styles.insightPriceTrail}>
                                                            {insight.previousPrice && (
                                                                <>
                                                                    <span className={styles.insightPreviousPrice}>{priceText(insight.previousPrice)}</span>
                                                                    <span className={styles.insightPriceArrow}>→</span>
                                                                </>
                                                            )}
                                                            <strong className={styles.insightCurrentPrice}>{priceText(insight.currentPrice)}</strong>
                                                        </span>
                                                    </span>
                                                </>
                                            )}
                                        </button>
                                    )}
                                </Fragment>
                            );
                        })}
                    </div>

                    {visibleCount < displayedFlights.length && (
                        <button
                            type="button"
                            className={styles.moreButton}
                            onClick={() => setVisibleCount(count => count + (window.matchMedia('(min-width: 960px)').matches ? 36 : 18))}
                        >
                            특가 더 보기
                        </button>
                    )}
                </section>

                <footer className={styles.previewFooter}>
                    <span>티키티킷 새 디자인 미리보기</span>
                    <a href="/">현재 티키티킷으로 돌아가기</a>
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
                <div className={`${styles.sheetOverlay} ${styles.filterOverlay}`} onClick={() => setFilterOpen(false)}>
                    <section className={styles.bottomSheet} onClick={event => event.stopPropagation()} aria-label="항공권 필터">
                        <div className={styles.sheetHandle} />
                        <div className={styles.sheetHeader}>
                            <h2>표 골라보기</h2>
                            <button type="button" onClick={resetFilters}>초기화</button>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>출발지</h3>
                            <div className={styles.optionGrid}>
                                {DEPARTURE_OPTIONS.map(item => (
                                    <button type="button" key={item} className={departure === item ? styles.optionActive : ''} onClick={() => setDeparture(item)}>{item}</button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>도착 지역</h3>
                            <div className={styles.optionGrid}>
                                {REGION_OPTIONS.map(item => (
                                    <button type="button" key={item} className={region === item ? styles.optionActive : ''} onClick={() => setRegion(item)}>{item}</button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>가격</h3>
                            <div className={styles.optionGrid}>
                                {PRICE_OPTIONS.map(item => (
                                    <button type="button" key={item.value} className={maxPrice === item.value ? styles.optionActive : ''} onClick={() => setMaxPrice(item.value)}>{item.label}</button>
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
                                        onClick={() => {
                                            setDatePeriod(item.value);
                                            setCustomStartDate(null);
                                            setCustomEndDate(null);
                                            setCalendarOpen(false);
                                        }}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                className={`${styles.dateDirectButton} ${datePeriod === 'custom' ? styles.dateDirectActive : ''}`}
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
                                            const [start, end] = update;
                                            setCustomStartDate(start);
                                            setCustomEndDate(end);
                                            setDatePeriod(start ? 'custom' : 'all');
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

                        <button type="button" className={`${styles.applyButton} ${calendarOpen ? styles.applyButtonCalendarOpen : ''}`} onClick={() => setFilterOpen(false)}>
                            {filteredFlights.length.toLocaleString('ko-KR')}개 항공권 보기
                        </button>
                    </section>
                </div>
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
                <div className={`${styles.sheetOverlay} ${styles.detailOverlay}`} onClick={() => setSelectedFlight(null)}>
                    <section className={`${styles.bottomSheet} ${styles.detailSheet}`} onClick={event => event.stopPropagation()} aria-label="항공권 상세">
                        <div className={styles.sheetHandle} />
                        <div className={styles.detailHeader}>
                            <div className={styles.detailAgencyLine}>
                                <span className={`${styles.sourceBadge} ${styles[selectedFlight.source]}`}>{SOURCE_NAMES[selectedFlight.source]}</span>
                                <span className={styles.detailAirline}>{selectedFlight.airline || '항공사 확인'}</span>
                                {detailSeats > 0 && <span className={styles.detailSeatCount}>{detailSeats}석 남음</span>}
                            </div>
                            <button type="button" onClick={() => setSelectedFlight(null)} aria-label="닫기"><Icon name="close" /></button>
                        </div>

                        <div className={styles.detailTitle}>
                            <div>
                                <h2>{departureName(selectedFlight)} ↔ {stripAirport(selectedFlight.arrival.city)}</h2>
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

                        <a className={styles.bookingButton} href={selectedFlight.link} target="_blank" rel="noopener noreferrer">
                            {SOURCE_NAMES[selectedFlight.source]}에서 확인하기 <Icon name="arrow" />
                        </a>
                        <div className={styles.detailSecondaryActions}>
                            {selectedHotelUrl && (
                                <a
                                    className={styles.hotelCompareButton}
                                    href={selectedHotelUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
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
                            <button className={styles.detailShareButton} type="button" onClick={() => shareFlight(selectedFlight)}>
                                <Icon name="share" />
                                <span>공유</span>
                            </button>
                        </div>
                    </section>
                </div>
                );
            })()}

            <AccountSheet
                open={showAccount}
                onClose={() => setShowAccount(false)}
                account={account}
                currentSearch={currentAccountSearch}
                onApplySearch={applyAccountSearch}
                onOpenFlight={openAccountFlight}
                guestFavorites={guestFavoriteSnapshots}
                onFavoriteRemoved={flightId => {
                    setFavorites(current => {
                        const next = new Set(current);
                        next.delete(flightId);
                        try { localStorage.setItem('favoriteFlights', JSON.stringify(Array.from(next))); } catch { }
                        return next;
                    });
                    setToast('찜에서 뺐어요.');
                }}
            />

            <MobileDealAlertSheet
                open={showDealAlert}
                initialDeparture={departure}
                initialRegion={region}
                initialMaxPrice={maxPrice || 200_000}
                onClose={() => setShowDealAlert(false)}
            />

            {toast && <div className={styles.toast} role="status">{toast}</div>}
        </main>
    );
}
