'use client';

import { useState, useEffect } from 'react';
import styles from './admin.module.css';

interface SiteStats {
    total: number;
    byRegion?: Record<string, Record<string, number>>;
    byCity?: Record<string, number>;
}

interface CrawlLogEntry {
    timestamp: string;
    sites: Record<string, SiteStats>;
    alerts: string[];
}

interface CrawlLogHistory {
    entries: CrawlLogEntry[];
    lastEntry?: CrawlLogEntry;
}

const SOURCE_NAMES: Record<string, string> = {
    hanatour: '하나투어',
    modetour: '모두투어',
    ttang: '땡처리닷컴',
    ybtour: '노랑풍선',
    onlinetour: '온라인투어',
};

const SOURCE_COLORS: Record<string, string> = {
    hanatour: '#6366f1',
    modetour: '#10b981',
    ttang: '#f59e0b',
    ybtour: '#ef4444',
    onlinetour: '#8b5cf6',
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

export default function AdminPage() {
    const [data, setData] = useState<CrawlLogHistory | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [key, setKey] = useState('');
    const [authed, setAuthed] = useState(false);
    const [expandedSite, setExpandedSite] = useState<string | null>(null);

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
            const res = await fetch(`/api/crawl-log?key=${encodeURIComponent(authKey)}`);
            if (res.status === 401) {
                setError('인증 실패: 올바른 키를 입력해주세요.');
                setAuthed(false);
                setLoading(false);
                return;
            }
            const json = await res.json();
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

    if (!data || !data.entries.length) {
        return (
            <div className={styles.container}>
                <h1>크롤링 모니터</h1>
                <p>저장된 크롤링 로그가 없습니다.</p>
            </div>
        );
    }

    const lastEntry = data.lastEntry || data.entries[data.entries.length - 1];
    const prevEntry = data.entries.length > 1 ? data.entries[data.entries.length - 2] : null;
    const allSources = Object.keys(lastEntry.sites);
    const totalFlights = allSources.reduce((sum, s) => sum + lastEntry.sites[s].total, 0);

    // 최근 7개 엔트리로 추이 차트 데이터
    const recentEntries = data.entries.slice(-7);
    const maxTotal = Math.max(...recentEntries.flatMap(e => Object.values(e.sites).map(s => s.total)), 1);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1>📊 크롤링 모니터</h1>
                <span className={styles.lastUpdated}>
                    마지막 크롤링: {formatKST(lastEntry.timestamp)} ({timeAgo(lastEntry.timestamp)})
                </span>
            </header>

            {/* 요약 카드 */}
            <div className={styles.summaryCards}>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>전체 항공편</span>
                    <span className={styles.summaryValue}>{totalFlights.toLocaleString()}</span>
                </div>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>소스 수</span>
                    <span className={styles.summaryValue}>{allSources.length}</span>
                </div>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>로그 기록</span>
                    <span className={styles.summaryValue}>{data.entries.length}일</span>
                </div>
                <div className={`${styles.summaryCard} ${lastEntry.alerts.length > 0 ? styles.alertCard : ''}`}>
                    <span className={styles.summaryLabel}>경고</span>
                    <span className={styles.summaryValue}>{lastEntry.alerts.length}</span>
                </div>
            </div>

            {/* 소스별 현황 */}
            <section className={styles.section}>
                <h2>여행사별 현황</h2>
                <div className={styles.sourceGrid}>
                    {allSources.map(source => {
                        const stats = lastEntry.sites[source];
                        const prevStats = prevEntry?.sites[source];
                        const diff = prevStats ? stats.total - prevStats.total : 0;
                        const diffPct = prevStats && prevStats.total > 0
                            ? Math.round((diff / prevStats.total) * 100)
                            : 0;
                        const cityCount = stats.byCity ? Object.keys(stats.byCity).length : 0;

                        return (
                            <div
                                key={source}
                                className={styles.sourceCard}
                                style={{ borderLeft: `4px solid ${SOURCE_COLORS[source] || '#6b7280'}` }}
                                onClick={() => setExpandedSite(expandedSite === source ? null : source)}
                            >
                                <div className={styles.sourceHeader}>
                                    <span className={styles.sourceName}>{SOURCE_NAMES[source] || source}</span>
                                    <span className={styles.sourceTotal}>{stats.total.toLocaleString()}</span>
                                </div>
                                <div className={styles.sourceFooter}>
                                    <span className={styles.sourceCityCount}>{cityCount}개 도시</span>
                                    {diff !== 0 && (
                                        <span className={`${styles.sourceDiff} ${diff > 0 ? styles.diffUp : styles.diffDown}`}>
                                            {diff > 0 ? '▲' : '▼'} {Math.abs(diff)} ({diffPct > 0 ? '+' : ''}{diffPct}%)
                                        </span>
                                    )}
                                </div>

                                {/* 도시 상세 (확장 시) */}
                                {expandedSite === source && stats.byCity && (
                                    <div className={styles.cityDetail}>
                                        <table className={styles.cityTable}>
                                            <thead>
                                                <tr><th>도시</th><th>항공편</th><th>변화</th></tr>
                                            </thead>
                                            <tbody>
                                                {Object.entries(stats.byCity)
                                                    .sort((a, b) => b[1] - a[1])
                                                    .slice(0, 20)
                                                    .map(([city, count]) => {
                                                        const prevCount = prevStats?.byCity?.[city] || 0;
                                                        const cityDiff = count - prevCount;
                                                        return (
                                                            <tr key={city}>
                                                                <td>{city}</td>
                                                                <td>{count}</td>
                                                                <td className={cityDiff > 0 ? styles.diffUp : cityDiff < 0 ? styles.diffDown : ''}>
                                                                    {cityDiff !== 0 ? (cityDiff > 0 ? `+${cityDiff}` : cityDiff) : '-'}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* 일별 추이 */}
            <section className={styles.section}>
                <h2>일별 수집 추이 (최근 {recentEntries.length}회)</h2>
                <div className={styles.chartContainer}>
                    <div className={styles.chart}>
                        {recentEntries.map((entry, i) => {
                            const date = new Date(entry.timestamp);
                            const label = `${date.getMonth() + 1}/${date.getDate()}`;

                            return (
                                <div key={i} className={styles.chartColumn}>
                                    <div className={styles.chartBars}>
                                        {allSources.map(source => {
                                            const total = entry.sites[source]?.total || 0;
                                            const height = (total / maxTotal) * 100;
                                            return (
                                                <div
                                                    key={source}
                                                    className={styles.chartBar}
                                                    style={{
                                                        height: `${height}%`,
                                                        background: SOURCE_COLORS[source] || '#6b7280',
                                                    }}
                                                    title={`${SOURCE_NAMES[source] || source}: ${total}`}
                                                >
                                                    {height > 15 && <span className={styles.barLabel}>{total}</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <span className={styles.chartDate}>{label}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className={styles.chartLegend}>
                        {allSources.map(source => (
                            <span key={source} className={styles.legendItem}>
                                <span className={styles.legendDot} style={{ background: SOURCE_COLORS[source] }}></span>
                                {SOURCE_NAMES[source] || source}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* 경고 */}
            {lastEntry.alerts.length > 0 && (
                <section className={styles.section}>
                    <h2>⚠️ 경고 ({lastEntry.alerts.length})</h2>
                    <div className={styles.alertList}>
                        {lastEntry.alerts.map((alert, i) => (
                            <div key={i} className={styles.alertItem}>{alert}</div>
                        ))}
                    </div>
                </section>
            )}

            {/* 전체 로그 */}
            <section className={styles.section}>
                <h2>로그 기록 ({data.entries.length})</h2>
                <div className={styles.logList}>
                    {[...data.entries].reverse().map((entry, i) => {
                        const total = Object.values(entry.sites).reduce((s, v) => s + v.total, 0);
                        const sources = Object.entries(entry.sites).map(([k, v]) => `${SOURCE_NAMES[k] || k}: ${v.total}`).join(' · ');
                        return (
                            <div key={i} className={styles.logItem}>
                                <span className={styles.logDate}>{formatKST(entry.timestamp)}</span>
                                <span className={styles.logTotal}>{total.toLocaleString()}건</span>
                                <span className={styles.logSources}>{sources}</span>
                                {entry.alerts.length > 0 && (
                                    <span className={styles.logAlerts}>⚠️ {entry.alerts.length}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
