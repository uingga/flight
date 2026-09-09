'use client';

import { useState } from 'react';
import type { Flight } from '@/types/flight';
import {
    DiscoveryDetail,
    WEEKLY_DISCOVERY,
    type Discovery,
} from '@/app/preview/unknown-city-insight/UnknownCityInsightPreview';
import styles from './WeeklyDiscoveryInsight.module.css';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(date: string) {
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) return date;
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    return `${month}.${day}(${weekday})`;
}

function tripLength(flight: Flight) {
    const departAt = Date.parse(`${flight.departure.date}T00:00:00Z`);
    const returnAt = Date.parse(`${flight.arrival.date}T00:00:00Z`);
    if (!Number.isFinite(departAt) || !Number.isFinite(returnAt)) return '';
    const nights = Math.max(1, Math.round((returnAt - departAt) / 86_400_000));
    return `${nights}박 ${nights + 1}일`;
}

function departureName(city: string) {
    if (city.includes('인천')) return '인천';
    if (city.includes('김포')) return '김포';
    if (city.includes('김해')) return '부산';
    return city.replace(/\([^)]+\)/g, '').trim();
}

function scheduleKey(flight: Flight) {
    return [
        flight.departure.city,
        flight.departure.date,
        flight.departure.time,
        flight.arrival.city,
        flight.arrival.date,
        flight.arrival.time,
    ].join('|');
}

export default function WeeklyDiscoveryInsight({
    flights,
    onOpen,
    item = WEEKLY_DISCOVERY,
}: {
    flights: Flight[];
    onOpen?: () => void;
    item?: Discovery;
}) {
    const [open, setOpen] = useState(false);
    const scheduleFlights = Array.from(flights.reduce((bySchedule, flight) => {
        const key = scheduleKey(flight);
        if (!bySchedule.has(key)) bySchedule.set(key, flight);
        return bySchedule;
    }, new Map<string, Flight>()).values());
    const flight = scheduleFlights[0] || null;

    if (!flight) return null;

    const departure = departureName(flight.departure.city);
    const price = `${flight.price.toLocaleString('ko-KR')}원`;
    const hasMultipleSchedules = scheduleFlights.length > 1;
    const departureDates = Array.from(new Set(scheduleFlights.map(item => item.departure.date))).sort();
    const departureDateLabels = departureDates.map(date => `${formatDate(date)} 출발`);
    const schedule = hasMultipleSchedules
        ? `${departure} · ${departureDateLabels.join(' · ')} · 일정 ${scheduleFlights.length}개`
        : `${departure} 출발 · ${formatDate(flight.departure.date)} — ${formatDate(flight.arrival.date)} · ${tripLength(flight)}`;
    const mobileDateRange = `${departure} 출발 · ${formatDate(flight.departure.date)} → ${formatDate(flight.arrival.date)}`;
    const locationMeta = `${item.city} · ${item.location}`;
    const priceLabel = '왕복';

    return (
        <>
            <button
                type="button"
                className={styles.bar}
                aria-haspopup="dialog"
                aria-label={`${item.city} 여행지 자세히 보기`}
                onClick={() => {
                    onOpen?.();
                    setOpen(true);
                }}
            >
                <div className={styles.intro}>
                    <span>이번 주 낯선 도시</span>
                    <h2>
                        <span>{item.headline || item.city}</span>
                        <i className={styles.mobileTitleArrow} aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                                <path d="m9 6 6 6-6 6" />
                            </svg>
                        </i>
                    </h2>
                    <p>{locationMeta}</p>
                </div>
                <div className={styles.mobileCompact}>
                    <p className={styles.mobileSummary}>
                        <strong>{item.city}</strong>
                        <span>{item.summary}</span>
                    </p>
                    <p className={styles.mobileDescription}>
                        {item.detail}
                    </p>
                    <div className={styles.mobileDeal}>
                        <span className={styles.mobileSchedule}>
                            {hasMultipleSchedules ? (
                                <>
                                    <small>{departure} 출발</small>
                                    <span className={styles.departureDates}>
                                        {departureDateLabels.map(label => <span key={label}>{label}</span>)}
                                        <span>· 일정 {scheduleFlights.length}개</span>
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span>{mobileDateRange}</span>
                                    <small>{tripLength(flight)}</small>
                                </>
                            )}
                        </span>
                        <span className={styles.mobilePrice}>
                            <small>{priceLabel}</small>
                            <strong>{price}</strong>
                        </span>
                    </div>
                </div>
                <div className={styles.content}>
                    <div className={styles.topline}>
                        <span className={styles.theme}>
                            <strong>{item.summary}</strong>
                        </span>
                        <span className={styles.price}>
                            <small>{priceLabel}</small>
                            <strong>{price}</strong>
                        </span>
                    </div>
                    <p>{item.detail}</p>
                    <div className={styles.schedule}>{schedule}</div>
                </div>
            </button>

            {open && (
                <DiscoveryDetail
                    item={item}
                    flight={flight}
                    flights={flights}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}
