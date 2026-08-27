import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { SITE_URL } from '@/lib/site';
import './globals.css';

const BASE_URL = SITE_URL;

// 주의: 이 설정을 바꾸면 next/font 해시가 바뀐다. HTML과 CSS가 같은 빌드에서 나와야
// --font-inter 변수가 연결된다 (2026-08-11 빌드 캐시로 인한 불일치 사고 있었음).
const inter = Inter({
    subsets: ['latin'],
    weight: ['400', '600', '700', '800'],
    display: 'swap',
    variable: '--font-inter',
});

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
};

export const metadata: Metadata = {
    title: {
        template: '%s | 티키티킷',
        default: '지금 나온 땡처리 항공권 | 티키티킷',
    },
    description: '6개 여행사의 땡처리 항공권 가격과 일정을 한곳에서 비교하세요.',
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
        title: '땡처리 항공권은 여기서 먼저 봅니다 | 티키티킷',
        description: '6개 여행사의 땡처리 항공권 가격과 일정을 한곳에서 비교하세요.',
        url: BASE_URL,
        siteName: '티키티킷',
        images: [
            {
                url: '/opengraph-image',
                width: 1200,
                height: 630,
                alt: '지금 나온 땡처리 항공권 | 티키티킷',
            },
        ],
        locale: 'ko_KR',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: '땡처리 항공권은 여기서 먼저 봅니다 | 티키티킷',
        description: '6개 여행사의 땡처리 항공권 가격과 일정을 한곳에서 비교하세요.',
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
        icon: '/icon.svg?v=20260826',
        apple: '/apple-icon.svg?v=20260826',
    },
    manifest: '/manifest.json',
    other: {
        'theme-color': '#ffffff',
        'apple-mobile-web-app-capable': 'yes',
        'apple-mobile-web-app-status-bar-style': 'default',
        'apple-mobile-web-app-title': '티키티킷',
        'agd-partner-manual-verification': '',
    },
};

const GA_ID = process.env.NEXT_PUBLIC_GA_ID || '';

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="ko" className={inter.variable} style={{ colorScheme: 'light only' }}>
            <head>
                {/* 아고다 파트너스 도메인 인증 */}
                <meta name="agd-partner-manual-verification" />
                <meta name="google-adsense-account" content="ca-pub-8329497855024061" />
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
                {/* Google Fonts preconnect */}
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                {/* AdSense meta only - script loaded lazily in body */}
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
                                var tikitikitAnalyticsExcluded = false;
                                try {
                                    tikitikitAnalyticsExcluded = localStorage.getItem('tikitikit_analytics_excluded') === 'true';
                                } catch (error) {}
                                window['ga-disable-${GA_ID}'] = tikitikitAnalyticsExcluded;
                                if (!tikitikitAnalyticsExcluded) {
                                    gtag('config', '${GA_ID}', {
                                        send_page_view: true
                                    });
                                }
                            `}
                        </Script>
                    </>
                )}
                {/* Google AdSense — lazy loaded for performance */}
                <Script
                    src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8329497855024061"
                    strategy="lazyOnload"
                    crossOrigin="anonymous"
                />
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
                                    description: '6개 여행사의 땡처리 항공권 가격과 일정을 한곳에서 비교하는 서비스',
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
                                    description: '여러 여행사의 저렴한 땡처리 항공권을 모아 보여주는 서비스',
                                    sameAs: ['https://blog.naver.com/mytikit'],
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
                                    description: '여러 여행사의 저렴한 땡처리 항공권을 모아 보여주는 무료 웹 서비스',
                                },
                                {
                                    '@type': 'FAQPage',
                                    mainEntity: [
                                        {
                                            '@type': 'Question',
                                            name: '티키티킷은 어떤 서비스인가요?',
                                            acceptedAnswer: {
                                                '@type': 'Answer',
                                                text: '티키티킷은 여행사마다 따로 올라오는 저렴한 땡처리 항공권을 한곳에 모아 보여주는 무료 서비스입니다.',
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
                                                text: '현재 하나투어, 모두투어, 노랑풍선, 온라인투어, 땡처리닷컴, 마이리얼트립의 항공권을 확인할 수 있습니다.',
                                            },
                                        },
                                        {
                                            '@type': 'Question',
                                            name: '항공권 가격은 얼마나 자주 업데이트되나요?',
                                            acceptedAnswer: {
                                                '@type': 'Answer',
                                                text: '항공권 정보는 하루 여러 차례 자동으로 업데이트합니다. 실제 가격과 좌석은 예약 시점에 달라질 수 있습니다.',
                                            },
                                        },
                                        {
                                            '@type': 'Question',
                                            name: '땡처리 항공권이란 무엇인가요?',
                                            acceptedAnswer: {
                                                '@type': 'Answer',
                                                text: '땡처리 항공권은 여행사가 보유한 좌석을 출발일이 가까워졌을 때 할인해 판매하는 항공권입니다.',
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
