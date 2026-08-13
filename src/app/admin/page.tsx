'use client';

import { useState, useEffect } from 'react';
import styles from './admin.module.css';

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
}

const SOURCE_NAMES: Record<string, string> = {
    hanatour: '하나투어',
    modetour: '모두투어',
    ttang: '땡처리닷컴',
    ybtour: '노랑풍선',
    onlinetour: '온라인투어',
};

const SOURCE_COLORS: Record<string, string> = {
    hanatour: '#7c3aed',
    modetour: '#059669',
    ttang: '#dc2626',
    ybtour: '#d97706',
    onlinetour: '#1e40af',
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

    useEffect(() => {
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
            setAuthed(true);
            setError(null);

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
                        예약·제휴 클릭은 GA4에서 확인합니다. 실제 구매와 수익은 마이리얼트립 및 Trip.com 파트너 정산 화면과 대조합니다.
                    </p>
                    <a href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '10px', color: '#7c3aed', fontWeight: 700 }}>
                        Google Analytics 열기 →
                    </a>
                </div>
            </section>
        </div>
    );
}
