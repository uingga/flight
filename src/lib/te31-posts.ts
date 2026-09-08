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
    { id: 5232, date: '2026-09-08', title: '부산 출발 땡처리 항공권 5곳 · 티키티킷', campaign: 'tikitikit_te31_pus-260908', link: '/c/te31-pus-260908', views: 14, comments: 0, recommendations: 0 },
    { id: 5211, date: '2026-09-01', title: '인천-푸꾸옥 왕복 143,800원 (9월) · 티키티킷', campaign: 'tikitikit_te31_pqc1438', link: '/c/te31-pqc1438', views: 163, comments: 5, recommendations: 0 },
    { id: 5196, date: '2026-08-28', title: '부산-장가계 왕복 199,000원 (+발권수수료 20,000원)', campaign: null, link: null, views: 146, comments: 0, recommendations: null },
    { id: 5178, date: '2026-08-21', title: '일본 왕복 15~17만원대 (인천·부산 출발)', campaign: null, link: null, views: 219, comments: 2, recommendations: null },
    { id: 5170, date: '2026-08-20', title: '인천-푸꾸옥 왕복 149,000원 | 8/30~9/2 · 티키티킷', campaign: null, link: null, views: 172, comments: 1, recommendations: null },
] as const;

export const TE31_OBSERVED_AT = '2026-09-08T19:40:00+09:00';

export function matchTe31Campaign(campaign: string | null, rows: readonly Te31Campaign[] | null | undefined): Te31Campaign | null {
    if (!campaign || !rows) return null;
    // Never attribute another channel's use of the same campaign to this post.
    return rows.find(row => row.source.toLowerCase() === 'te31' && row.name === campaign) || null;
}

export function unmatchedTe31Campaigns(rows: readonly Te31Campaign[] | null | undefined) {
    return (rows || []).filter(row => row.source.toLowerCase() === 'te31' && !TE31_POSTS.some(post => post.campaign === row.name));
}
