import type { Metadata } from 'next';
import MobileRedesignPreview from '../mobile-redesign/MobileRedesignPreview';
import todayPickJson from '../../../../data/today-pick.json';

export const metadata: Metadata = {
    title: 'DROP 히어로 미리보기',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function DropHeroPreviewPage({
    searchParams,
}: {
    searchParams?: { sample?: string };
}) {
    const previewFallback = searchParams?.sample === '1'
        && typeof todayPickJson.flightId === 'string'
        && typeof todayPickJson.date === 'string'
        ? { flightId: todayPickJson.flightId, date: todayPickJson.date }
        : null;

    return (
        <MobileRedesignPreview
            dropHeroPreviewMode
            dropHeroPreviewFallback={previewFallback}
        />
    );
}
