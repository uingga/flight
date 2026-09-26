'use client';

import type { CSSProperties } from 'react';
import type { Flight } from '@/types/flight';
import { getCityImagePath } from '@/lib/city-image';
import { cityDisplayName } from '@/lib/utils/city-display';
import { airlineDisplayName } from '@/lib/utils/airline-display';
import { flightConnectionSummary } from '@/lib/flight-connections';
import styles from './DropHero.module.css';

const SOURCE_NAMES: Record<Flight['source'], string> = {
    ybtour: '노랑풍선',
    modetour: '모두투어',
    hanatour: '하나투어',
    onlinetour: '온라인투어',
    ttang: '땡처리닷컴',
    myrealtrip: '마이리얼트립', lottetour: '롯데관광', tripcom: '트립닷컴',
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
    return cityDisplayName(flight.departure.city);
}

function destinationName(flight: Flight) {
    return cityDisplayName(flight.arrival.city);
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
    alternatives?: { flight: Flight; duration: string | null }[];
    onOpen: () => void;
}

export default function DropHero({
    flight,
    pickDate,
    reason,
    price,
    discountRate,
    duration,
    alternatives = [],
    onOpen,
}: DropHeroProps) {
    const cityImagePath = getCityImagePath(flight.arrival.city);
    const imagePath = flight.arrival.airport === 'TAO' || cityImagePath === '/images/cities/qingdao.png'
        ? '/images/cities/qingdao-hero-20260923.png'
        : ['KLO', 'MPH'].includes(flight.arrival.airport)
        ? '/images/cities/boracay-hero-20260921.png'
        : flight.arrival.airport === 'SPN'
        ? '/images/cities/saipan-hero-20260921.png'
        : flight.arrival.airport === 'CAN' || cityImagePath === '/images/cities/guangzhou.png'
        ? '/images/cities/guangzhou-hero-20260921.png'
        : flight.arrival.airport === 'DYG' || cityImagePath === '/images/cities/zhangjiajie.png'
        ? '/images/cities/zhangjiajie-hero-v2.png'
        : ['PVG', 'SHA'].includes(flight.arrival.airport) || cityImagePath === '/images/cities/shanghai.png'
        ? '/images/cities/shanghai-hero-v2.png'
        : flight.arrival.airport === 'SGN'
        ? '/images/cities/hochiminh-hero-v2.png'
        : cityImagePath === '/images/cities/chengdu.png'
            ? '/images/cities/chengdu-hero-v2.png'
            : cityImagePath;
    const heroStyle = imagePath
        ? ({ backgroundImage: `url("${imagePath}")` } satisfies CSSProperties)
        : undefined;
    const saipanHolidayDates = new Set(['2026-10-02', '2026-10-03', '2026-10-06', '2026-10-07', '2026-10-08']);
    const isSaipanHolidayPick = pickDate === '2026-09-21'
        && [flight, ...alternatives.map(option => option.flight)].every(option =>
            option.arrival.airport === 'SPN' && option.source === 'ttang'
            && saipanHolidayDates.has(option.departure.date));
    const displayedReason = isSaipanHolidayPick
        ? '개천절도, 한글날도. 이번 연휴는 사이판에서.'
        : reason;
    const showDiscount = discountRate >= 5;
    const journey = [
        `${scheduleDate(flight.departure.date)} ~ ${scheduleDate(flight.arrival.date)}`,
        duration,
    ].filter(Boolean).join(' · ');
    const seller = [SOURCE_NAMES[flight.source], airlineDisplayName(flight.airline || '항공사 확인')].join(' · ');

    return (
        <section
            className={imagePath ? styles.hero : `${styles.hero} ${styles.heroFallback}`}
            style={heroStyle}
            data-drop-hero
            data-single-schedule={alternatives.length === 0 ? 'true' : undefined}
            data-drop-hero-flight-id={flight.id}
            data-drop-hero-image={imagePath || undefined}
            aria-labelledby="drop-hero-title"
        >
            <div className={styles.scrim} aria-hidden="true" />
            <button
                type="button"
                className={styles.cardAction}
                onClick={onOpen}
                aria-label={alternatives.length > 0
                    ? `${destinationName(flight)} 이 가격의 다른 일정 ${alternatives.length}개, 현재 일정 포함 전체 ${alternatives.length + 1}개 보기`
                    : `${destinationName(flight)} 항공권 상세 열기`}
            />
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
                {flight.source === 'ttang' && <p className={styles.seller}>발권수수료 20,000원 별도</p>}
                {displayedReason && <p className={`${styles.reason}${isSaipanHolidayPick ? ` ${styles.holidayReason}` : ''}`}>{displayedReason}</p>}
                <div className={styles.journey}>
                    <span>{departureName(flight)} 출발</span>
                    {' · '}
                    <span>{journey}</span>
                </div>
                <p className={styles.seller}>{seller}</p>
                {flightConnectionSummary(flight) && <p className={styles.seller}>{flightConnectionSummary(flight)}</p>}
                {alternatives.length > 0 && (
                    <p className={styles.scheduleLink}>
                        이 가격의 다른 일정 {alternatives.length}개
                        <span aria-hidden="true">→</span>
                    </p>
                )}
                {(imagePath === '/images/cities/qingdao-hero-20260923.png' || imagePath === '/images/cities/boracay-hero-20260921.png' || imagePath === '/images/cities/saipan-hero-20260921.png' || imagePath === '/images/cities/guangzhou-hero-20260921.png' || imagePath === '/images/cities/shanghai-hero-v2.png' || imagePath === '/images/cities/hochiminh-hero-v2.png' || imagePath === '/images/cities/chengdu-hero-v2.png' || imagePath === '/images/cities/zhangjiajie-hero-v2.png') && (
                    <p className={styles.imageDisclosure}>AI 생성 이미지</p>
                )}
            </div>
        </section>
    );
}
