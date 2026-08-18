import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

async function getFontData(origin: string) {
    const response = await fetch(`${origin}/Fonts/NanumGothic-OG.ttf`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Failed to fetch font data');
    return response.arrayBuffer();
}

export async function GET(request: NextRequest) {
    const headline = (request.nextUrl.searchParams.get('headline') || '티키티킷 드롭').replaceAll('만 원', '만\u00a0원');
    const deals = [1, 2, 3]
        .map(index => request.nextUrl.searchParams.get(`deal${index}`))
        .filter((value): value is string => Boolean(value))
        .map(value => {
            const [route, price = ''] = value.split(/\s{2,}/);
            return { route, price };
        });
    const fontData = await getFontData(request.nextUrl.origin).catch(() => null);

    return new ImageResponse(
        (
            <div style={{
                width: '100%', height: '100%', display: 'flex', position: 'relative', overflow: 'hidden',
                fontFamily: 'Nanum Gothic, sans-serif', color: '#17182f', background: 'linear-gradient(145deg, #fbfcff 0%, #eef2ff 62%, #e0e7ff 100%)',
            }}>
                <div style={{ position: 'absolute', width: 430, height: 430, right: -120, top: -160, borderRadius: 999, display: 'flex', background: 'rgba(99,102,241,.13)' }} />
                <div style={{ position: 'absolute', width: 330, height: 330, left: -120, bottom: -220, borderRadius: 999, display: 'flex', background: 'rgba(129,140,248,.11)' }} />
                <div style={{ position: 'relative', width: '100%', padding: '54px 62px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 25, fontWeight: 700, letterSpacing: '.12em', color: '#4f46e5' }}>TIKITIKIT DROP 01</div>
                        <div style={{ padding: '9px 18px', border: '1px solid #c7d2fe', borderRadius: 999, color: '#4f46e5', fontSize: 19 }}>가격 · 날짜 · 시간 확인</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 850 }}>
                        <div style={{ fontSize: 55, lineHeight: 1.18, fontWeight: 700, letterSpacing: '-.05em', marginBottom: 27 }}>{headline}</div>
                        <div style={{ display: 'flex', gap: 13 }}>
                            {deals.map((deal, index) => (
                                <div key={deal.route} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, padding: '17px 20px', border: '1px solid #dfe3ff', borderRadius: 17, background: 'rgba(255,255,255,.86)' }}>
                                    <span style={{ color: '#6366f1', fontSize: 17, fontWeight: 700 }}>PICK {index + 1}</span>
                                    <span style={{ color: '#4b4f69', fontSize: 19, whiteSpace: 'nowrap' }}>{deal.route}</span>
                                    <span style={{ color: '#3730a3', fontSize: 27, fontWeight: 700, whiteSpace: 'nowrap' }}>{deal.price}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b6f88', fontSize: 19 }}>
                        <span>티키티킷 · 지금 나온 땡처리 항공권</span>
                        <span>가격과 좌석은 바뀔 수 있어요</span>
                    </div>
                </div>
            </div>
        ),
        {
            width: 1200,
            height: 630,
            ...(fontData ? { fonts: [{ name: 'Nanum Gothic', data: fontData, style: 'normal' as const, weight: 700 }] } : {}),
        },
    );
}
