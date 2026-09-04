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

function destinationName(flight: Flight) {
    return flight.arrival.city.replace(/\([^)]+\)/g, '').trim();
}

export interface DropHeroProps {
    flight: Flight;
    /** 오늘의 TIKIT DROP이 선정된 날짜 (YYYY-MM-DD). */
    pickDate: string;
    /** 기존 describeDropCard가 만든 근거 문장. 새 문구를 만들지 않는다. */
    reason: string;
    /** 카드와 같은 기준으로 계산한 표시 가격. */
    price: number;
    /** 동일 목적지 월평균가 대비 할인율. 카드와 같이 5% 이상일 때만 표시한다. */
    discountRate: number;
    /** 카드의 tripLength와 같은 여정 길이 문구 (예: 4박 5일). */
    duration: string | null;
    onOpen: () => void;
}

export default function DropHero({
    flight,
    pickDate,
    reason,
    price,
    discountRate,
    duration,
    onOpen,
}: DropHeroProps) {
    const imagePath = getCityImagePath(flight.arrival.city);
    const heroStyle = imagePath
        ? ({ backgroundImage: `url("${imagePath}")` } satisfies CSSProperties)
        : undefined;
    const seats = flight.availableSeats || Number.parseInt(flight.seats || '', 10) || 0;
    const showDiscount = discountRate >= 5;
    const schedule = [
        `${departureName(flight)} 출발`,
        `${scheduleDate(flight.departure.date)} — ${scheduleDate(flight.arrival.date)}`,
        duration,
    ].filter(Boolean).join(' · ');
    const seller = [
        flight.airline || '항공사 확인',
        SOURCE_NAMES[flight.source],
        seats > 0 ? `${seats}석 남음` : null,
    ].filter(Boolean).join(' · ');

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
                <p className={styles.eyebrow}>
                    <strong>TIKIT DROP</strong>
                    <span>{dropDate(pickDate)}</span>
                </p>
                <h2 id="drop-hero-title" className={styles.destination}>{destinationName(flight)}</h2>
                <p className={styles.priceLine}>
                    <strong className={styles.price}>
                        {price.toLocaleString('ko-KR')}
                        <small>원</small>
                    </strong>
                    {showDiscount && (
                        <span
                            className={styles.discount}
                            aria-label={`동일 목적지 월평균가보다 ${discountRate}% 낮은 가격`}
                        >
                            -{discountRate}%
                        </span>
                    )}
                </p>
                <p className={styles.reason}>{reason}</p>
                <dl className={styles.meta}>
                    <div>
                        <dt>일정</dt>
                        <dd>{schedule}</dd>
                    </div>
                    <div>
                        <dt>판매</dt>
                        <dd>{seller}</dd>
                    </div>
                </dl>
                <button type="button" className={styles.cta} onClick={onOpen}>
                    항공권 상세 열기
                    <span aria-hidden="true">→</span>
                </button>
            </div>
        </section>
    );
}
