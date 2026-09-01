import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { SITE_URL } from '@/lib/site';
import { SITE_ALTERNATE_NAME, SITE_DESCRIPTION, SITE_NAME } from '@/lib/seo';
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
    description: SITE_DESCRIPTION,
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
        description: SITE_DESCRIPTION,
        url: BASE_URL,
        siteName: SITE_NAME,
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
        description: SITE_DESCRIPTION,
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
                {children}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            '@context': 'https://schema.org',
                            '@graph': [
                                {
                                    '@type': 'WebSite',
                                    '@id': `${BASE_URL}/#website`,
                                    name: SITE_NAME,
                                    alternateName: SITE_ALTERNATE_NAME,
                                    url: BASE_URL,
                                    description: SITE_DESCRIPTION,
                                    inLanguage: 'ko-KR',
                                    publisher: { '@id': `${BASE_URL}/#organization` },
                                },
                                {
                                    '@type': 'Organization',
                                    '@id': `${BASE_URL}/#organization`,
                                    name: SITE_NAME,
                                    alternateName: SITE_ALTERNATE_NAME,
                                    url: BASE_URL,
                                    logo: `${BASE_URL}/icon.svg`,
                                    description: SITE_DESCRIPTION,
                                    sameAs: ['https://blog.naver.com/mytikit'],
                                    knowsAbout: ['땡처리 항공권', '특가 항공권', '항공권 가격 비교'],
                                },
                            ],
                        }),
                    }}
                />
            </body>
        </html>
    );
}
