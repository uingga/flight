/** @type {import('next').NextConfig} */
const nextConfig = {
    // 설정 변경은 webpack 빌드 캐시 버전을 갈아치운다 —
    // 낡은 캐시가 next/font 해시 불일치(HTML/CSS 다른 빌드 산출물)를 일으켜 추가함.
    poweredByHeader: false,
}

module.exports = nextConfig
