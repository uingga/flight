import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const dep = searchParams.get('dep') || '서울';
    const arr = searchParams.get('arr') || '';
    const price = searchParams.get('price') || '';
    const date = searchParams.get('date') || '';
    const airline = searchParams.get('airline') || '';
    const source = searchParams.get('source') || '';

    // 가격 포맷
    const priceNum = parseInt(price);
    const priceText = priceNum
        ? priceNum >= 10000
            ? `${Math.floor(priceNum / 10000)}만${priceNum % 10000 ? (priceNum % 10000 / 1000).toFixed(0) + '천' : ''}원`
            : `${priceNum.toLocaleString()}원`
        : '';

    // 여행사 이름
    const sourceNames: Record<string, string> = {
        hanatour: '하나투어',
        modetour: '모두투어',
        ybtour: '노랑풍선',
        onlinetour: '온라인투어',
        ttang: '땡처리닷컴',
        interpark: '인터파크',
    };
    const sourceName = sourceNames[source] || source;

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'linear-gradient(145deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)',
                    fontFamily: 'sans-serif',
                    position: 'relative',
                    overflow: 'hidden',
                    padding: '60px 80px',
                }}
            >
                {/* Background decorative elements */}
                <div style={{
                    position: 'absolute',
                    width: '600px',
                    height: '600px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%)',
                    top: '-200px',
                    right: '-150px',
                    display: 'flex',
                }} />
                <div style={{
                    position: 'absolute',
                    width: '400px',
                    height: '400px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(139, 92, 246, 0.12) 0%, transparent 70%)',
                    bottom: '-100px',
                    left: '-80px',
                    display: 'flex',
                }} />

                {/* Top: Brand */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginBottom: '40px',
                }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                        <path
                            d="M3.8 11.1 L20.2 2.9 Q22 2 21.2 3.8 L13.8 20.2 Q13 22 12.0 20.3 L9.5 15.7 Q8.5 14 6.6 13.4 L3.9 12.6 Q2 12 3.8 11.1Z"
                            fill="#818cf8"
                            transform="rotate(8 12 12)"
                        />
                    </svg>
                    <span style={{
                        fontSize: '28px',
                        fontWeight: 700,
                        color: '#a5b4fc',
                        letterSpacing: '-0.02em',
                    }}>
                        티키티킷
                    </span>
                    {sourceName && (
                        <span style={{
                            fontSize: '20px',
                            color: '#6366f1',
                            marginLeft: '8px',
                        }}>
                            via {sourceName}
                        </span>
                    )}
                </div>

                {/* Route */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '24px',
                    marginBottom: '32px',
                }}>
                    <span style={{
                        fontSize: '72px',
                        fontWeight: 900,
                        color: '#ffffff',
                        letterSpacing: '-0.02em',
                    }}>
                        {dep}
                    </span>
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                    }}>
                        <span style={{ fontSize: '40px', color: '#818cf8' }}>✈️</span>
                        <div style={{
                            width: '100px',
                            height: '2px',
                            background: 'linear-gradient(90deg, transparent, #6366f1, transparent)',
                            display: 'flex',
                        }} />
                    </div>
                    <span style={{
                        fontSize: '72px',
                        fontWeight: 900,
                        color: '#ffffff',
                        letterSpacing: '-0.02em',
                    }}>
                        {arr}
                    </span>
                </div>

                {/* Price */}
                {priceText && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '12px',
                        marginBottom: '24px',
                    }}>
                        <span style={{
                            fontSize: '64px',
                            fontWeight: 900,
                            color: '#fbbf24',
                            letterSpacing: '-0.02em',
                        }}>
                            {priceText}
                        </span>
                        <span style={{
                            fontSize: '24px',
                            color: '#94a3b8',
                        }}>
                            ~
                        </span>
                    </div>
                )}

                {/* Bottom info */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '20px',
                    marginTop: 'auto',
                }}>
                    {date && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 20px',
                            background: 'rgba(255,255,255,0.08)',
                            borderRadius: '12px',
                            border: '1px solid rgba(255,255,255,0.1)',
                        }}>
                            <span style={{ fontSize: '22px', color: '#94a3b8' }}>📅</span>
                            <span style={{ fontSize: '22px', color: '#e2e8f0', fontWeight: 600 }}>{date}</span>
                        </div>
                    )}
                    {airline && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 20px',
                            background: 'rgba(255,255,255,0.08)',
                            borderRadius: '12px',
                            border: '1px solid rgba(255,255,255,0.1)',
                        }}>
                            <span style={{ fontSize: '22px', color: '#e2e8f0', fontWeight: 600 }}>{airline}</span>
                        </div>
                    )}
                </div>
            </div>
        ),
        { width: 1200, height: 630 }
    );
}
