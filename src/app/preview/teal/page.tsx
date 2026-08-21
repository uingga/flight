import type { Metadata } from 'next';
import Dashboard from '@/components/Dashboard';
import styles from './page.module.css';

export const metadata: Metadata = {
    title: '청록색 테마 미리보기 | 티키티킷',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function TealPreviewPage() {
    return (
        <main className={styles.tealPreview}>
            <Dashboard />
        </main>
    );
}
