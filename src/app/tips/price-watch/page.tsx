import { buildInsights, splitRoute, type PricePoint } from '@/lib/price-watch-insights';
import type { Metadata } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { SITE_URL } from '@/lib/site';
import styles from '../tips.module.css';

export const metadata: Metadata = {
    title: '최근 가격이 내려간 주요 땡처리 항공권 노선',
    description: '티키티킷이 최근 2~3주 동안 실제로 수집한 주요 노선별 최저가 기록을 확인하세요.',
    alternates: { canonical: '/tips/price-watch' },
};

function loadHistory(): Record<string, PricePoint[]> {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'price-history.json'), 'utf8'));
    } catch {
        return {};
    }
}

function formatPrice(value: number) {
    return `${value.toLocaleString('ko-KR')}원`;
}

function formatDate(value: string) {
    const [, month, day] = value.split('-');
    return `${Number(month)}/${Number(day)}`;
}

export default function PriceWatchPage() {
    const data = buildInsights(loadHistory());
    const firstObserved = data.rows.map(row => row.firstDate).filter(Boolean).sort()[0] || '';
    const datasetJsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        '@id': `${SITE_URL}/tips/price-watch#dataset`,
        name: '티키티킷 주요 항공 노선 최저 표시 가격 기록',
        description: '티키티킷이 여행사 항공권 상품에서 수집한 출발지·도착지별 최저 표시 가격 기록입니다. 최근 기록 구간이 20일 이내인 주요 노선의 첫 기록과 최근 기록, 최저·최고 가격 및 표본 수를 비교합니다. 수집 시점의 상품 구성이 달라질 수 있어 동일 항공편의 가격 변동이나 현재 예약 가능한 가격을 뜻하지 않습니다.',
        url: `${SITE_URL}/tips/price-watch`,
        creator: { '@id': `${SITE_URL}/#organization` },
        dateModified: data.latestDate || undefined,
        temporalCoverage: firstObserved && data.latestDate ? `${firstObserved}/${data.latestDate}` : undefined,
        inLanguage: 'ko-KR',
        isAccessibleForFree: true,
        license: {
            '@type': 'CreativeWork',
            name: '티키티킷 서비스 이용약관 — 제5조 지적재산권',
            url: `${SITE_URL}/terms#intellectual-property`,
        },
        measurementTechnique: '각 수집일의 여행사 상품 중 노선별 최저 표시 가격 비교',
        variableMeasured: ['노선', '수집일', '최저 표시 가격', '표본 수'],
    };

    return (
        <main className={styles.tipsPage}>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }} />
            <Link href="/" className={styles.backLink}>← 항공권 목록</Link>
            <article className={styles.article}>
                <p className={styles.dataEyebrow}>TIKITIKIT PRICE NOTE</p>
                <h1 className={styles.articleTitle}>최근 2~3주 기록에서 가격이 내려간 주요 노선</h1>
                <p className={styles.articleDesc}>
                    여행 상식이 아니라 티키티킷의 실제 가격 기록에서 시작했습니다. 최근 기록 구간이 20일 이내인 주요 노선만 골라 첫 기록과 최근 기록을 비교했습니다.
                </p>
                {data.latestDate && <p className={styles.articleDesc}>마지막 기록일: <time dateTime={data.latestDate}>{data.latestDate}</time></p>}

                <div className={styles.dataSummary}>
                    <div><strong>{data.trackedRoutes.toLocaleString()}</strong><span>비교 가능한 노선 기록</span></div>
                    <div><strong>{data.currentRoutes.toLocaleString()}</strong><span>{data.latestDate ? `${formatDate(data.latestDate)} 기록이 있는 노선` : '최근 기록 노선'}</span></div>
                    <div><strong>최대 14회</strong><span>노선별 비교 기록</span></div>
                </div>

                <section className={styles.insightList} aria-label="가격이 내려간 노선">
                    {data.rows.map(item => {
                        const range = item.high - item.low;
                        const position = range > 0 ? Math.max(3, Math.min(100, ((item.latestPrice - item.low) / range) * 100)) : 3;
                        const query = new URLSearchParams({ dep: item.departure, q: item.arrival });
                        return (
                            <div className={styles.insightCard} key={item.route}>
                                <div className={styles.insightHeader}>
                                    <div>
                                        <span>{item.observations}회 기록</span>
                                        <h2>{item.departure} → {item.arrival}{splitRoute(item.route)?.airport ? ` (${splitRoute(item.route)!.airport})` : ''}</h2>
                                    </div>
                                    <strong>노선 최저가 {Math.abs(Math.round(item.changeRate))}% 하락</strong>
                                </div>
                                <p className={styles.comparisonNote}>수집된 상품 중 노선 최저가 비교예요. 날짜별 상품 구성이 달라 동일 항공권의 할인율은 아닙니다.</p>
                                <div className={styles.priceComparison}>
                                    <div><span>{formatDate(item.firstDate)}</span><del>{formatPrice(item.firstPrice)}</del></div>
                                    <b>→</b>
                                    <div><span>{formatDate(item.latestDate)}</span><strong>{formatPrice(item.latestPrice)}</strong></div>
                                </div>
                                <div className={styles.rangeTrack} aria-label={`기록 범위 ${formatPrice(item.low)}에서 ${formatPrice(item.high)}`}>
                                    <span style={{ width: `${position}%` }} />
                                </div>
                                <p className={styles.rangeLabel}>수집 기록 범위 {formatPrice(item.low)}~{formatPrice(item.high)}</p>
                                <Link href={`/?${query.toString()}`} className={styles.inlineLink}>현재 이 노선 표 보기 →</Link>
                            </div>
                        );
                    })}
                </section>

                {data.rows.length === 0 && <p>현재 비교 조건을 충족하는 가격 하락 기록이 없습니다.</p>}
                <div className={styles.methodBox}>
                    <h2>이 숫자를 보는 법</h2>
                    <p>같은 노선의 표기가 여러 개면 최근 기록일과 기록 수를 기준으로 한 기록 묶음을 선택합니다. 과거 값을 합산하지 않으며, 출발 공항이나 보라카이의 도착 공항이 불명확한 기록은 비교에서 제외합니다.</p>
                    <p>각 값은 해당 날짜에 티키티킷이 수집한 여행사 상품 중 노선별 최저 표시 가격입니다. 동일한 항공편이나 동일한 출발일을 계속 추적한 값은 아닙니다.</p>
                    <p>시장 전체 평균이나 미래 가격 예측이 아닙니다. 현재 판매 가격과 좌석은 여행사 예약 화면에서 다시 확인해야 합니다.</p>
                </div>
            </article>
        </main>
    );
}
