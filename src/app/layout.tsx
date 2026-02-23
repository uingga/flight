import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://mytikit.vercel.app';

const inter = Inter({
    subsets: ['latin'],
    weight: ['400', '600', '700', '800'],
    display: 'swap',
    variable: '--font-inter',
});

export const metadata: Metadata = {
    title: {
        template: '%s | 티키티킷 - 여행사 땡처리 항공권을 한 곳에서',
        default: '티키티킷 - 여행사 땡처리 항공권을 한 곳에서',
    },
    description: '하나투어, 모두투어, 노랑풍선, 온라인투어, 땡처리닷컴의 실시간 땡처리 항공권을 한눈에 비교하고 최저가로 예약하세요. 지금 바로 떠나는 여행, 티키티킷과 함께하세요.',
    keywords: [
        '땡처리항공권', '특가항공권', '해외여행', '항공권비교', '티키티킷', 'tikitikit',
        '항공권특가', '해외항공권', '항공권최저가', '저가항공',
        '하나투어특가', '모두투어특가', '노랑풍선특가', '온라인투어특가', '땡처리닷컴',
        '일본항공권', '오사카항공권', '도쿄항공권', '후쿠오카항공권',
        '동남아항공권', '다낭항공권', '방콕항공권', '세부항공권', '나트랑항공권',
        '대만항공권', '홍콩항공권', '괌항공권',
    ],
    authors: [{ name: '티키티킷' }],
    creator: '티키티킷',
    publisher: '티키티킷',
    formatDetection: {
        email: false,
        address: false,
        telephone: false,
    },
    metadataBase: new URL(BASE_URL),
    alternates: {
        canonical: '/',
    },
    openGraph: {
        title: '티키티킷 - 5대 여행사 땡처리 항공권 모음',
        description: '하나투어, 모두투어, 노랑풍선, 온라인투어, 땡처리닷컴의 실시간 땡처리 항공권을 한눈에 비교하고 최저가로 예약하세요.',
        url: BASE_URL,
        siteName: '티키티킷',
        images: [
            {
                url: '/opengraph-image',
                width: 1200,
                height: 630,
                alt: '티키티킷 - 여행사 땡처리 항공권 모음',
            },
        ],
        locale: 'ko_KR',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: '티키티킷 - 5대 여행사 땡처리 항공권 모음',
        description: '여행사가 숨겨둔 땡처리 항공권을 실시간으로 모아 보여드립니다.',
        images: ['/opengraph-image'],
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
    verification: {
        google: '_TPCMSRl5q3tKLVUgBmoqiqQaG3eLDfK5j7d__Dd-MQ',
        other: {
            'naver-site-verification': '406376b984a69c6ed36e95e0eb6e330bf2baf7fd',
            'agd-partner-manual-verification': '',
        },
    },
    icons: {
        icon: '/icon.svg',
        apple: '/apple-icon.svg',
    },
    manifest: '/manifest.json',
    other: {
        'theme-color': '#6366f1',
        'apple-mobile-web-app-capable': 'yes',
        'apple-mobile-web-app-status-bar-style': 'default',
        'apple-mobile-web-app-title': '티키티킷',
    },
};

const GA_ID = process.env.NEXT_PUBLIC_GA_ID || '';

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="ko" className={inter.variable}>
            <head>
                {/* 아고다 파트너스 도메인 인증 */}
                <meta name="agd-partner-manual-verification" />
                {/* 로고 폰트 (Balsamiq Sans) */}
                <link
                    href="https://fonts.googleapis.com/css2?family=Balsamiq+Sans:ital,wght@1,700&display=swap"
                    rel="stylesheet"
                />
                {/* Preconnect to travel agency mobile domains for faster booking */}
                <link rel="preconnect" href="https://m.hanatour.com" />
                <link rel="preconnect" href="https://m.modetour.com" />
                <link rel="preconnect" href="https://m.onlinetour.co.kr" />

                <link rel="preconnect" href="https://mfly.ybtour.co.kr" />
            </head>
            <body className="antialiased">
                {/* GA4 Analytics */}
                {GA_ID && !GA_ID.startsWith('G-XXXX') && (
                    <>
                        <Script
                            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
                            strategy="afterInteractive"
                        />
                        <Script id="ga4-init" strategy="afterInteractive">
                            {`
                                window.dataLayer = window.dataLayer || [];
                                function gtag(){dataLayer.push(arguments);}
                                gtag('js', new Date());
                                gtag('config', '${GA_ID}', {
                                    send_page_view: true
                                });
                            `}
                        </Script>
                    </>
                )}
                {children}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            '@context': 'https://schema.org',
                            '@graph': [
                                {
                                    '@type': 'WebSite',
                                    name: '티키티킷',
                                    url: BASE_URL,
                                    description: '여행사 땡처리 항공권을 한 곳에서',
                                    inLanguage: 'ko',
                                    potentialAction: {
                                        '@type': 'SearchAction',
                                        target: `${BASE_URL}/?q={search_term_string}`,
                                        'query-input': 'required name=search_term_string',
                                    },
                                },
                                {
                                    '@type': 'Organization',
                                    name: '티키티킷',
                                    alternateName: 'TikiTikit',
                                    url: BASE_URL,
                                    logo: `${BASE_URL}/icon.svg`,
                                    description: '하나투어, 모두투어, 노랑풍선, 온라인투어, 땡처리닷컴의 실시간 특가 항공권을 한눈에 비교하는 서비스',
                                    sameAs: [],
                                },
                                {
                                    '@type': 'BreadcrumbList',
                                    itemListElement: [
                                        {
                                            '@type': 'ListItem',
                                            position: 1,
                                            name: '홈',
                                            item: BASE_URL,
                                        },
                                    ],
                                },
                                {
                                    '@type': 'SoftwareApplication',
                                    name: '티키티킷',
                                    applicationCategory: 'TravelApplication',
                                    operatingSystem: 'Web',
                                    offers: {
                                        '@type': 'Offer',
                                        price: '0',
                                        priceCurrency: 'KRW',
                                    },
                                    description: '하나투어, 모두투어, 노랑풍선, 온라인투어, 땡처리닷컴의 땡처리 항공권을 한눈에 비교하는 무료 웹 서비스',
                                },
                                {
                                    '@type': 'FAQPage',
                                    mainEntity: [
                                        {
                                            '@type': 'Question',
                                            name: '티키티킷은 어떤 서비스인가요?',
                                            acceptedAnswer: {
                                                '@type': 'Answer',
                                                text: '티키티킷은 하나투어, 모두투어, 노랑풍선, 온라인투어, 땡처리닷컴 등 주요 여행사의 땡처리 항공권을 실시간으로 모아 한눈에 비교할 수 있는 무료 서비스입니다.',
                                            },
                                        },
                                        {
                                            '@type': 'Question',
                                            name: '티키티킷은 무료인가요?',
                                            acceptedAnswer: {
                                                '@type': 'Answer',
                                                text: '네, 티키티킷은 완전히 무료로 이용하실 수 있습니다. 별도의 회원가입이나 결제 없이 바로 항공권 가격을 비교하실 수 있습니다.',
                                            },
                                        },
                                        {
                                            '@type': 'Question',
                                            name: '어떤 여행사의 항공권을 비교할 수 있나요?',
                                            acceptedAnswer: {
                                                '@type': 'Answer',
                                                text: '현재 하나투어, 모두투어, 노랑풍선, 온라인투어, 땡처리닷컴의 실시간 특가 항공권을 비교하실 수 있습니다. 향후 더 많은 여행사가 추가될 예정입니다.',
                                            },
                                        },
                                        {
                                            '@type': 'Question',
                                            name: '항공권 가격은 얼마나 자주 업데이트되나요?',
                                            acceptedAnswer: {
                                                '@type': 'Answer',
                                                text: '항공권 가격은 매일 7회 자동으로 업데이트됩니다. 각 여행사의 최신 땡처리 특가 정보를 실시간으로 반영합니다.',
                                            },
                                        },
                                        {
                                            '@type': 'Question',
                                            name: '땡처리 항공권이란 무엇인가요?',
                                            acceptedAnswer: {
                                                '@type': 'Answer',
                                                text: '땡처리 항공권은 여행사가 보유한 좌석 중 출발일이 임박하여 할인 판매하는 특가 항공권입니다. 정상가 대비 최대 50% 이상 저렴하게 구매할 수 있습니다.',
                                            },
                                        },
                                    ],
                                },
                            ],
                        }),
                    }}
                />
            </body>
        </html>
    );
}
