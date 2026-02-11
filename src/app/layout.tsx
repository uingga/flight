import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: {
        template: '%s | 티킷 - 여행사 땡처리 항공권을 한 곳에서',
        default: '티킷 - 여행사 땡처리 항공권을 한 곳에서',
    },
    description: '모두투어, 땡처리닷컴, 노랑풍선, 하나투어, 온라인투어의 실시간 땡처리 항공권을 한눈에 비교하고 최저가로 예약하세요. 지금 바로 떠나는 여행, 티킷과 함께하세요.',
    keywords: ['땡처리항공권', '특가항공권', '해외여행', '패키지여행', '티킷', 'Tikit', '저가항공', '항공권비교', '일본여행', '동남아여행'],
    authors: [{ name: 'Tikit' }],
    creator: 'Tikit',
    publisher: 'Tikit',
    formatDetection: {
        email: false,
        address: false,
        telephone: false,
    },
    metadataBase: new URL('https://tikit.vercel.app'),
    alternates: {
        canonical: '/',
    },
    openGraph: {
        title: '티킷 - 5대 여행사 땡처리 항공권 모음',
        description: '놓치면 손해! 여행사가 숨겨둔 땡처리 항공권을 실시간으로 모아 보여드립니다.',
        url: 'https://tikit.vercel.app',
        siteName: '티킷 (Tikit)',
        images: [
            {
                url: '/og-image.png', // 추후 생성 필요
                width: 1200,
                height: 630,
                alt: '티킷 - 여행사 땡처리 항공권 모음',
            },
        ],
        locale: 'ko_KR',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: '티킷 - 5대 여행사 땡처리 항공권 모음',
        description: '여행사가 숨겨둔 땡처리 항공권을 실시간으로 모아 보여드립니다.',
        // images: ['/og-image.png'],
    },
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            'max-video-preview': -1,
            'max-image-preview': 'large',
            'max-snippet': -1,
        },
    },
    // verification: {
    //     google: 'YOUR_GOOGLE_VERIFICATION_CODE',
    //     other: {
    //         'naver-site-verification': 'YOUR_NAVER_VERIFICATION_CODE',
    //     },
    // },
    icons: {
        icon: '/icon.svg',
        apple: '/apple-icon.svg',
    },
    manifest: '/manifest.json',
    other: {
        'theme-color': '#2563EB',
        'apple-mobile-web-app-capable': 'yes',
        'apple-mobile-web-app-status-bar-style': 'default',
        'apple-mobile-web-app-title': '티킷',
    },
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
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playwrite+NZ+Basic:wght@100..400&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body className="antialiased">
                {children}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            '@context': 'https://schema.org',
                            '@graph': [
                                {
                                    '@type': 'WebSite',
                                    name: '티킷 (Tikit)',
                                    url: 'https://tikit.vercel.app',
                                    description: '여행사 땡처리 항공권을 한 곳에서',
                                    potentialAction: {
                                        '@type': 'SearchAction',
                                        target: 'https://tikit.vercel.app/?q={search_term_string}',
                                        'query-input': 'required name=search_term_string',
                                    },
                                },
                                {
                                    '@type': 'SoftwareApplication',
                                    name: '티킷 (Tikit)',
                                    applicationCategory: 'TravelApplication',
                                    operatingSystem: 'Web',
                                    offers: {
                                        '@type': 'Offer',
                                        price: '0',
                                        priceCurrency: 'KRW',
                                    },
                                    aggregateRating: {
                                        '@type': 'AggregateRating',
                                        ratingValue: '4.8',
                                        ratingCount: '1250',
                                    },
                                },
                            ],
                        }),
                    }}
                />
            </body>
        </html>
    );
}
