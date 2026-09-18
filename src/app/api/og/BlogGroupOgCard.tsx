export function BlogGroupOgCard({ cities }: { cities: string[] }) {
    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ff385c', fontFamily: 'Pretendard', color: '#222222' }}>
            <div style={{ width: 1080, height: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', borderRadius: 28, background: '#ffffff' }}>
                <div style={{ display: 'flex', marginTop: 32, fontFamily: 'YeogiOttaeJalnan', fontSize: 40 }}>티키티킷</div>
                <div style={{ display: 'flex', fontSize: 58, fontWeight: 800, marginTop: 24 }}>함께 보는 특가 항공권</div>
                <div style={{ display: 'flex', maxWidth: 900, fontSize: cities.length > 4 ? 34 : 42, fontWeight: 600, marginTop: 24 }}>{cities.join(' · ')}</div>
                <div style={{ display: 'flex', width: 900, borderTop: '3px dashed #d2d2d2', marginTop: 32 }} />
                <div style={{ display: 'flex', fontSize: 30, marginTop: 24 }}>노선별 가격과 일정 확인하기</div>
                <div style={{ display: 'flex', fontSize: 38, fontWeight: 800, color: '#ff385c', marginTop: 18 }}>tikitikit.kr</div>
                <div style={{ position: 'absolute', top: 242, left: 0, width: 28, height: 56, background: '#ff385c', borderRadius: '0 999px 999px 0' }} />
                <div style={{ position: 'absolute', top: 242, right: 0, width: 28, height: 56, background: '#ff385c', borderRadius: '999px 0 0 999px' }} />
            </div>
        </div>
    );
}
