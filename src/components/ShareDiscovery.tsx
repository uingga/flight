'use client';
import { useMemo } from 'react';
import type { Flight } from '@/types/flight';
import { selectShareDiscovery } from '@/lib/share-discovery';
import { sharedCity } from '@/lib/shared-flight-context';
import styles from './ShareDiscovery.module.css';

const dateLabel = (value: string) => value.slice(5, 10).replace('-', '.');

export default function ShareDiscovery({ flights, selected, compare, onOpen, onBrowse, browseLabel = '지금 나온 항공권 더 보기' }: {
    flights: Flight[]; selected: Flight; compare: (a: Flight, b: Flight) => number;
    onOpen: (flight: Flight, entry: string) => void;
    onBrowse: () => void;
    browseLabel?: string;
}) {
    const groups = useMemo(() => selectShareDiscovery(flights, selected, compare), [flights, selected, compare]);
    return <section className={styles.discovery} aria-label="다른 항공권 둘러보기">
        {([
            { key: 'same_destination', title: `${sharedCity(selected.arrival.city)}, 다른 날짜는요?`, items: groups.sameDestination },
        ]).map(group => group.items.length > 0 && <div key={group.key} className={styles.group}>
            <h3>{group.title}</h3>
            <div className={styles.list}>{group.items.map(flight => <button key={flight.id + flight.departure.date}
                type="button" className={styles.card} onClick={() => onOpen(flight, `share_discovery_${group.key}`)}>
                <span className={styles.route}>{sharedCity(flight.departure.city)} · {sharedCity(flight.arrival.city)}</span>
                <span className={styles.dates}>{dateLabel(flight.departure.date)}–{dateLabel(flight.arrival.date)} · {flight.airline}</span>
                <span className={styles.price}>왕복 <strong>{flight.price.toLocaleString('ko-KR')}</strong>원 <span aria-hidden="true">›</span></span>
                {flight.source === 'ttang' && <span className={styles.fee}>발권수수료 20,000원 별도</span>}
            </button>)}</div>
        </div>)}
        <div className={styles.browse}>
            <p>이번 항공권이 아니어도 괜찮아요.</p>
            <button type="button" onClick={onBrowse}>{browseLabel} <span aria-hidden="true">›</span></button>
        </div>
    </section>;
}
