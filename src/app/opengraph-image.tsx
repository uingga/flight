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
                    background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 30%, #c7d2fe 60%, #6366f1 100%)',
                    fontFamily: 'sans-serif',
                }}
            >
                {/* Logo area */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        marginBottom: '32px',
                    }}
                >
                    {/* Paper airplane icon */}
                    <svg
                        width="64"
                        height="64"
                        viewBox="0 0 24 24"
                        fill="none"
                    >
                        <defs>
                            <linearGradient id="g" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#6366f1" />
                                <stop offset="1" stopColor="#4338ca" />
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
                            fontSize: '72px',
                            fontWeight: 900,
                            color: '#111827',
                            letterSpacing: '-0.02em',
                        }}
                    >
                        Tikit
                    </span>
                </div>

                {/* Tagline */}
                <div
                    style={{
                        fontSize: '28px',
                        fontWeight: 700,
                        color: '#0e7490',
                        marginBottom: '16px',
                    }}
                >
                    여행사 땡처리 항공권을 한 곳에서
                </div>

                {/* Description */}
                <div
                    style={{
                        fontSize: '20px',
                        color: '#475569',
                        maxWidth: '600px',
                        textAlign: 'center',
                        lineHeight: 1.5,
                    }}
                >
                    모두투어 · 땡처리닷컴 · 노랑풍선 · 하나투어 · 온라인투어
                </div>

                {/* Bottom badge */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginTop: '40px',
                        padding: '12px 24px',
                        background: 'rgba(255, 255, 255, 0.7)',
                        borderRadius: '999px',
                        fontSize: '18px',
                        fontWeight: 600,
                        color: '#4338ca',
                    }}
                >
                    ✈️ 실시간 특가 항공권 비교
                </div>
            </div>
        ),
        { ...size }
    );
}
