const PREVIEWS = [
    { label: 'PC 카카오톡 4K 실측', width: 345, height: 173, metadata: true },
    { label: '아이폰 카카오톡 실측', width: 282, height: 141, metadata: true },
    { label: '기본 OG · Threads/X형', width: 320, height: 168, metadata: false },
    { label: '작은 메신저·DM 카드', width: 240, height: 126, metadata: false },
];

const SHARE_COPY_GROUPS = [
    {
        label: '현재 사용 중',
        copies: [
            '🚨 비상!! 비상!!',
            '🎫 오늘의 이상한 표',
            '👀 가격이 좀 이상함',
            '👀 이건 한 번 봐야 함',
            '🏆 오늘의 이상한 가격',
            '🏆 최근 60일 중 가장 낮은 가격',
            '🏃 0연차 탈출 가능',
            '🌙 20:40 퇴근 후 출국',
            '🪑 마지막 4석 생존',
            '🕳 가격에 구멍 남',
            '🤯 담당자가 미쳤어요',
        ],
    },
    {
        label: 'DROP에서 가져온 후보',
        copies: [
            '🧨 가격표 사고 발생',
            '🚨 가격 붕괴 감지',
            '🕰 싼 이유를 시간표에서도 못 찾음',
            '🌙 가격 좋음 · 시간 험함',
            '🧳 주말 압축 성공',
            '🚧 막판에 가격이 선 넘음',
            '💸 31,000원 증발',
            '🦄 유니콘보다 드문 가격',
            '🎟 딱 4석 남음',
            '🌙 20:40 퇴근 후 출국',
        ],
    },
    {
        label: '데이터 연결 후 사용',
        copies: [
            '🏆 올해 최저가 TOP 3',
        ],
    },
];

const DROP_COPY_GROUPS = [
    {
        label: '가격·기록',
        copies: [
            '💸 {하락액} 증발',
            '🚨 가격 붕괴 감지',
            '🧨 20만원선 붕괴',
            '💥 예산선 파괴',
            '🔻 오늘 최저가 갱신',
            '🏆 최근 60일 최저가',
            '🏆 올해 최저가 TOP 3',
            '👻 실종 가격 재등장',
            '🦄 유니콘보다 드문 가격',
            '🚑 가격표 응급상황',
            '🕳 가격에 구멍 남',
            '🧨 가격표 사고 발생',
            '🧨 DROP 임계점 돌파',
        ],
    },
    {
        label: '좌석·새로운 표',
        copies: [
            '🔥 좌석 {n}개 증발',
            '🪑 마지막 {n}석 생존',
            '🎟 딱 {n}석 남음',
            '🎟 새 일정 투하',
            '👥 공범 1명 모집',
            '👥 한 명만 꼬시면 출국',
        ],
    },
    {
        label: '일정·출발지',
        copies: [
            '🏃 0연차 탈출 가능',
            '🌙 {출발시간} 퇴근 후 출국',
            '🥱 귀국 다음 날 위험',
            '🌙 가격 좋음 · 시간 험함',
            '🧳 주말 압축 성공',
            '🚄 청주까지 갈 이유',
            '💰 공항 바꾸고 {절약액} SAVE',
            '🛫 오늘은 {출발지A}보다 {출발지B}입니다',
        ],
    },
    {
        label: '카드 하단 반응형',
        copies: [
            '📣 오늘 업무: 이 표 알리기',
            '🫣 이건 묻어두면 혼남',
            '📋 안 보여드리면 업무 태만',
            '🤝 담당자 전원 말없이 고개 끄덕임',
            '🌙 퇴근은 한국에서, 취침은 해외에서',
            '🕰 싼 이유를 시간표에서도 못 찾음',
            '🚧 막판에 가격이 선 넘음',
            '💸 부산 갈 돈으로 {목적지}',
            '🚄 KTX 고민하다 출국',
            '🤨 이 가격이면 얘기가 달라짐',
            '🤷 안 갈 이유가 가격을 못 이김',
            '🧲 안 가려고 해도 가격이 방해함',
        ],
    },
    {
        label: '출발 임박',
        copies: [
            '🧳 D-{n}, 이러면 가야 하잖아',
            '🤷 D-{n}, 안 가기엔 너무 싸짐',
            '🏃 D-{n}, 사람 급하게 만드는 가격',
            '😵‍💫 D-{n}, 어쩌자고 이 가격',
        ],
    },
    {
        label: '상단 롤링 경보 띠 전용',
        copies: [
            '🚨 비상!! 비상!!',
            '🤯 담당자가 미쳤어요',
        ],
    },
];

const OG_EXCLUDED_COPY = new Set([
    '🏃 D-{n}, 사람 급하게 만드는 가격',
    '😵‍💫 D-{n}, 어쩌자고 이 가격',
]);

