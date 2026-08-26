import type { Metadata } from 'next';
import DropArcadePreview from './DropArcadePreview';

export const metadata: Metadata = {
    title: 'DROP ARCADE — 티키티킷 디자인 미리보기',
    description: '네오브루탈·Y2K 스타일 티키티킷 디자인 미리보기',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function DropArcadePreviewPage() {
    return <DropArcadePreview />;
}
