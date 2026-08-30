import type { Metadata } from 'next';
import UnknownCityInsightPreview from './UnknownCityInsightPreview';

export const metadata: Metadata = {
    title: '낯선 도시 인사이트바 미리보기',
    description: '지금 갈 수 있는 낯선 도시 인사이트바 디자인 미리보기',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function UnknownCityInsightPreviewPage() {
    return <UnknownCityInsightPreview />;
}