export default function OgKakaoPreviewPage() {
    return (
        <main
            style={{
                minHeight: '100vh',
                margin: 0,
                padding: '40px 24px 64px',
                background: '#f4f5f7',
                color: '#222222',
                fontFamily: 'Pretendard, Arial, sans-serif',
            }}
        >
            <div style={{ width: '100%', maxWidth: '760px', margin: '0 auto' }}>
                <h1 style={{ margin: 0, fontSize: '28px', letterSpacing: '-0.04em' }}>OG 축소 생존 확인</h1>
                <p style={{ margin: '10px 0 34px', color: '#64676e', fontSize: '16px', lineHeight: 1.55 }}>
                    같은 1200×630 이미지를 실제 PC·아이폰 카카오톡 크기와 대표적인 가로형 카드 크기로 축소·중앙 크롭했습니다.
                </p>

                <section id="share-copy-current" style={{ marginBottom: '42px' }}>
                    <h2 style={{ margin: '0 0 16px', fontSize: '20px', letterSpacing: '-0.035em' }}>공유 문구 후보 전체</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {SHARE_COPY_GROUPS.map(group => (
                            <div key={group.label}>
                                <h3 style={{ margin: '0 0 10px', color: '#666a72', fontSize: '13px', fontWeight: 700 }}>{group.label}</h3>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '9px' }}>
                                    {group.copies.map(copy => (
                                        <div
                                            key={copy}
                                            style={{
                                                padding: '10px 13px',
                                                borderRadius: '14px 14px 3px 14px',
                                                background: '#fee500',
                                                color: '#191919',
                                                fontSize: '15px',
                                                lineHeight: 1.35,
                                                fontWeight: 600,
                                                letterSpacing: '-0.025em',
                                            }}
                                        >
                                            {copy}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section id="drop-copy-all" style={{ marginBottom: '48px' }}>
                    <h2 style={{ margin: '0 0 8px', fontSize: '20px', letterSpacing: '-0.035em' }}>DROP 문구 원본 전체</h2>
                    <p style={{ margin: '0 0 18px', color: '#6b6f76', fontSize: '13px', lineHeight: 1.5 }}>
                        현재 DROP 카드 문구 문서에 있는 전체 목록입니다. 중괄호는 실제 데이터가 들어갈 자리입니다.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {DROP_COPY_GROUPS.map(group => (
                            <div key={group.label}>
                                <h3 style={{ margin: '0 0 10px', color: '#555961', fontSize: '14px', fontWeight: 700 }}>{group.label}</h3>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {group.copies.map(copy => {
                                        const excluded = OG_EXCLUDED_COPY.has(copy);
                                        return (
                                            <div
                                                key={copy}
                                                style={{
                                                    padding: '9px 12px',
                                                    border: excluded ? '1px dashed #c8cbd0' : '1px solid #e0e2e6',
                                                    borderRadius: '10px',
                                                    background: excluded ? '#f1f2f4' : '#ffffff',
                                                    color: excluded ? '#8a8e95' : '#2b2d31',
                                                    fontSize: '14px',
                                                    lineHeight: 1.35,
                                                    fontWeight: 600,
                                                    letterSpacing: '-0.025em',
                                                    textDecoration: excluded ? 'line-through' : 'none',
                                                }}
                                            >
                                                {copy}{excluded && <small style={{ marginLeft: '6px', textDecoration: 'none' }}>OG 제외</small>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '34px' }}>
                    {PREVIEWS.map(({ label, width, height, metadata }) => (
                        <section key={`${width}x${height}`}>
                            <div style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 700 }}>
                                {label} · {width}×{height}
                            </div>
                            {metadata && (
                                <div
                                    style={{
                                        width: `${width}px`,
                                        maxWidth: '100%',
                                        display: 'flex',
                                        justifyContent: 'flex-end',
                                        marginBottom: '8px',
                                    }}
                                >
                                    <div
                                        style={{
                                            maxWidth: '100%',
                                            padding: width >= 320 ? '10px 13px' : '9px 12px',
                                            borderRadius: '14px 14px 3px 14px',
                                            background: '#fee500',
                                            color: '#191919',
                                            fontSize: width >= 320 ? '15px' : '14px',
                                            lineHeight: 1.35,
                                            fontWeight: 600,
                                            letterSpacing: '-0.025em',
                                        }}
                                    >
                                        <span style={{ display: 'block' }}>🚨 비상!! 비상!!</span>
                                        <span
                                            style={{
                                                display: 'block',
                                                marginTop: '3px',
                                                color: '#1769d2',
                                                fontWeight: 500,
                                                textDecoration: 'underline',
                                                overflowWrap: 'anywhere',
                                            }}
                                        >
                                            https://tikitikit.kr/s/y9rzunf
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div
                                style={{
                                    width: `${width}px`,
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                    borderRadius: width >= 240 ? '10px' : '6px',
                                    background: '#ffffff',
                                    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.13)',
                                }}
                            >
                                <div style={{ width: '100%', height: `${height}px`, overflow: 'hidden' }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={`/opengraph-image?v=small-preview-4`}
                                        alt={`${width}×${height} 크기로 축소한 티키티킷 OG 이미지`}
                                        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
                                    />
                                </div>
                                {metadata && (
                                    <div style={{ padding: width >= 320 ? '14px 16px 15px' : '12px 14px 13px', background: '#ffffff' }}>
                                        <strong
                                            style={{
                                                display: 'block',
                                                fontSize: width >= 320 ? '16px' : '15px',
                                                lineHeight: 1.32,
                                                letterSpacing: '-0.035em',
                                            }}
                                        >
                                            서울 → 요나고 왕복 170,900원
                                        </strong>
                                        <span
                                            style={{
                                                display: 'block',
                                                marginTop: '7px',
                                                color: '#70747b',
                                                fontSize: width >= 320 ? '13px' : '12px',
                                                lineHeight: 1.35,
                                                letterSpacing: '-0.025em',
                                            }}
                                        >
                                            9.16(수)–9.18(금) · 에어서울 · 땡처리닷컴 · 4석 남음
                                        </span>
                                        <span style={{ display: 'block', marginTop: '8px', color: '#2679d8', fontSize: width >= 320 ? '13px' : '12px' }}>
                                            tikitikit.kr
                                        </span>
                                    </div>
                                )}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </main>
    );
}
