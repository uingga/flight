'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import type { Flight } from '@/types/flight';
import { DiscoveryDetail, WEEKLY_DISCOVERY } from '../unknown-city-insight/UnknownCityInsightPreview';
import styles from './page.module.css';

export default function LijiangInsightButton({ flights, children }: { flights: Flight[]; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const flight = flights[0] || null;

    return (
        <>
            <button
                type="button"
                className={styles.currentDiscoveryBar}
                aria-haspopup="dialog"
                aria-label="리장 입문 자세히 보기"
                disabled={!flight}
                onClick={() => setOpen(true)}
            >
                {children}
            </button>
            {open && flight && (
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
