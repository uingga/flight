'use client';

import type { CSSProperties } from 'react';
import type { Flight } from '@/types/flight';
import { getCityImagePath } from '@/lib/city-image';
import styles from './DropHero.module.css';

const SOURCE_NAMES: Record<Flight['source'], string> = {
    ybtour: '노랑풍선',
    modetour: '모두투어',
    hanatour: '하나투어',
    onlinetour: '온라인투어',
    ttang: '땡처리닷컴',
    myrealtrip: '마이리얼트립',
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function dropDate(date: string) {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return date;
    return `${Number(match[2])}/${Number(match[3])}`;
}

function scheduleDate(date: string) {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return date;
    const [, year, month, day] = match;
    const weekday = WEEKDAYS[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
    return `${Number(month)}.${Number(day)}(${weekday})`;
}

function departureName(flight: Flight) {
    if (flight.departure.airport === 'ICN') return '인천';
    if (flight.departure.airport === 'GMP') return '김포';
    if (flight.departure.airport === 'PUS') return '부산';
    return flight.departure.city.replace(/\([^)]+\)/g, '').trim();
}

export default function DropHero({
    flight,
    pickDate,
    reason,
    onOpen,
}: {
    flight: Flight;
    pickDate: string;
    reason: string;
    onOpen: () => void;
}) {
    const imagePath = getCityImagePath(flight.arrival.city);
    const heroStyle = imagePath
        ? ({ backgroundImage: `url("${imagePath}")` } satisfies CSSProperties)
        : undefined;
    const metadata = [
        departureName(flight),
        `${scheduleDate(flight.departure.date)} — ${scheduleDate(flight.arrival.date)}`,
        flight.airline || '항공사 확인',
        SOURCE_NAMES[flight.source],
    ].join(' · ');

    return (
        <section
            className={imagePath ? styles.hero : `${styles.hero} ${styles.heroFallback}`}
            style={heroStyle}
            data-drop-hero
            data-drop-hero-flight-id={flight.id}
            data-drop-hero-image={imagePath || undefined}
            aria-labelledby="drop-hero-title"
        >
            <div className={styles.scrim} aria-hidden="true" />
            <div className={styles.content}>
                <p className={styles.eyebrow}>TIKIT DROP · {dropDate(pickDate)}</p>
                <h2 id="drop-hero-title">{reason}</h2>
                <p className={styles.metadata}>{metadata}</p>
                <button type="button" onClick={onOpen}>
                    항공권 상세 열기
                    <span aria-hidden="true">→</span>
                </button>
            </div>
        </section>
    );
}
