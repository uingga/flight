'use client';

import { useState } from 'react';
import type { Flight } from '@/types/flight';
import {
    DiscoveryDetail,
    WEEKLY_DISCOVERY,
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
}: {
    flights: Flight[];
    onOpen?: () => void;
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
    const schedule = `${departure} 출발 · ${formatDate(flight.departure.date)} — ${formatDate(flight.arrival.date)} · ${tripLength(flight)}`;
    const locationMeta = scheduleFlights.length > 1
        ? `중국 윈난 · 일정 ${scheduleFlights.length}개`
        : '중국 윈난';
    const priceLabel = scheduleFlights.length > 1 ? '왕복 최저가' : '왕복';

    return (
        <>
            <button
                type="button"
                className={styles.bar}
                aria-haspopup="dialog"
                aria-label="리장 입문 자세히 보기"
                onClick={() => {
                    onOpen?.();
                    setOpen(true);
                }}
            >
                <div className={styles.intro}>
                    <span>이번 주 낯선 도시</span>
                    <h2>🧭 리장 입문</h2>
                    <p>{locationMeta}</p>
                </div>
                <div className={styles.content}>
                    <div className={styles.topline}>
                        <span className={styles.theme}>
                            <strong>고성과 설산을 함께</strong>
                        </span>
                        <span className={styles.price}>
                            <small>{priceLabel}</small>
                            <strong>{price}</strong>
                        </span>
                    </div>
                    <p>오래된 골목을 걷고, 가까운 설산까지 하루에 이어 볼 수 있어요. 고성과 자연을 한 일정에 함께 보기 좋은 도시예요.</p>
                    <div className={styles.schedule}>{schedule}</div>
                    <div className={styles.mobileFooter}>
                        <span className={styles.mobileSchedule}>{schedule}</span>
                        <span className={styles.mobilePrice}>
                            <small>{priceLabel}</small>
                            <strong>{price}</strong>
                        </span>
                    </div>
                </div>
            </button>

            {open && (
                <DiscoveryDetail
                    item={WEEKLY_DISCOVERY}
                    flight={flight}
                    flights={flights}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}
