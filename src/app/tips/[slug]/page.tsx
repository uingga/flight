import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';

export function generateStaticParams() {
    return [];
}

export function generateMetadata(): Metadata {
    return {
        title: '항공권 가격 기록',
        alternates: { canonical: '/tips/price-watch' },
        robots: { index: false, follow: true },
    };
}

export default function LegacyTipPage() {
    permanentRedirect('/tips/price-watch');
}
