import type { Metadata } from 'next';
import TicketCatalogPreview from './TicketCatalogPreview';

export const metadata: Metadata = {
    title: '티키티킷 표 마켓 — 디자인 미리보기',
    description: '컬러 카탈로그형 티키티킷 디자인 미리보기',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function TicketCatalogPreviewPage() {
    return <TicketCatalogPreview />;
}
