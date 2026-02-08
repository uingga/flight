import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: '땡처리 항공권 대시보드',
    description: '모두투어, 땡처리닷컴, 노랑풍선의 특가 항공권을 한눈에',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="ko">
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body>{children}</body>
        </html>
    );
}
