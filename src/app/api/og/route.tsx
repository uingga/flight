import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

// Keep OG rendering independent from Google Fonts so Korean text never falls back to boxes.
async function getFontData(origin: string) {
    const res = await fetch(`${origin}/Fonts/NanumGothic-OG.ttf`, { cache: 'no-store' });
    if (!res.ok) {
        throw new Error('Failed to fetch font data');
    }

    return await res.arrayBuffer();
}

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
    const priceText = priceNum ? `${priceNum.toLocaleString('ko-KR')}원` : '';

    // 여행사 이름
    const sourceNames: Record<string, string> = {
        hanatour: '하나투어',
        modetour: '모두투어',
        ybtour: '노랑풍선',
        onlinetour: '온라인투어',
        ttang: '땡처리닷컴',
        myrealtrip: '마이리얼트립',
        interpark: '인터파크',
    };
    const sourceName = sourceNames[source] || source;
    const longestCityLength = Math.max(dep.length, arr.length);
    const routeFontSize = longestCityLength >= 8 ? 58 : longestCityLength >= 6 ? 66 : 76;

    // Load font data
    const fontData = await getFontData(request.nextUrl.origin).catch((err) => {
        console.error('Font load error:', err);
        return null;
    });

    return new ImageResponse(
        (
            <div style={{
                width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                background: 'linear-gradient(135deg, #17133f 0%, #302675 55%, #5547b8 100%)',
                fontFamily: '"Nanum Gothic", sans-serif', position: 'relative', overflow: 'hidden',
                padding: '42px 54px',
            }}>
                <div style={{
                    position: 'absolute', width: '480px', height: '480px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.06)', top: '-270px', right: '-100px', display: 'flex',
                }} />
                <div style={{
                    position: 'absolute', width: '320px', height: '320px', borderRadius: '50%',
                    background: 'rgba(129,140,248,0.14)', bottom: '-220px', left: '-60px', display: 'flex',
                }} />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
                            <path d="M3.8 11.1 L20.2 2.9 Q22 2 21.2 3.8 L13.8 20.2 Q13 22 12 20.3 L9.5 15.7 Q8.5 14 6.6 13.4 L3.9 12.6 Q2 12 3.8 11.1Z" fill="#ffffff" transform="rotate(8 12 12)" />
                        </svg>
                        <span style={{ fontSize: '32px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.03em' }}>티키티킷</span>
                    </div>
                    <div style={{
                        display: 'flex', padding: '9px 20px', borderRadius: '999px',
                        background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.22)',
                        fontSize: '20px', fontWeight: 700, color: '#e9e7ff',
                    }}>여행사 특가 항공권</div>
                </div>

                <div style={{
                    flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                    background: '#ffffff', borderRadius: '30px', padding: '34px 42px 30px',
                    boxShadow: '0 22px 60px rgba(8, 5, 35, 0.28)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '39%' }}>
                            <span style={{ fontSize: '20px', color: '#7c7a91', marginBottom: '5px' }}>출발</span>
                            <span style={{ fontSize: `${routeFontSize}px`, fontWeight: 700, color: '#191633', letterSpacing: '-0.05em', lineHeight: 1.08 }}>{dep}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '18%' }}>
                            <svg width="72" height="44" viewBox="0 0 72 44" fill="none">
                                <path d="M5 22H65" stroke="#6D5CE8" strokeWidth="3" strokeLinecap="round" strokeDasharray="7 7" />
                                <path d="M50 8L66 22L50 36" stroke="#6D5CE8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span style={{ fontSize: '18px', color: '#6d5ce8', fontWeight: 700, marginTop: '5px' }}>왕복</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '39%' }}>
                            <span style={{ fontSize: '20px', color: '#7c7a91', marginBottom: '5px' }}>도착</span>
                            <span style={{ fontSize: `${routeFontSize}px`, fontWeight: 700, color: '#191633', letterSpacing: '-0.05em', lineHeight: 1.08 }}>{arr}</span>
                        </div>
                    </div>

                    <div style={{ height: '1px', width: '100%', background: '#ebeaf2', display: 'flex' }} />

                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', width: '100%' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
                            {date && <span style={{ fontSize: '25px', color: '#343149', fontWeight: 700 }}>일정&nbsp;&nbsp;{date}</span>}
                            <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                                {airline && <span style={{ fontSize: '22px', color: '#68657a' }}>{airline}</span>}
                                {airline && sourceName && <span style={{ fontSize: '19px', color: '#c1bfca' }}>•</span>}
                                {sourceName && <span style={{ fontSize: '22px', color: '#68657a' }}>{sourceName}</span>}
                            </div>
                        </div>
                        {priceText && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                <span style={{ fontSize: '19px', color: '#777489', marginBottom: '3px' }}>성인 1인 총액</span>
                                <span style={{ fontSize: '58px', fontWeight: 700, color: '#5b4bd6', letterSpacing: '-0.045em', lineHeight: 1 }}>{priceText}</span>
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 8px 0', color: '#d9d5ff', fontSize: '18px' }}>
                    <span>전국 여행사의 땡처리 항공권을 한눈에</span>
                    <span>가격과 좌석은 실시간으로 변동될 수 있어요</span>
                </div>
            </div>
        ),
        {
            width: 1200,
            height: 630,
            ...(fontData ? {
                fonts: [
                    {
                        name: 'Nanum Gothic',
                        data: fontData,
                        style: 'normal' as const,
                        weight: 700,
                    }
                ]
            } : {})
        }
    );
}
