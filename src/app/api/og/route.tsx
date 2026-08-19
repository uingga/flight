import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

// Keep OG rendering independent from Google Fonts so Korean text never falls back to boxes.
async function getFontData(origin: string) {
    const [regular, extraBold] = await Promise.all([
        fetch(`${origin}/Fonts/Pretendard-OG-Regular.otf`, { cache: 'no-store' }),
        fetch(`${origin}/Fonts/Pretendard-OG-ExtraBold.otf`, { cache: 'no-store' }),
    ]);
    if (!regular.ok || !extraBold.ok) throw new Error('Failed to fetch Pretendard font data');

    return {
        regular: await regular.arrayBuffer(),
        extraBold: await extraBold.arrayBuffer(),
    };
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
    const routeLength = dep.length + arr.length;
    const routeFontSize = routeLength >= 15 ? 54 : routeLength >= 11 ? 62 : 70;

    // Load font data
    const fontData = await getFontData(request.nextUrl.origin).catch((err) => {
        console.error('Font load error:', err);
        return null;
    });

    return new ImageResponse(
        (
            <div style={{
                width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                justifyContent: 'center', alignItems: 'center',
                background: 'linear-gradient(140deg, #241b63 0%, #4537a2 58%, #6757dc 100%)',
                fontFamily: 'Pretendard', position: 'relative', overflow: 'hidden',
                // Naver Blog crops 1200x630 link previews to roughly 5:3.
                // Keep all meaningful content inside a 110px horizontal safe area.
                padding: '48px 110px',
            }}>
                <div style={{
                    position: 'absolute', width: '520px', height: '520px', borderRadius: '50%',
                    border: '90px solid rgba(255,255,255,0.045)', top: '-330px', right: '-80px', display: 'flex',
                }} />
                <div style={{
                    position: 'absolute', width: '360px', height: '360px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.045)', bottom: '-245px', left: '-70px', display: 'flex',
                }} />

                <div style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: '24px', padding: '0 10px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ fontSize: '40px', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.04em' }}>티키티킷</span>
                    </div>
                    <span style={{ fontSize: '32px', fontWeight: 800, color: '#ffffff' }}>여행 기회가 도착했습니다</span>
                </div>

                <div style={{
                    width: '100%', height: '430px', display: 'flex', position: 'relative',
                    background: '#fbfaf7', borderRadius: '30px',
                    boxShadow: '0 24px 70px rgba(9, 5, 40, 0.35)', overflow: 'hidden',
                }}>
                    <div style={{ width: '72%', display: 'flex', flexDirection: 'column', padding: '44px 46px 38px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '26px' }}>
                            <span style={{
                                display: 'flex', padding: '8px 15px', borderRadius: '999px',
                                background: '#eeeafd', color: '#5544c7', fontSize: '28px', fontWeight: 800,
                            }}>왕복 항공권</span>
                            {sourceName && <span style={{ fontSize: '31px', color: '#4f4a59', marginLeft: '20px', fontWeight: 800 }}>{sourceName}</span>}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', width: '100%', marginBottom: '30px' }}>
                            <span style={{
                                fontSize: `${routeFontSize}px`, fontWeight: 800, color: '#1e1938',
                                letterSpacing: '-0.055em', lineHeight: 1.05, whiteSpace: 'nowrap',
                            }}>{dep}</span>
                            <div style={{ display: 'flex', alignItems: 'center', flex: 1, margin: '0 24px' }}>
                                <div style={{ display: 'flex', height: '2px', flex: 1, background: '#aaa1e6' }} />
                                <svg width="46" height="46" viewBox="0 0 64 64" fill="none" style={{ margin: '0 9px' }}>
                                    <path
                                        d="M58 29.5L38 18V8C38 3.5 35.5 1 32 1S26 3.5 26 8V18L6 29.5C3 31.2 3 34.8 6 36.5L26 33V48L18 54V59L32 56L46 59V54L38 48V33L58 36.5C61 37 62 31.2 58 29.5Z"
                                        fill="#6654d9"
                                        transform="rotate(90 32 32)"
                                    />
                                </svg>
                                <div style={{ display: 'flex', height: '2px', flex: 1, background: '#aaa1e6' }} />
                            </div>
                            <span style={{
                                fontSize: `${routeFontSize}px`, fontWeight: 800, color: '#1e1938',
                                letterSpacing: '-0.055em', lineHeight: 1.05, whiteSpace: 'nowrap',
                            }}>{arr}</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', marginTop: 'auto', width: '100%' }}>
                            {date && <span style={{ fontSize: '32px', fontWeight: 800, color: '#302b43' }}>{date}</span>}
                            {date && airline && <span style={{ fontSize: '28px', color: '#aaa4b3', margin: '0 18px' }}>·</span>}
                            {airline && <span style={{ fontSize: '32px', fontWeight: 800, color: '#302b43' }}>{airline}</span>}
                        </div>
                    </div>

                    <div style={{
                        width: '28%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                        alignItems: 'center', padding: '42px 28px 34px', borderLeft: '3px dashed #d8d3e9',
                        background: '#f5f2ff', position: 'relative',
                    }}>
                        <div style={{
                            position: 'absolute', width: '34px', height: '34px', borderRadius: '50%',
                            background: '#3d3092', left: '-18px', top: '-17px', display: 'flex',
                        }} />
                        <div style={{
                            position: 'absolute', width: '34px', height: '34px', borderRadius: '50%',
                            background: '#4e40b7', left: '-18px', bottom: '-17px', display: 'flex',
                        }} />
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span style={{ fontSize: '29px', color: '#514c5c', marginBottom: '14px', fontWeight: 800 }}>1인 왕복 예상금액</span>
                            <span style={{
                                fontSize: priceText.length >= 9 ? '46px' : priceText.length >= 8 ? '50px' : '54px', fontWeight: 800,
                                color: '#5140c6', letterSpacing: '-0.055em', lineHeight: 1.08, whiteSpace: 'nowrap',
                            }}>{priceText || '가격 확인'}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span style={{ fontSize: '31px', fontWeight: 800, color: '#40394f', letterSpacing: '0.05em' }}>TIKITIKIT.KR</span>
                        </div>
                    </div>
                </div>

                <div style={{ width: '100%', display: 'flex', padding: '20px 10px 0' }}>
                    <span style={{ color: '#ffffff', fontSize: '30px', fontWeight: 800 }}>여행사마다 흩어진 땡처리 항공권을 한곳에서</span>
                </div>
            </div>
        ),
        {
            width: 1200,
            height: 630,
            ...(fontData ? {
                fonts: [
                    {
                        name: 'Pretendard',
                        data: fontData.regular,
                        style: 'normal' as const,
                        weight: 400,
                    },
                    {
                        name: 'Pretendard',
                        data: fontData.extraBold,
                        style: 'normal' as const,
                        weight: 800,
                    }
                ]
            } : {})
        }
    );
}
