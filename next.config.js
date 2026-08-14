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
}

module.exports = nextConfig
