import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = '티키티킷 - 오늘은 어디가 싸게 나왔을까요?';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// We fetch the font dynamically from Google Fonts to avoid bundling large font files,
// and to ensure Satori can render Korean characters correctly.
async function getFontData() {
    // Satori needs TTF/OTF. By providing a User-Agent that doesn't support woff2,
    // Google Fonts returns the TTF URL.
    const css = await (
        await fetch('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700;800;900&display=swap', {
            headers: {
                // Mock user agent to force TTF format response
                'User-Agent':
                    'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1',
            },
        })
    ).text();

    const resource = css.match(/src: url\((.+)\) format\('(truetype|opentype)'\)/);

    if (!resource) {
        throw new Error('Failed to extract font URL from Google Fonts CSS');
    }

    const res = await fetch(resource[1]);
    if (!res.ok) {
        throw new Error('Failed to fetch font data');
    }

    return await res.arrayBuffer();
}

export default async function Image() {
    // Load font data
    const fontData = await getFontData().catch((err) => {
        console.error('Font load error:', err);
        return null;
    });

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
                    background: 'linear-gradient(145deg, #f8fafc 0%, #eef2ff 30%, #e0e7ff 55%, #c7d2fe 80%, #a5b4fc 100%)',
                    fontFamily: '"Noto Sans KR", sans-serif',
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
                    background: 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%)',
                    top: '-100px',
                    right: '-100px',
                    display: 'flex',
                }} />
                <div style={{
                    position: 'absolute',
                    width: '400px',
                    height: '400px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(79, 70, 229, 0.12) 0%, transparent 70%)',
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
                        background: 'rgba(79, 70, 229, 0.1)',
                        borderRadius: '999px',
                        fontSize: '22px',
                        fontWeight: 600,
                        color: '#4f46e5',
                        marginBottom: '36px',
                        border: '1px solid rgba(79, 70, 229, 0.2)',
                    }}
                >
                    ✈️ 저렴한 땡처리 항공권
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
                                <stop stopColor="#6366f1" />
                                <stop offset="1" stopColor="#4f46e5" />
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
                            color: '#1e1b4b',
                            letterSpacing: '-0.03em',
                        }}
                    >
                        티키티킷
                    </span>
                </div>

                {/* Tagline */}
                <div
                    style={{
                        fontSize: '44px',
                        fontWeight: 800,
                        color: '#4338ca',
                        marginBottom: '40px',
                        letterSpacing: '-0.01em',
                    }}
                >
                    오늘은 어디가 싸게 나왔을까요?
                </div>

            </div>
        ),
        {
            ...size,
            ...(fontData ? {
                fonts: [
                    {
                        name: 'Noto Sans KR',
                        data: fontData,
                        style: 'normal',
                        weight: 800,
                    }
                ]
            } : {})
        }
    );
}
