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
    const mobileDateRange = `${departure} 출발 · ${formatDate(flight.departure.date)} → ${formatDate(flight.arrival.date)}`;
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
                aria-label="리장 여행지 자세히 보기"
                onClick={() => {
                    onOpen?.();
                    setOpen(true);
                }}
            >
                <div className={styles.intro}>
                    <span>이번 주 낯선 도시</span>
                    <h2>
                        <span>🧭 리장이 어디냐고요?</span>
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
                        <strong>중국 윈난</strong>
                        <span>골목 끝에 설산이 나오는 곳</span>
                    </p>
                    <p className={styles.mobileDescription}>
                        해발 2,400m의 오래된 도시 사이로 물길이 흐릅니다. 이름은 낯선데, 풍경은 한 번에 기억납니다.
                    </p>
                    <div className={styles.mobileDeal}>
                        <span className={styles.mobileSchedule}>
                            <span>{mobileDateRange}</span>
                            <small>{tripLength(flight)}</small>
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
                            <strong>골목 끝에 설산이 나오는 곳</strong>
                        </span>
                        <span className={styles.price}>
                            <small>{priceLabel}</small>
                            <strong>{price}</strong>
                        </span>
                    </div>
                    <p>해발 2,400m의 오래된 도시 사이로 물길이 흐릅니다. 이름은 낯선데, 풍경은 한 번에 기억납니다.</p>
                    <div className={styles.schedule}>{schedule}</div>
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
