/** @type {import('next').NextConfig} */
const nextConfig = {
    // 설정 변경은 webpack 빌드 캐시 버전을 갈아치운다 —
    // 낡은 캐시가 next/font 해시 불일치(HTML/CSS 다른 빌드 산출물)를 일으켜 추가함.
    poweredByHeader: false,
    // next/font 해시 불일치(폰트가 시스템 폰트로 보이는 증상)가 재발하면
    // 아래 날짜를 오늘로 바꿔 커밋하면 된다. 값이 바뀌면 빌드 캐시가 통째로 무효화된다.
    // (2026-08-11, 2026-08-14 두 차례 재발 — Vercel 빌드 캐시가 원인)
    env: {
        NEXT_PUBLIC_BUILD_EPOCH: '2026-08-14',
    },

    // 보안 헤더. 지금까지 하나도 없었다.
    //
    // 이 사이트는 여행사 6곳에서 긁어온 문자열을 그대로 화면에 그린다. 언젠가 그 경로로
    // 스크립트가 섞여 들어오면 지금은 막을 것이 아무것도 없다. 콘텐츠 보안 정책은
    // 우선 보고 전용(Report-Only)으로 켠다. 바로 강제하면 광고나 통계 스크립트가
    // 조용히 끊길 수 있어, 위반 내역을 며칠 지켜본 뒤 강제로 바꾸는 편이 안전하다.
    async headers() {
        const csp = [
            "default-src 'self'",
            // GA4·AdSense가 인라인 스크립트와 자기네 도메인을 쓴다
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.googletagmanager.com https://*.google-analytics.com https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data:",
            "connect-src 'self' https://*.google-analytics.com https://*.googletagmanager.com https://*.supabase.co https://*.doubleclick.net https://*.adtrafficquality.google",
            "frame-src https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].join('; ');

        const noIndexHeaders = [
            '/blog-post-:path*',
            '/blog-thumbnail-:path*',
            '/blog-assets.html',
            '/blog12-tables.html',
            '/profile-render.html',
            '/schedule-sample.html',
            '/tables-capture.html',
            '/demo-redirect.html',
            '/preview/:path*',
        ].map(source => ({
            source,
            headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
        }));

        return [{
            source: '/:path*',
            headers: [
                // 예약 버튼이 외부 결제로 이어지는 사이트라, 남의 페이지 안에 끼워 넣고
                // 클릭을 가로채는 수법을 막아야 한다
                { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
                { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
                { key: 'Content-Security-Policy-Report-Only', value: csp },
            ],
        }, ...noIndexHeaders];
    },
}

module.exports = nextConfig
