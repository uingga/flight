'use client';

import { useState, useEffect } from 'react';
import styles from './admin.module.css';
import { isAnalyticsExcluded, setAnalyticsExcluded } from '@/lib/analytics';

interface CrawlHistoryEntry {
    timestamp: string;
    sites: Record<string, { total: number }>;
    alerts: string[];
}

interface AdminData {
    timestamp: string;
    totalFlights: number;
    bySource: Record<string, number>;
    byRegion: Record<string, number>;
    byCity: Record<string, number>;
    byAirline: Record<string, number>;
    byDepartureCity: Record<string, number>;
    avgPriceBySource: Record<string, number>;
    priceByRegion: Record<string, { min: number; max: number; avg: number; count: number }>;
    cheapest: { route: string; airline: string; price: number; date: string; source: string }[];
    crawlHistory?: CrawlHistoryEntry[];
    naverStatus?: {
        lastCrawledAt: string | null;
        ageDays: number | null;
        freshEntries: number;
        totalEntries: number;
    } | null;
}

interface DealAlertCandidate {
    flightId: string;
    departureCity: string;
    arrivalCity: string;
    departureDate: string;
    returnDate: string;
    airline: string;
    source: string;
    price: number;
    effectivePrice: number;
    feeNote?: string;
    score: number;
    reasons: string[];
}

interface DealAlertReviewData {
    available: boolean;
    dryRun: boolean;
    message?: string;
    generatedAt: string;
    scoreThreshold: number;
    subscriptions: number;
    qualifiedCandidates: number;
    reviews: Array<{
        condition: {
            id: string;
            departureCity: string;
            region: string;
            maxPrice: number;
        };
        matchingFlights: number;
        qualifiedCount: number;
        candidates: DealAlertCandidate[];
        rejectionCounts: Record<string, number>;
    }>;
}

interface UserStatsData {
    available: boolean;
    message?: string;
    generatedAt: string;
    summary: {
        subscribers: number;
        everSubscribed: number;
        activeAlerts: number;
        cancelledAlerts: number;
        alertsPerSubscriber: number;
        routeAlerts: number;
        dealAlerts: number;
        notified: number;
        neverNotified: number;
        reachableNow: number;
    };
    topRoutes: Array<{
        route: string;
        count: number;
        devices: number;
        avgTarget: number | null;
        currentLowest: number | null;
        reachable: boolean | null;
        gap: number | null;
    }>;
    topRegions: Array<{ label: string; count: number; devices: number; avgTarget: number | null }>;
    trend: Array<{ date: string; count: number }>;
}

interface GaListItem {
    label: string;
    count: number;
}

interface GaStatsData {
    available: boolean;
    message?: string;
    generatedAt: string;
    days: number;
    totals: { users: number; pageViews: number; sessions: number };
    periods: {
        today: { users: number; pageViews: number; sessions: number };
        recent7: { users: number; pageViews: number; sessions: number };
        previous7: { users: number; pageViews: number; sessions: number };
        current: { users: number; pageViews: number; sessions: number };
        previous: { users: number; pageViews: number; sessions: number };
    };
    returning: {
        current: { newUsers: number; returningUsers: number; rate: number | null };
        previous: { newUsers: number; returningUsers: number; rate: number | null };
    };
    monitoring: {
        recent7Share: number | null;
        sessionsPerUser: number | null;
        behaviorAvailable: boolean;
        newUsers: {
            users: number;
            detailOpen: number;
            bookingClick: number;
            share: number;
            alertSetup: number;
            detailOpenRate: number | null;
            bookingClickRate: number | null;
            shareRate: number | null;
        };
        returningUsers: GaStatsData['monitoring']['newUsers'];
    };
    trend: Array<{ date: string; users: number; pageViews: number; sessions: number }>;
    events: Array<{ name: string; label: string; count: number; users: number }>;
    otherEvents: Array<{ name: string; label: string; count: number; users: number }>;
    conversion: {
        detailOpenUsers: number;
        detailOpenRate: number | null;
        bookingClickUsers: number;
        bookingClickRate: number | null;
        detailToBookingRate: number | null;
        alertSetupUsers: number;
        alertSetupRate: number | null;
    };
    bookingByAgency: GaListItem[] | null;
    bookingByRoute: GaListItem[] | null;
    alertByEntry: GaListItem[] | null;
    detailByEntry: GaListItem[] | null;
    channels: Array<{ label: string; sessions: number; users: number }> | null;
    campaigns: Array<{
        name: string;
        source: string;
        label: string;
        sessions: number;
        users: number;
        bookingClicks: number | null;
    }> | null;
    dateFilter: {
        picks: number;
        emptyPicks: number;
        emptyRate: number | null;
        leadTime: GaListItem[] | null;
        range: GaListItem[] | null;
        method: GaListItem[] | null;
        presets: GaListItem[] | null;
    };
    warnings: string[];
}

const SOURCE_NAMES: Record<string, string> = {
    hanatour: '하나투어',
    modetour: '모두투어',
    ttang: '땡처리닷컴',
    ybtour: '노랑풍선',
    onlinetour: '온라인투어',
    myrealtrip: '마이리얼트립',
};

const SOURCE_COLORS: Record<string, string> = {
    hanatour: '#7c3aed',
    modetour: '#059669',
    ttang: '#dc2626',
    ybtour: '#d97706',
    onlinetour: '#1e40af',
};

const DEAL_REJECTION_LABELS: Record<string, string> = {
    otherDeparture: '출발지가 다름',
    otherRegion: '지역이 다름',
    overBudget: '예산보다 비쌈',
    expired: '출발일이 지남',
    stale: '가격이 3일 넘게 미확인',
    lowScore: '특가라기엔 점수 부족',
};

function formatKST(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}분 전`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}시간 전`;
    return `${Math.floor(hrs / 24)}일 전`;
}

function formatPrice(price: number): string {
    if (price >= 10000) {
        const man = Math.floor(price / 10000);
        const remainder = price % 10000;
        return remainder > 0 ? `${man}만 ${remainder.toLocaleString()}원` : `${man}만원`;
    }
    return `${price.toLocaleString()}원`;
}

