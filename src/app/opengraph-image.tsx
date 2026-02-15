import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = '티킷 - 여행사 땡처리 항공권을 한 곳에서';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(145deg, #0f172a 0%, #1e1b4b 35%, #312e81 60%, #4f46e5 85%, #06b6d4 100%)',
                    fontFamily: 'sans-serif',
                    position: 'relative',
                    overflow: 'hidden',
                }}
            >
                {/* Decorative glow circles */}
                <div style={{
                    position: 'absolute',
                    width: '500px',
                    height: '500px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(99, 102, 241, 0.3) 0%, transparent 70%)',
                    top: '-100px',
                    right: '-100px',
                    display: 'flex',
                }} />
                <div style={{
                    position: 'absolute',
                    width: '400px',
                    height: '400px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(6, 182, 212, 0.25) 0%, transparent 70%)',
                    bottom: '-80px',
                    left: '-60px',
                    display: 'flex',
                }} />

                {/* Top badge */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 28px',
                        background: 'rgba(255, 255, 255, 0.12)',
                        borderRadius: '999px',
                        fontSize: '22px',
                        fontWeight: 600,
                        color: 'rgba(255, 255, 255, 0.85)',
                        marginBottom: '36px',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                    }}
                >
                    ✈️ 실시간 특가 항공권 비교
                </div>

                {/* Logo area */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '20px',
                        marginBottom: '28px',
                    }}
                >
                    {/* Paper airplane icon */}
                    <svg
                        width="88"
                        height="88"
                        viewBox="0 0 24 24"
                        fill="none"
                    >
                        <defs>
                            <linearGradient id="g" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#818cf8" />
                                <stop offset="1" stopColor="#06b6d4" />
                            </linearGradient>
                        </defs>
                        <path
                            d="M3.8 11.1 L20.2 2.9 Q22 2 21.2 3.8 L13.8 20.2 Q13 22 12.0 20.3 L9.5 15.7 Q8.5 14 6.6 13.4 L3.9 12.6 Q2 12 3.8 11.1Z"
                            fill="url(#g)"
                            transform="rotate(8 12 12)"
                        />
                    </svg>
                    <span
                        style={{
                            fontSize: '96px',
                            fontWeight: 900,
                            color: '#ffffff',
                            letterSpacing: '-0.03em',
                        }}
                    >
                        Tikit
                    </span>
                </div>

                {/* Tagline */}
                <div
                    style={{
                        fontSize: '44px',
                        fontWeight: 800,
                        color: '#e0e7ff',
                        marginBottom: '40px',
                        letterSpacing: '-0.01em',
                    }}
                >
                    여행사 땡처리 항공권을 한 곳에서
                </div>

            </div>
        ),
        { ...size }
    );
}
