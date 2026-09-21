export interface Te31Campaign {
    name: string;
    source: string;
    users: number;
    sessions: number;
    detailOpenUsers: number | null;
    bookingClickUsers: number | null;
    bookingClicks: number | null;
}

// Manual observations, not a live scraper. Unknown recommendations stay null.
export const TE31_POSTS = [
    { id: 5270, date: '2026-09-18', title: '[항공권] 부산-광저우 왕복 99,000원', campaign: null, link: '/t/g-can-260918?utm_source=te31&utm_medium=community', views: 119, comments: 1, recommendations: 2, observedAt: '2026-09-21T19:09:00+09:00', recommendationsObservedAt: '2026-09-21T19:09:00+09:00', commentNote: '원문 링크는 te31 출처지만 글별 캠페인을 지정하지 않았습니다. 공통 캠페인 방문을 이 글에 소급 배정하지 않습니다.' },
    { id: 5266, date: '2026-09-18', title: '[항공권] 장가계 13.5만 / 옌타이 15만 / 광저우 19.9만 / 상하이 17만', campaign: 'tikitikit_te31_china-260918', link: '/c/te31-china-260918', views: 65, comments: 0, recommendations: 1, observedAt: '2026-09-21T19:09:00+09:00', recommendationsObservedAt: '2026-09-21T19:09:00+09:00', commentNote: '공개 원문과 게시 링크 확인 완료.' },
    { id: 5248, date: '2026-09-14', title: '[항공권] 호치민·하노이 왕복 21만원 (인천)', campaign: 'tikitikit_te31_vietnam-260914', link: '/c/te31-vietnam-260914', views: null, comments: null, recommendations: null, observedAt: '', recommendationsObservedAt: null, commentNote: '글 주소 확인 완료. 조회·댓글 수는 아직 확인하지 않았습니다.' },
    { id: 5235, date: '2026-09-09', title: '[항공권] 인천 출발 나트랑 17만 / 삿포로 26.9만 / 하노이 21만', campaign: 'tikitikit_te31_icn-260909', link: '/c/te31-icn-260909', views: 114, comments: 1, recommendations: 1, observedAt: '2026-09-11T13:48:00+09:00', recommendationsObservedAt: '2026-09-10T19:17:00+09:00', commentNote: '댓글 1개는 작성자의 나트랑 매진 안내입니다. 독자 반응으로 세지 않습니다.' },
    { id: 5232, date: '2026-09-08', title: '부산 출발 땡처리 항공권 5곳 · 티키티킷', campaign: 'tikitikit_te31_pus-260908', link: '/c/te31-pus-260908', views: 133, comments: 0, recommendations: 0, observedAt: '2026-09-11T13:48:00+09:00', recommendationsObservedAt: '2026-09-08T19:40:00+09:00', commentNote: null },
    { id: 5211, date: '2026-09-01', title: '인천-푸꾸옥 왕복 143,800원 (9월) · 티키티킷', campaign: 'tikitikit_te31_pqc1438', link: '/c/te31-pqc1438', views: 179, comments: 5, recommendations: 0, observedAt: '2026-09-11T13:48:00+09:00', recommendationsObservedAt: '2026-09-08T19:40:00+09:00', commentNote: null },
    { id: 5196, date: '2026-08-28', title: '부산-장가계 왕복 199,000원 (+발권수수료 20,000원)', campaign: null, link: null, views: 146, comments: 0, recommendations: null, observedAt: '2026-09-08T19:40:00+09:00', recommendationsObservedAt: null, commentNote: null },
    { id: 5178, date: '2026-08-21', title: '일본 왕복 15~17만원대 (인천·부산 출발)', campaign: null, link: null, views: 219, comments: 2, recommendations: null, observedAt: '2026-09-08T19:40:00+09:00', recommendationsObservedAt: null, commentNote: null },
    { id: 5170, date: '2026-08-20', title: '인천-푸꾸옥 왕복 149,000원 | 8/30~9/2 · 티키티킷', campaign: null, link: null, views: 172, comments: 1, recommendations: null, observedAt: '2026-09-08T19:40:00+09:00', recommendationsObservedAt: null, commentNote: null },
] as const;

export const TE31_OBSERVED_AT = TE31_POSTS.reduce((latest, post) => post.observedAt > latest ? post.observedAt : latest, '' as string);

export function matchTe31Campaign(campaign: string | null, rows: readonly Te31Campaign[] | null | undefined): Te31Campaign | null {
    if (!campaign || !rows) return null;
    // Never attribute another channel's use of the same campaign to this post.
    return rows.find(row => row.source.toLowerCase() === 'te31' && row.name === campaign) || null;
}

export function unmatchedTe31Campaigns(rows: readonly Te31Campaign[] | null | undefined) {
    return (rows || []).filter(row => row.source.toLowerCase() === 'te31' && !TE31_POSTS.some(post => post.campaign === row.name));
}