export default function AdminPage() {
    const [data, setData] = useState<AdminData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [key, setKey] = useState('');
    const [authed, setAuthed] = useState(false);
    const [analyticsExcluded, setAnalyticsExcludedState] = useState(false);
    const [dealAlertReview, setDealAlertReview] = useState<DealAlertReviewData | null>(null);
    const [dealAlertReviewError, setDealAlertReviewError] = useState<string | null>(null);
    const [userStats, setUserStats] = useState<UserStatsData | null>(null);
    const [userStatsError, setUserStatsError] = useState<string | null>(null);
    const [gaStats, setGaStats] = useState<GaStatsData | null>(null);
    const [gaStatsError, setGaStatsError] = useState<string | null>(null);

    useEffect(() => {
        setAnalyticsExcludedState(isAnalyticsExcluded());
        const params = new URLSearchParams(window.location.search);
        const urlKey = params.get('key');
        if (urlKey) {
            setKey(urlKey);
            setAuthed(true);
            fetchData(urlKey);
        } else {
            setLoading(false);
        }
    }, []);

    async function fetchData(authKey: string) {
        setLoading(true);
        try {
            const crawlRes = await fetch(`/api/crawl-log?key=${encodeURIComponent(authKey)}`);
            if (crawlRes.status === 401) {
                setError('인증 실패: 올바른 키를 입력해주세요.');
                setAuthed(false);
                setLoading(false);
                return;
            }
            const json = await crawlRes.json();
            if (json.error) {
                setError(json.error);
                setLoading(false);
                return;
            }
            setData(json);

            try {
                const dealResponse = await fetch(`/api/deal-alert-candidates?key=${encodeURIComponent(authKey)}`);
                const dealJson = await dealResponse.json();
                if (dealResponse.ok) {
                    setDealAlertReview(dealJson);
                    setDealAlertReviewError(null);
                } else {
                    setDealAlertReviewError(dealJson.error || '조건형 특가 후보를 불러오지 못했습니다.');
                }
            } catch {
                setDealAlertReviewError('조건형 특가 후보를 불러오지 못했습니다.');
            }

            try {
                const statsResponse = await fetch(`/api/user-stats?key=${encodeURIComponent(authKey)}`);
                const statsJson = await statsResponse.json();
                if (statsResponse.ok) {
                    setUserStats(statsJson);
                    setUserStatsError(null);
                } else {
                    setUserStatsError(statsJson.error || '유저 통계를 불러오지 못했습니다.');
                }
            } catch {
                setUserStatsError('유저 통계를 불러오지 못했습니다.');
            }

            try {
                const gaResponse = await fetch(`/api/ga-stats?key=${encodeURIComponent(authKey)}`);
                const gaJson = await gaResponse.json();
                if (gaResponse.ok) {
                    setGaStats(gaJson);
                    setGaStatsError(null);
                } else {
                    setGaStatsError(gaJson.error || '방문 통계를 불러오지 못했습니다.');
                }
            } catch {
                setGaStatsError('방문 통계를 불러오지 못했습니다.');
            }

            setAuthed(true);
            setError(null);
            setAnalyticsExcluded(true);
            setAnalyticsExcludedState(true);

        } catch {
            setError('데이터를 불러오는데 실패했습니다.');
        }
        setLoading(false);
    }

    function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        fetchData(key);
    }

    if (!authed && !loading) {
        return (
            <div className={styles.loginContainer}>
                <div className={styles.loginCard}>
                    <h1>🔒 크롤링 모니터</h1>
                    <p>관리자 키를 입력하세요</p>
                    <form onSubmit={handleLogin}>
                        <input
                            type="password"
                            value={key}
                            onChange={e => setKey(e.target.value)}
                            placeholder="Admin Key"
                            className={styles.loginInput}
                            autoFocus
                        />
                        <button type="submit" className={styles.loginBtn}>접속</button>
                    </form>
                    {error && <p className={styles.errorText}>{error}</p>}
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className={styles.loginContainer}>
                <div className={styles.spinner}></div>
                <p>로딩 중...</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className={styles.container}>
                <h1>크롤링 모니터</h1>
                <p>{error || '데이터를 불러올 수 없습니다.'}</p>
            </div>
        );
    }

    const allSources = Object.keys(data.bySource);
    const sortedRegions = Object.entries(data.byRegion).sort((a, b) => b[1] - a[1]);
    const sortedCities = Object.entries(data.byCity).sort((a, b) => b[1] - a[1]);
    const sortedAirlines = Object.entries(data.byAirline).sort((a, b) => b[1] - a[1]);
    const sortedDepCities = Object.entries(data.byDepartureCity).sort((a, b) => b[1] - a[1]);
    const maxSourceCount = Math.max(...Object.values(data.bySource), 1);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1>📊 크롤링 모니터</h1>
                <span className={styles.lastUpdated}>
                    마지막 업데이트: {formatKST(data.timestamp)} ({timeAgo(data.timestamp)})
                </span>
            </header>

            {/* 네이버 비교가 상태 — 로컬 크롤이 멈추면 추천 품질이 조용히 나빠지므로 눈에 띄게 둔다 */}
            {data.naverStatus && (() => {
                const { lastCrawledAt, ageDays, freshEntries, totalEntries } = data.naverStatus;
                const stale = ageDays === null || ageDays > 3;
                return (
                    <div className={stale ? `${styles.naverStatus} ${styles.naverStatusStale}` : styles.naverStatus}>
                        <strong>네이버 비교가</strong>
                        {lastCrawledAt ? (
                            <span>
                                마지막 갱신 {formatKST(lastCrawledAt)} ({timeAgo(lastCrawledAt)}) ·
                                {' '}유효 {freshEntries.toLocaleString()}건 / 전체 {totalEntries.toLocaleString()}건
                            </span>
                        ) : (
                            <span>갱신 기록이 없습니다.</span>
                        )}
                        {stale && <em>3일이 지나 비교가가 추천에서 제외됩니다. 크롤이 도는지 확인해주세요.</em>}
                    </div>
                );
            })()}

            {/* 요약 카드 */}
            <div className={styles.summaryCards}>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>전체 항공편</span>
                    <span className={styles.summaryValue}>{data.totalFlights.toLocaleString()}</span>
                </div>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>여행사</span>
                    <span className={styles.summaryValue}>{allSources.length}</span>
                </div>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>지역</span>
                    <span className={styles.summaryValue}>{sortedRegions.length}</span>
                </div>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>도시</span>
                    <span className={styles.summaryValue}>{sortedCities.length}</span>
                </div>
            </div>

            {/* GA4 방문·행동 통계 — 여기서 보이면 GA4 사이트로 나갈 일이 줄어든다 */}
            <section className={styles.section}>
                <h2>🌐 방문자와 행동 (GA4)</h2>
                <p className={styles.sectionHelp}>
                    아래 수치는 모두 최근 {gaStats?.days ?? 30}일 기준입니다. 방문자는 같은 사람이 여러 번 와도 1명,
                    방문 횟수는 사이트에 들어온 횟수, 페이지 열림은 실제 페이지가 열린 횟수입니다.
                    항공권 상세 팝업은 페이지 열림이 아니라 <strong>상세 열람</strong>으로 따로 집계합니다.
                    GA4는 데이터가 하루 정도 늦게 채워질 수 있습니다.
                </p>
                {gaStatsError ? (
                    <div className={styles.dealReviewEmpty}>{gaStatsError}</div>
                ) : !gaStats?.available ? (
                    <div className={styles.dealReviewEmpty}>
                        {gaStats?.message || '방문 통계를 불러오는 중입니다.'}
                    </div>
                ) : (
                    <>
                        <div className={styles.userStatGrid}>
                            <div className={styles.userStat}>
                                <span>최근 {gaStats.days}일 방문자</span>
                                <strong>{gaStats.totals.users.toLocaleString()}</strong>
                                <small>
                                    {gaStats.periods.current.users - gaStats.periods.previous.users >= 0 ? '+' : ''}
                                    {(gaStats.periods.current.users - gaStats.periods.previous.users).toLocaleString()}명 · 이전 {gaStats.days}일 대비
                                </small>
                            </div>
                            <div className={styles.userStat}>
                                <span>최근 7일 방문자</span>
                                <strong>{gaStats.periods.recent7.users.toLocaleString()}</strong>
                                <small>
                                    {gaStats.periods.recent7.users - gaStats.periods.previous7.users >= 0 ? '+' : ''}
                                    {(gaStats.periods.recent7.users - gaStats.periods.previous7.users).toLocaleString()}명 · 이전 7일 대비
                                </small>
                            </div>
                            <div className={styles.userStat}>
                                <span>오늘 방문자</span>
                                <strong>{gaStats.periods.today.users.toLocaleString()}</strong>
                                <small>오늘 데이터는 늦게 반영될 수 있음</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>{gaStats.days}일 재방문율</span>
                                <strong>{gaStats.returning.current.rate !== null ? `${gaStats.returning.current.rate}%` : '-'}</strong>
                                <small>
                                    재방문 {gaStats.returning.current.returningUsers.toLocaleString()}명
                                    {gaStats.returning.current.rate !== null && gaStats.returning.previous.rate !== null
                                        ? ` · 이전보다 ${(gaStats.returning.current.rate - gaStats.returning.previous.rate) >= 0 ? '+' : ''}${(gaStats.returning.current.rate - gaStats.returning.previous.rate).toFixed(1)}%p`
                                        : ''}
                                </small>
                            </div>
                            <div className={styles.userStat}>
                                <span>최근 {gaStats.days}일 방문 횟수</span>
                                <strong>{gaStats.totals.sessions.toLocaleString()}</strong>
                                <small>페이지가 열린 횟수 {gaStats.totals.pageViews.toLocaleString()}회</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>최근 활동 비중</span>
                                <strong>{gaStats.monitoring.recent7Share !== null ? `${gaStats.monitoring.recent7Share}%` : '-'}</strong>
                                <small>{gaStats.days}일 방문자 중 최근 7일에도 방문</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>사용자당 방문 횟수</span>
                                <strong>{gaStats.monitoring.sessionsPerUser !== null ? `${gaStats.monitoring.sessionsPerUser}회` : '-'}</strong>
                                <small>최근 {gaStats.days}일 평균</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>상세 열람한 사람</span>
                                <strong>{gaStats.conversion.detailOpenUsers.toLocaleString()}</strong>
                                <small>
                                    {gaStats.conversion.detailOpenUsers === 0
                                        ? '8/14부터 집계 시작'
                                        : gaStats.conversion.detailOpenRate !== null
                                            ? `방문자의 ${gaStats.conversion.detailOpenRate}%`
                                            : '비율 계산 불가'}
                                </small>
                            </div>
                            <div className={styles.userStat}>
                                <span>예약 클릭한 사람</span>
                                <strong>{gaStats.conversion.bookingClickUsers.toLocaleString()}</strong>
                                <small>
                                    {gaStats.conversion.bookingClickRate !== null
                                        ? `방문자의 ${gaStats.conversion.bookingClickRate}%`
                                        : '비율 계산 불가'}
                                </small>
                            </div>
                            <div className={styles.userStat}>
                                <span>알림 등록한 사람</span>
                                <strong>{gaStats.conversion.alertSetupUsers.toLocaleString()}</strong>
                                <small>
                                    {gaStats.conversion.alertSetupRate !== null
                                        ? `방문자의 ${gaStats.conversion.alertSetupRate}%`
                                        : '비율 계산 불가'}
                                </small>
                            </div>
                        </div>

                        <h3 className={styles.userSubTitle}>최근 {gaStats.days}일 일별 방문자 추이</h3>
                        {(() => {
                            const max = Math.max(...gaStats.trend.map(point => point.users), 1);
                            return (
                                <div className={styles.trendChart}>
                                    {gaStats.trend.map(point => (
                                        <div
                                            key={point.date}
                                            className={styles.trendCol}
                                            title={`${point.date} · 방문자 ${point.users}명 · 페이지 열림 ${point.pageViews}회`}
                                        >
                                            <div
                                                className={styles.trendBar}
                                                style={{ height: `${Math.max(2, (point.users / max) * 100)}%` }}
                                            />
                                            <span className={styles.trendCount}>{point.users || ''}</span>
                                            <span className={styles.trendDate}>{point.date.slice(5).replace('-', '/')}</span>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

                        <h3 className={styles.userSubTitle}>신규 방문자와 재방문자의 행동</h3>
                        {gaStats.monitoring.behaviorAvailable ? (
                            <div className={styles.cityDetail}>
                                <table className={styles.cityTable}>
                                    <thead>
                                        <tr><th>구분</th><th>사용자</th><th>상세 열람</th><th>예약 클릭</th><th>공유</th></tr>
                                    </thead>
                                    <tbody>
                                        {([
                                            ['신규 방문자', gaStats.monitoring.newUsers],
                                            ['재방문자', gaStats.monitoring.returningUsers],
                                        ] as const).map(([label, item]) => (
                                            <tr key={label}>
                                                <td>{label}</td>
                                                <td>{item.users.toLocaleString()}명</td>
                                                <td>{item.detailOpen.toLocaleString()}명{item.detailOpenRate !== null ? ` (${item.detailOpenRate}%)` : ''}</td>
                                                <td>{item.bookingClick.toLocaleString()}명{item.bookingClickRate !== null ? ` (${item.bookingClickRate}%)` : ''}</td>
                                                <td>{item.share.toLocaleString()}명{item.shareRate !== null ? ` (${item.shareRate}%)` : ''}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className={styles.dealReviewEmpty}>신규·재방문 행동 비교를 아직 불러오지 못했습니다.</div>
                        )}

                        <h3 className={styles.userSubTitle}>최근 {gaStats.days}일 주요 행동</h3>
                        <div className={styles.cityDetail}>
                            <table className={styles.cityTable}>
                                <thead>
                                    <tr><th>행동</th><th>횟수</th><th>사람</th><th>방문자 대비</th></tr>
                                </thead>
                                <tbody>
                                    {gaStats.events.length === 0 ? (
                                        <tr><td colSpan={4}>아직 집계된 행동이 없습니다.</td></tr>
                                    ) : gaStats.events.map(entry => (
                                        <tr key={entry.name}>
                                            <td><strong>{entry.label}</strong></td>
                                            <td>{entry.count.toLocaleString()}회</td>
                                            <td>{entry.users.toLocaleString()}명</td>
                                            <td>
                                                {gaStats.totals.users > 0
                                                    ? `${Math.round((entry.users / gaStats.totals.users) * 100)}%`
                                                    : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className={styles.gaColumns}>
                            <div>
                                <h3 className={styles.userSubTitle}>여행사별 예약 클릭</h3>
                                {gaStats.bookingByAgency === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.bookingByAgency.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>아직 예약 클릭이 없습니다.</div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>여행사</th><th>클릭</th></tr></thead>
                                            <tbody>
                                                {gaStats.bookingByAgency.map(item => (
                                                    <tr key={item.label}>
                                                        <td>{SOURCE_NAMES[item.label] || item.label}</td>
                                                        <td>{item.count.toLocaleString()}회</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className={styles.userSubTitle}>최근 {gaStats.days}일 유입 경로</h3>
                                {gaStats.channels === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.channels.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>집계된 유입이 없습니다.</div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>경로</th><th>방문</th><th>사람</th></tr></thead>
                                            <tbody>
                                                {gaStats.channels.map(item => (
                                                    <tr key={item.label}>
                                                        <td>{item.label}</td>
                                                        <td>{item.sessions.toLocaleString()}회</td>
                                                        <td>{item.users.toLocaleString()}명</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className={styles.userSubTitle}>콘텐츠별 유입과 예약 클릭</h3>
                                {gaStats.campaigns === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.campaigns.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>추적 링크로 들어온 방문이 아직 없습니다.</div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>콘텐츠</th><th>방문</th><th>사람</th><th>예약 클릭</th></tr></thead>
                                            <tbody>
                                                {gaStats.campaigns.map(item => (
                                                    <tr key={`${item.name}-${item.source}`}>
                                                        <td>{item.label}</td>
                                                        <td>{item.sessions.toLocaleString()}회</td>
                                                        <td>{item.users.toLocaleString()}명</td>
                                                        <td>{item.bookingClicks === null ? '확인 불가' : `${item.bookingClicks.toLocaleString()}회`}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className={styles.userSubTitle}>예약 클릭이 많은 노선</h3>
                                {gaStats.bookingByRoute === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.bookingByRoute.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>아직 예약 클릭이 없습니다.</div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>노선</th><th>클릭</th></tr></thead>
                                            <tbody>
                                                {gaStats.bookingByRoute.map(item => (
                                                    <tr key={item.label}>
                                                        <td>{item.label}</td>
                                                        <td>{item.count.toLocaleString()}회</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className={styles.userSubTitle}>항공권 상세를 연 위치</h3>
                                {gaStats.detailByEntry === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.detailByEntry.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>
                                        아직 집계 전입니다. <code>detail_open</code>은 2026-08-14부터 수집합니다.
                                    </div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>진입점</th><th>열람</th></tr></thead>
                                            <tbody>
                                                {gaStats.detailByEntry.map(item => (
                                                    <tr key={item.label}>
                                                        <td>{item.label}</td>
                                                        <td>{item.count.toLocaleString()}회</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h3 className={styles.userSubTitle}>알림 등록이 시작된 위치</h3>
                                {gaStats.alertByEntry === null ? (
                                    <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                ) : gaStats.alertByEntry.length === 0 ? (
                                    <div className={styles.dealReviewEmpty}>
                                        아직 집계 전입니다. <code>entry_point</code> 측정기준은 등록 이후 데이터부터 쌓입니다.
                                    </div>
                                ) : (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead><tr><th>진입점</th><th>등록</th></tr></thead>
                                            <tbody>
                                                {gaStats.alertByEntry.map(item => (
                                                    <tr key={item.label}>
                                                        <td>{item.label}</td>
                                                        <td>{item.count.toLocaleString()}회</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 날짜 필터는 방문자가 가장 많이 쓰는 조작이라 따로 떼어 본다 */}
                        <h3 className={styles.userSubTitle} style={{ marginTop: '24px' }}>
                            날짜 필터 — 사람들이 언제 떠나려 하나
                        </h3>
                        <p className={styles.sectionHelp}>
                            날짜를 고른 {gaStats.dateFilter.picks.toLocaleString()}회 중{' '}
                            {gaStats.dateFilter.emptyPicks.toLocaleString()}회는 표가 하나도 없었습니다
                            {gaStats.dateFilter.emptyRate !== null && ` (${gaStats.dateFilter.emptyRate}%)`}.
                            아래 표는 2026-08-19에 측정기준을 등록해 그 이후 데이터만 쌓입니다.
                        </p>
                        <div className={styles.userGrid}>
                            {([
                                { title: '출발까지 남은 기간', data: gaStats.dateFilter.leadTime, head: '기간' },
                                { title: '고른 기간 길이', data: gaStats.dateFilter.range, head: '길이' },
                                { title: '날짜를 고른 방식', data: gaStats.dateFilter.method, head: '방식' },
                                { title: '누른 빠른 선택 칩', data: gaStats.dateFilter.presets, head: '칩' },
                            ] as const).map(section => (
                                <div key={section.title}>
                                    <h3 className={styles.userSubTitle}>{section.title}</h3>
                                    {section.data === null ? (
                                        <div className={styles.dealReviewEmpty}>불러오지 못했습니다.</div>
                                    ) : section.data.length === 0 ? (
                                        <div className={styles.dealReviewEmpty}>아직 집계된 데이터가 없습니다.</div>
                                    ) : (
                                        <div className={styles.cityDetail}>
                                            <table className={styles.cityTable}>
                                                <thead><tr><th>{section.head}</th><th>선택</th></tr></thead>
                                                <tbody>
                                                    {section.data.map(item => (
                                                        <tr key={item.label}>
                                                            <td>{item.label}</td>
                                                            <td>{item.count.toLocaleString()}회</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {gaStats.otherEvents.length > 0 && (
                            <p className={styles.sectionHelp} style={{ marginTop: '16px' }}>
                                그 밖의 이벤트: {gaStats.otherEvents.map(entry => `${entry.name} ${entry.count.toLocaleString()}회`).join(' · ')}
                            </p>
                        )}

                        {gaStats.warnings.length > 0 && (
                            <div className={styles.dealReviewEmpty} style={{ marginTop: '16px' }}>
                                {gaStats.warnings.map(warning => <div key={warning}>⚠️ {warning}</div>)}
                            </div>
                        )}
                    </>
                )}
            </section>

            {/* 유저 통계 — 크롤링 현황과 별개로 "사람들이 무엇을 기다리는가"를 본다 */}
            <section className={styles.section}>
                <h2>👥 사용자 현황 — 가격 알림</h2>
                <p className={styles.sectionHelp}>
                    회원가입이 없는 서비스라 사람 수 대신 <strong>알림을 켠 브라우저(기기) 수</strong>를 셉니다.
                    같은 사람이 폰과 PC에서 각각 켜면 2로 잡힙니다.
                </p>
                {userStatsError ? (
                    <div className={styles.dealReviewEmpty}>{userStatsError}</div>
                ) : !userStats?.available ? (
                    <div className={styles.dealReviewEmpty}>
                        {userStats?.message || '유저 통계를 불러오는 중입니다.'}
                    </div>
                ) : (
                    <>
                        <div className={styles.userStatGrid}>
                            <div className={styles.userStat}>
                                <span>알림 켠 기기</span>
                                <strong>{userStats.summary.subscribers.toLocaleString()}</strong>
                                <small>지금까지 총 {userStats.summary.everSubscribed.toLocaleString()}대 (끈 기기 포함)</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>걸려 있는 알림</span>
                                <strong>{userStats.summary.activeAlerts.toLocaleString()}</strong>
                                <small>기기당 평균 {userStats.summary.alertsPerSubscriber}개</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>푸시를 받아본 알림</span>
                                <strong>{userStats.summary.notified.toLocaleString()}</strong>
                                <small>
                                    아직 한 번도 못 받은 알림 {userStats.summary.neverNotified.toLocaleString()}개
                                </small>
                            </div>
                            <div className={styles.userStat}>
                                <span>지금 보낼 수 있는 알림</span>
                                <strong>{userStats.summary.reachableNow.toLocaleString()}</strong>
                                <small>목표가 이하 항공권이 현재 있음</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>알림 종류</span>
                                <strong>{userStats.summary.routeAlerts.toLocaleString()} : {userStats.summary.dealAlerts.toLocaleString()}</strong>
                                <small>노선 지정 : 조건만 지정(베타)</small>
                            </div>
                            <div className={styles.userStat}>
                                <span>끈 알림</span>
                                <strong>{userStats.summary.cancelledAlerts.toLocaleString()}</strong>
                                <small>
                                    전체의 {userStats.summary.activeAlerts + userStats.summary.cancelledAlerts > 0
                                        ? `${Math.round(userStats.summary.cancelledAlerts / (userStats.summary.activeAlerts + userStats.summary.cancelledAlerts) * 100)}%`
                                        : '0%'}
                                </small>
                            </div>
                        </div>

                        {/* 최근 14일 신규 등록 */}
                        <h3 className={styles.userSubTitle}>최근 14일 신규 등록</h3>
                        {(() => {
                            const max = Math.max(...userStats.trend.map(t => t.count), 1);
                            return (
                                <div className={styles.trendChart}>
                                    {userStats.trend.map(point => (
                                        <div key={point.date} className={styles.trendCol} title={`${point.date} · ${point.count}건`}>
                                            <div
                                                className={styles.trendBar}
                                                style={{ height: `${Math.max(2, (point.count / max) * 100)}%` }}
                                            />
                                            <span className={styles.trendCount}>{point.count || ''}</span>
                                            <span className={styles.trendDate}>{point.date.slice(5).replace('-', '/')}</span>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

                        {/* 사용자가 기다리는 노선 — 크롤링 확대 우선순위와 직결 */}
                        <h3 className={styles.userSubTitle}>사용자가 기다리는 노선</h3>
                        {userStats.topRoutes.length === 0 ? (
                            <div className={styles.dealReviewEmpty}>등록된 노선 알림이 없습니다.</div>
                        ) : (
                            <div className={styles.cityDetail} style={{ overflowX: 'auto' }}>
                                <table className={styles.cityTable} style={{ minWidth: '560px' }}>
                                    <thead>
                                        <tr>
                                            <th>노선</th><th>알림</th><th>기기</th>
                                            <th>평균 목표가</th><th>현재 최저가</th><th>상태</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {userStats.topRoutes.map(route => (
                                            <tr key={route.route}>
                                                <td><strong>{route.route}</strong></td>
                                                <td>{route.count}건</td>
                                                <td>{route.devices}대</td>
                                                <td>{route.avgTarget !== null ? formatPrice(route.avgTarget) : '—'}</td>
                                                <td>{route.currentLowest !== null ? formatPrice(route.currentLowest) : '항공권 없음'}</td>
                                                <td>
                                                    {route.reachable === null ? (
                                                        <span className={styles.tagMuted}>비교 불가</span>
                                                    ) : route.reachable ? (
                                                        <span className={styles.tagGood}>목표가 도달</span>
                                                    ) : (
                                                        <span className={styles.tagWarn}>
                                                            {formatPrice(route.gap!)} 더 내려야
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {userStats.topRegions.length > 0 && (
                            <>
                                <h3 className={styles.userSubTitle}>조건만 걸어둔 알림 (베타)</h3>
                                <div className={styles.cityDetail}>
                                    <table className={styles.cityTable}>
                                        <thead>
                                            <tr><th>조건</th><th>알림</th><th>기기</th><th>평균 목표가</th></tr>
                                        </thead>
                                        <tbody>
                                            {userStats.topRegions.map(region => (
                                                <tr key={region.label}>
                                                    <td>{region.label}</td>
                                                    <td>{region.count}건</td>
                                                    <td>{region.devices}대</td>
                                                    <td>{region.avgTarget !== null ? formatPrice(region.avgTarget) : '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </>
                )}
            </section>

            <section className={styles.section}>
                <div className={styles.dealReviewHeader}>
                    <div>
                        <h2>🔔 조건형 특가 알림 — 발송 미리보기</h2>
                        <p>
                            사용자가 &ldquo;인천 출발, 일본, 20만원 이하면 알려줘&rdquo;처럼 <strong>조건만 걸어둔 알림</strong>입니다.
                            아직 테스트 단계라 실제 푸시는 나가지 않고, 지금 항공권을 조건에 대입해
                            &ldquo;오늘 보냈다면 어떤 특가가 나갔을지&rdquo;를 미리 보여줍니다.
                        </p>
                    </div>
                    <span className={styles.dryRunBadge}>테스트 중 · 발송 안 함</span>
                </div>

                {dealAlertReviewError ? (
                    <div className={styles.dealReviewEmpty}>{dealAlertReviewError}</div>
                ) : !dealAlertReview?.available ? (
                    <div className={styles.dealReviewEmpty}>
                        {dealAlertReview?.message || '조건형 알림 정보를 불러오는 중입니다.'}
                    </div>
                ) : (
                    <>
                        <div className={styles.dealReviewSummary}>
                            <div><span>걸려 있는 조건</span><strong>{dealAlertReview.subscriptions}개</strong></div>
                            <div><span>특가 판정선</span><strong>100점 만점에 {dealAlertReview.scoreThreshold}점</strong></div>
                            <div><span>오늘 보낼 만한 특가</span><strong>{dealAlertReview.qualifiedCandidates}개</strong></div>
                            <div><span>계산 시각</span><strong>{formatKST(dealAlertReview.generatedAt).replace(/\d{4}\. /, '')}</strong></div>
                        </div>

                        {dealAlertReview.reviews.length === 0 ? (
                            <div className={styles.dealReviewEmpty}>
                                아직 등록된 조건형 특가 알림이 없습니다. 사이트에서 베타 조건을 등록하면 이곳에 후보가 나타납니다.
                            </div>
                        ) : (
                            <div className={styles.dealReviewList}>
                                {dealAlertReview.reviews.map(review => (
                                    <article key={review.condition.id} className={styles.dealReviewCard}>
                                        <div className={styles.dealReviewCondition}>
                                            <div>
                                                <strong>
                                                    {review.condition.departureCity} 출발 · {review.condition.region === 'all' ? '아무데나' : review.condition.region}
                                                </strong>
                                                <span>{formatPrice(review.condition.maxPrice)} 이하</span>
                                            </div>
                                            <span>
                                                {review.qualifiedCount > 0
                                                    ? `보낼 만한 특가 ${review.qualifiedCount}개`
                                                    : '지금은 보낼 특가 없음'}
                                            </span>
                                        </div>

                                        {review.candidates.length > 0 ? (
                                            <div className={styles.dealCandidateList}>
                                                {review.candidates.map(candidate => (
                                                    <a
                                                        key={candidate.flightId}
                                                        href={`/share/${encodeURIComponent(candidate.flightId)}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className={styles.dealCandidate}
                                                    >
                                                        <div>
                                                            <strong>{candidate.departureCity} → {candidate.arrivalCity}</strong>
                                                            <span>{candidate.departureDate} ~ {candidate.returnDate} · {candidate.airline}</span>
                                                            <small>{candidate.reasons.join(' · ')}</small>
                                                        </div>
                                                        <div>
                                                            <em>특가점수 {candidate.score}점</em>
                                                            <strong>{formatPrice(candidate.effectivePrice)}</strong>
                                                            <span>{SOURCE_NAMES[candidate.source] || candidate.source}{candidate.feeNote ? ` · ${candidate.feeNote}` : ''}</span>
                                                        </div>
                                                    </a>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className={styles.dealReviewEmpty}>지금 항공권 중에는 이 조건으로 보낼 만한 특가가 없습니다.</div>
                                        )}

                                        {Object.values(review.rejectionCounts).some(count => count > 0) && (
                                            <div className={styles.dealRejections}>
                                                <span className={styles.dealRejectionsLabel}>제외된 항공권과 이유:</span>
                                                {Object.entries(review.rejectionCounts)
                                                    .filter(([, count]) => count > 0)
                                                    .map(([reason, count]) => (
                                                        <span key={reason}>{DEAL_REJECTION_LABELS[reason] || reason} {count}건</span>
                                                    ))}
                                            </div>
                                        )}
                                    </article>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </section>

            {/* 소스별 현황 - 도넛 차트 */}
            <section className={styles.section}>
                <h2>여행사별 현황</h2>
                {(() => {
                    // conic-gradient 계산
                    let cumPct = 0;
                    const gradientParts = allSources.map(source => {
                        const pct = (data.bySource[source] / data.totalFlights) * 100;
                        const start = cumPct;
                        cumPct += pct;
                        return `${SOURCE_COLORS[source] || '#6b7280'} ${start}% ${cumPct}%`;
                    });
                    const gradient = `conic-gradient(${gradientParts.join(', ')})`;

                    return (
                        <div style={{ display: 'flex', gap: '32px', alignItems: 'center', flexWrap: 'wrap' }}>
                            {/* 도넛 차트 */}
                            <div style={{
                                width: '200px',
                                height: '200px',
                                borderRadius: '50%',
                                background: gradient,
                                position: 'relative',
                                flexShrink: 0,
                                margin: '0 auto',
                            }}>
                                <div style={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: '110px',
                                    height: '110px',
                                    borderRadius: '50%',
                                    background: '#1a1a2e',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <span style={{ fontSize: '1.4rem', fontWeight: 700 }}>{data.totalFlights.toLocaleString()}</span>
                                    <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>전체</span>
                                </div>
                            </div>

                            {/* 범례 테이블 */}
                            <div className={styles.cityDetail} style={{ flex: 1, minWidth: '280px' }}>
                                <table className={styles.cityTable}>
                                    <thead>
                                        <tr><th>여행사</th><th>항공편</th><th>비율</th><th>평균가</th></tr>
                                    </thead>
                                    <tbody>
                                        {allSources.map(source => {
                                            const count = data.bySource[source];
                                            const pct = Math.round((count / data.totalFlights) * 100);
                                            const avgPrice = data.avgPriceBySource[source];
                                            return (
                                                <tr key={source}>
                                                    <td>
                                                        <span style={{
                                                            display: 'inline-block',
                                                            width: '10px',
                                                            height: '10px',
                                                            borderRadius: '50%',
                                                            background: SOURCE_COLORS[source] || '#6b7280',
                                                            marginRight: '8px',
                                                            verticalAlign: 'middle',
                                                        }} />
                                                        {SOURCE_NAMES[source] || source}
                                                    </td>
                                                    <td>{count.toLocaleString()}건</td>
                                                    <td>{pct}%</td>
                                                    <td>{formatPrice(avgPrice)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })()}
            </section>

            {/* 크롤링 히스토리 */}
            {data.crawlHistory && data.crawlHistory.length > 0 && (
                <section className={styles.section}>
                    <h2>📈 크롤링 히스토리</h2>
                    <div className={styles.cityDetail} style={{ overflowX: 'auto' }}>
                        <table className={styles.cityTable} style={{ minWidth: '500px' }}>
                            <thead>
                                <tr>
                                    <th>시간</th>
                                    {allSources.map(s => (
                                        <th key={s} style={{ color: SOURCE_COLORS[s] }}>
                                            {SOURCE_NAMES[s] || s}
                                        </th>
                                    ))}
                                    <th>합계</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...data.crawlHistory].reverse().slice(0, 14).map((entry, idx, arr) => {
                                    const prev = arr[idx + 1];
                                    const total = Object.values(entry.sites).reduce((a, s) => a + s.total, 0);
                                    const prevTotal = prev ? Object.values(prev.sites).reduce((a, s) => a + s.total, 0) : null;
                                    const totalDiff = prevTotal !== null ? total - prevTotal : null;

                                    return (
                                        <tr key={entry.timestamp}>
                                            <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                                {formatKST(entry.timestamp).replace(/\d{4}. /, '')}
                                            </td>
                                            {allSources.map(source => {
                                                const count = entry.sites[source]?.total ?? 0;
                                                const prevCount = prev?.sites[source]?.total ?? null;
                                                const diff = prevCount !== null ? count - prevCount : null;
                                                return (
                                                    <td key={source} style={{ textAlign: 'center' }}>
                                                        <span>{count}</span>
                                                        {diff !== null && diff !== 0 && (
                                                            <span style={{
                                                                fontSize: '0.75rem',
                                                                marginLeft: '4px',
                                                                color: diff > 0 ? '#10b981' : '#ef4444',
                                                                fontWeight: 600,
                                                            }}>
                                                                {diff > 0 ? `+${diff}` : diff}
                                                            </span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td style={{ textAlign: 'center', fontWeight: 600 }}>
                                                <span>{total}</span>
                                                {totalDiff !== null && totalDiff !== 0 && (
                                                    <span style={{
                                                        fontSize: '0.75rem',
                                                        marginLeft: '4px',
                                                        color: totalDiff > 0 ? '#10b981' : '#ef4444',
                                                    }}>
                                                        {totalDiff > 0 ? `+${totalDiff}` : totalDiff}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* 경고 목록 */}
                    {data.crawlHistory.some(e => e.alerts.length > 0) && (
                        <div className={styles.cityDetail} style={{ marginTop: '16px' }}>
                            <h3 style={{ marginBottom: '8px' }}>⚠️ 최근 경고</h3>
                            <table className={styles.cityTable}>
                                <thead>
                                    <tr><th>시간</th><th>내용</th></tr>
                                </thead>
                                <tbody>
                                    {data.crawlHistory
                                        .filter(e => e.alerts.length > 0)
                                        .slice(-5)
                                        .reverse()
                                        .flatMap((e) =>
                                            e.alerts.map((a, j) => (
                                                <tr key={`${e.timestamp}-${j}`}>
                                                    {j === 0 ? (
                                                        <td rowSpan={e.alerts.length} style={{ whiteSpace: 'nowrap', verticalAlign: 'top', fontSize: '0.85rem' }}>
                                                            {formatKST(e.timestamp).replace(/\d{4}\. /, '')}
                                                        </td>
                                                    ) : null}
                                                    <td style={{ color: '#ef4444', fontSize: '0.85rem' }}>{a}</td>
                                                </tr>
                                            ))
                                        )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            )}

            {/* 지역별 가격 현황 */}
            <section className={styles.section}>
                <h2>지역별 가격 현황</h2>
                <div className={styles.cityDetail}>
                    <table className={styles.cityTable}>
                        <thead>
                            <tr>
                                <th>지역</th>
                                <th>항공편</th>
                                <th>최저가</th>
                                <th>최고가</th>
                                <th>평균가</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedRegions.map(([region, count]) => {
                                const rp = data.priceByRegion[region];
                                return (
                                    <tr key={region}>
                                        <td><strong>{region}</strong></td>
                                        <td>{count}건</td>
                                        <td style={{ color: '#10b981' }}>{formatPrice(rp.min)}</td>
                                        <td style={{ color: '#ef4444' }}>{formatPrice(rp.max)}</td>
                                        <td>{formatPrice(Math.round(rp.avg))}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* 인기 도착 도시 TOP 15 */}
            <section className={styles.section}>
                <h2>인기 도착 도시 TOP 15</h2>
                <div className={styles.cityDetail}>
                    <table className={styles.cityTable}>
                        <thead>
                            <tr><th>도시</th><th>항공편</th><th>비율</th></tr>
                        </thead>
                        <tbody>
                            {sortedCities.slice(0, 15).map(([city, count]) => (
                                <tr key={city}>
                                    <td>{city}</td>
                                    <td>{count}건</td>
                                    <td>{Math.round((count / data.totalFlights) * 100)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* 출발 도시별 */}
            <section className={styles.section}>
                <h2>출발 도시별</h2>
                <div className={styles.cityDetail}>
                    <table className={styles.cityTable}>
                        <thead>
                            <tr><th>출발 도시</th><th>항공편</th><th>비율</th></tr>
                        </thead>
                        <tbody>
                            {sortedDepCities.map(([city, count]) => (
                                <tr key={city}>
                                    <td>{city}</td>
                                    <td>{count}건</td>
                                    <td>{Math.round((count / data.totalFlights) * 100)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* 항공사별 TOP 15 */}
            <section className={styles.section}>
                <h2>항공사별 TOP 15</h2>
                <div className={styles.cityDetail}>
                    <table className={styles.cityTable}>
                        <thead>
                            <tr><th>항공사</th><th>항공편</th><th>비율</th></tr>
                        </thead>
                        <tbody>
                            {sortedAirlines.slice(0, 15).map(([airline, count]) => (
                                <tr key={airline}>
                                    <td>{airline}</td>
                                    <td>{count}건</td>
                                    <td>{Math.round((count / data.totalFlights) * 100)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* 최저가 TOP 10 */}
            <section className={styles.section}>
                <h2>🔥 최저가 TOP 10</h2>
                <div className={styles.cityDetail}>
                    <table className={styles.cityTable}>
                        <thead>
                            <tr>
                                <th>노선</th>
                                <th>항공사</th>
                                <th>가격</th>
                                <th>출발일</th>
                                <th>여행사</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.cheapest.map((f, i) => (
                                <tr key={i}>
                                    <td>{f.route}</td>
                                    <td>{f.airline}</td>
                                    <td style={{ color: '#10b981', fontWeight: 600 }}>{formatPrice(f.price)}</td>
                                    <td>{f.date}</td>
                                    <td>
                                        <span style={{
                                            background: SOURCE_COLORS[f.source] || '#6b7280',
                                            color: '#fff',
                                            padding: '2px 8px',
                                            borderRadius: '4px',
                                            fontSize: '0.8rem',
                                        }}>
                                            {SOURCE_NAMES[f.source] || f.source}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className={styles.section}>
                <h2>📈 수익 전환 분석</h2>
                <div className={styles.card}>
                    <p style={{ margin: 0, lineHeight: 1.7 }}>
                        예약·제휴 클릭은 위 <strong>&ldquo;방문자와 행동(GA4)&rdquo;</strong> 항목에서 바로 볼 수 있습니다.
                        더 깊게 파고들 때만 GA4를 열면 됩니다. 실제 구매와 수익은 마이리얼트립 및 Trip.com 파트너 정산 화면과 대조합니다.
                    </p>
                    <a href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '10px', color: '#7c3aed', fontWeight: 700 }}>
                        Google Analytics 열기 →
                    </a>
                    <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid #334155' }}>
                        <p style={{ margin: '0 0 10px', color: analyticsExcluded ? '#86efac' : '#fbbf24', fontWeight: 700 }}>
                            내 방문 통계: {analyticsExcluded ? '제외 중' : '포함 중'}
                        </p>
                        <p style={{ margin: '0 0 12px', color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.6 }}>
                            이 브라우저에서 발생하는 방문과 예약 클릭을 GA4에서 제외합니다. 다른 기기나 브라우저는 각각 설정해야 합니다.
                        </p>
                        <button
                            type="button"
                            className={styles.analyticsToggle}
                            onClick={() => {
                                const next = !analyticsExcluded;
                                setAnalyticsExcluded(next);
                                setAnalyticsExcludedState(next);
                            }}
                        >
                            {analyticsExcluded ? '내 방문 다시 포함하기' : '내 방문 제외하기'}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}
