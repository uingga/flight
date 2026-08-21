import type { Metadata } from 'next';
import MobileRedesignPreview from './MobileRedesignPreview';

export const metadata: Metadata = {
    title: '모바일 새 디자인 미리보기',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function MobileRedesignPreviewPage() {
    return <MobileRedesignPreview />;
}
