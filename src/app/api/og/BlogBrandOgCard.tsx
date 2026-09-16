export function BlogBrandOgCard() {
    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ff385c', fontFamily: 'Pretendard', color: '#222222' }}>
            <div style={{ width: 1080, height: 460, display: 'flex', flexDirection: 'column', position: 'relative', borderRadius: 28, background: '#ffffff' }}>
                <div style={{ height: 270, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontFamily: 'YeogiOttaeJalnan', fontSize: 110 }}>티키티킷</div>
                    <div style={{ fontSize: 42, fontWeight: 600, marginTop: 30 }}>전국 여행사의 땡처리 항공권을 한눈에!</div>
                </div>
                <div style={{ height: 3, display: 'flex', justifyContent: 'space-between', padding: '0 57px' }}>
                    {Array.from({ length: 29 }).map((_, index) => <div key={index} style={{ width: 17, height: 3, background: '#d2d2d2', borderRadius: 3 }} />)}
                </div>
                <div style={{ height: 187, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff385c', fontSize: 78, fontWeight: 800 }}>tikitikit.kr</div>
                <div style={{ position: 'absolute', top: 238, left: 0, width: 32, height: 64, background: '#ff385c', borderRadius: '0 999px 999px 0' }} />
                <div style={{ position: 'absolute', top: 238, right: 0, width: 32, height: 64, background: '#ff385c', borderRadius: '999px 0 0 999px' }} />
            </div>
        </div>
    );
}
