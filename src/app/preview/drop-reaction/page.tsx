import type { Metadata } from 'next';
import DropReactionPreview from './DropReactionPreview';

export const metadata: Metadata = {
    title: 'TIKIT DROP — 리액션 디자인 미리보기',
    description: '티키티킷의 새로운 편집형 디자인 미리보기',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function DropReactionPreviewPage() {
    return <DropReactionPreview />;
}
