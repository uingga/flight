import { NextRequest, NextResponse } from 'next/server';
import todayPick from '../../../../data/today-pick.json';
import { Flight, FlightSearchParams } from '@/types/flight';
import { resolveCityCode } from '@/lib/scrapers/interpark';
import { getComparisonFreshness, getEffectivePrice } from '@/lib/price-quality';
import { getUsableNaverComparison } from '@/lib/naver-comparison';
import { filterStaleMyrealtripFlights, getMyrealtripFreshness } from '@/lib/source-freshness';
import { deduplicateDisplayFlights } from '@/lib/flight-visibility';
import { buildNaverPriceKey } from '@/lib/naver-route';
import { normalizeCity } from '@/lib/utils/flight-helpers';
import {
    compactPublicPriceHistory,
    publicFlightRouteKey,
    type PublicPriceHistory,
} from '@/lib/public-flight-data';

interface FlightFilterSummary {
    collected: number;
    visible: number;
    excluded: number;
    reasons: {
        staleMyrealtrip: number;
        reported: number;
        duplicate: number;
        naverExpensive: number;
        expired: number;
        oneWay: number;
    };
    visibleBySource: Record<string, number>;
    visibleByRegion: Record<string, number>;
    visibleByCity: Record<string, number>;
    visibleByDepartureCity: Record<string, number>;
    visibleByAirline: Record<string, number>;
    quality: {
        missingTimes: number;
        missingSeats: number;
        missingBookingLink: number;
        missingExactAirports: number;
        freshNaverComparison: number;
    };
    lowestVisible: Array<{
        id: string;
        route: string;
        airline: string;
        price: number;
        date: string;
        source: string;
    }>;
}

const HIDDEN_FLIGHT_CACHE_MS = 60 * 1000;
let hiddenFlightCache: { ids: Set<string>; validUntil: number } = {
    ids: new Set(),
    validUntil: 0,
};

async function loadHiddenFlightIds(): Promise<Set<string>> {
    if (hiddenFlightCache.validUntil > Date.now()) return hiddenFlightCache.ids;

    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return new Set();

    const headers = { apikey: key, 'Content-Type': 'application/json' };
    const nowIso = new Date().toISOString();
    try {
        // 만료된 임시 숨김은 첫 목록 요청 때 자동 해제한다. DB 트리거가 해제 기록도 남긴다.
        const expireResponse = await fetch(
            `${url}/rest/v1/flight_report_hides?status=eq.active&expires_at=lte.${encodeURIComponent(nowIso)}`,
            {
                method: 'PATCH',
                headers: { ...headers, Prefer: 'return=minimal' },
                body: JSON.stringify({
                    status: 'expired',
                    released_at: nowIso,
                    release_reason: '24시간 임시 숨김 만료',
                    updated_at: nowIso,
                }),
                cache: 'no-store',
            },
        );
        if (!expireResponse.ok) throw new Error(`hide expiry ${expireResponse.status}`);

        const query = [
            'select=flight_id',
            'status=in.(active,manual)',
            `or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(nowIso)})`,
        ].join('&');
        const response = await fetch(`${url}/rest/v1/flight_report_hides?${query}`, {
            headers,
            cache: 'no-store',
        });
        if (!response.ok) throw new Error(`hide lookup ${response.status}`);
        const rows = await response.json() as Array<{ flight_id: string }>;
        hiddenFlightCache = {
            ids: new Set(rows.map(row => row.flight_id)),
            validUntil: Date.now() + HIDDEN_FLIGHT_CACHE_MS,
        };
        return hiddenFlightCache.ids;
    } catch (error) {
        // 숨김 DB가 잠시 고장 났다고 전체 목록을 비우지는 않는다.
        console.error('임시 숨김 항공권 조회 실패:', error);
        hiddenFlightCache = { ids: new Set(), validUntil: Date.now() + 10_000 };
        return hiddenFlightCache.ids;
    }
}

// 항공사명 정규화 맵
const AIRLINE_NAME_MAP: Record<string, string> = {
    '베트남 항공': '베트남항공',
    '비엣젯 항공': '비엣젯항공',
    '아시아나 항공': '아시아나항공',
    '에미레이트 항공': '에미레이트항공',
    '에어로케이항공': '에어로케이',
    '중화 항공': '중화항공',
    '타이 비엣젯 항공': '타이비엣젯항공',
    '타이 비엣젯항공': '타이비엣젯항공',
    '터키 항공': '터키항공',
    '티웨이 항공': '티웨이항공',
    '필리핀 항공': '필리핀항공',
    '에티하드 항공': '에티하드항공',
    '투르크메니스탄 항공': '투르크메니스탄항공',
    'Airasia': '에어아시아',
    'ANA항공': 'ANA',
    '홍콩에어': '홍콩항공',
};

function normalizeAirline(name: string): string {
    if (!name) return name;
    const trimmed = name.trim();
    const invalidNames = new Set(['더 저렴한 항공권', '항공사 제공요금', '항공사 미정', '공동운항']);
    if (invalidNames.has(trimmed) || trimmed.includes('항공권') || trimmed.includes('제공요금') || trimmed.length > 60) {
        return '항공사 미정';
    }
    return AIRLINE_NAME_MAP[trimmed] || trimmed;
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;

    const params: FlightSearchParams = {
        departureCity: searchParams.get('departureCity') || undefined,
        arrivalCity: searchParams.get('arrivalCity') || undefined,
        minPrice: searchParams.get('minPrice') ? parseInt(searchParams.get('minPrice')!) : undefined,
        maxPrice: searchParams.get('maxPrice') ? parseInt(searchParams.get('maxPrice')!) : undefined,
        sortBy: (searchParams.get('sortBy') as 'price' | 'date' | 'airline') || 'price',
        sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'asc',
    };

    try {
        // 통합 캐시 파일에서 모든 항공권 데이터 읽기
        let allFlights: Flight[] = [];
        let lastUpdated: string | null = null;
        let sourceUpdatedAt: Record<string, string> = {};
        const filterSummary: FlightFilterSummary = {
            collected: 0,
            visible: 0,
            excluded: 0,
            reasons: {
                staleMyrealtrip: 0,
                reported: 0,
                duplicate: 0,
                naverExpensive: 0,
                expired: 0,
                oneWay: 0,
            },
            visibleBySource: {},
            visibleByRegion: {},
            visibleByCity: {},
            visibleByDepartureCity: {},
            visibleByAirline: {},
            quality: {
                missingTimes: 0,
                missingSeats: 0,
                missingBookingLink: 0,
                missingExactAirports: 0,
                freshNaverComparison: 0,
            },
            lowestVisible: [],
        };

        try {
            const fs = require('fs');
            const path = require('path');
            const cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');

            if (fs.existsSync(cachePath)) {
                const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
                allFlights = cacheData.flights || [];
                filterSummary.collected = allFlights.length;
                lastUpdated = cacheData.lastUpdated || cacheData.timestamp || null;
                sourceUpdatedAt = cacheData.sourceUpdatedAt || {};
                console.log(`통합 캐시에서 ${allFlights.length}개 항공권 로드`);
                console.log(`소스별: 노랑풍선=${cacheData.sources?.ybtour || 0}, 하나투어=${cacheData.sources?.hanatour || 0}, 모두투어=${cacheData.sources?.modetour || 0}, 온라인투어=${cacheData.sources?.onlinetour || 0}, 마이리얼트립=${cacheData.sources?.myrealtrip || 0}`);
            } else {
                console.log('통합 캐시 파일 없음. npm run crawl:all을 실행하세요.');
            }
        } catch (cacheError) {
            console.error('캐시 읽기 오류:', cacheError);
        }

        // 마이리얼트립은 실제 예약 화면 가격을 별도 확인한다. 이 갱신이 하루 넘게
        // 멈추면 Calendar API의 대략 가격이나 오래된 가격을 사용자에게 보여주지 않는다.
        const beforeFreshnessFilter = allFlights.length;
        allFlights = filterStaleMyrealtripFlights(allFlights, sourceUpdatedAt);
        const hiddenCount = beforeFreshnessFilter - allFlights.length;
        filterSummary.reasons.staleMyrealtrip = hiddenCount;
        if (hiddenCount > 0) {
            const freshness = getMyrealtripFreshness(sourceUpdatedAt);
            console.warn(`마이리얼트립 가격 갱신이 ${freshness.maxAgeHours}시간 넘게 멈춰 ${hiddenCount}개를 숨겼습니다.`);
        }

        const temporarilyHiddenIds = await loadHiddenFlightIds();
        if (temporarilyHiddenIds.size > 0) {
            const beforeReportFilter = allFlights.length;
            allFlights = allFlights.filter(flight => !temporarilyHiddenIds.has(flight.id));
            const reportHiddenCount = beforeReportFilter - allFlights.length;
            filterSummary.reasons.reported = reportHiddenCount;
            if (reportHiddenCount > 0) {
                console.log(`신고 누적으로 임시 숨김 ${reportHiddenCount}개`);
            }
        }

        // 항공사명 정규화
        allFlights = allFlights.map(f => ({
            ...f,
            // 신고 후 한 항공권만 다시 확인한 경우에는 그 항공권의 시각이 여행사 전체
            // 크롤 시각보다 정확하다. 개별 확인값을 지우지 않고 우선 사용한다.
            priceCheckedAt: f.priceCheckedAt || sourceUpdatedAt[f.source] || lastUpdated || undefined,
            airline: normalizeAirline(f.airline),
            // 모두투어 예약 링크에서 departureCity SEL → ICN 보정 (SEL은 모두투어 웹에서 미인식)
            link: (f.source === 'modetour' && f.link?.includes('%22SEL%22'))
                ? f.link.replace('%22SEL%22', '%22ICN%22')
                : f.link,
        }));

        // 중복 항공편 합치기: 같은 노선+출국일시+귀국일시+항공사 → 1개만 유지
        // - 도시명 정규화 적용 (서울=인천, 타이중(대중)=타이중(대만)=타이중 등)
        // - 땡처리닷컴은 발권수수료 2만원을 더한 실질 가격으로 비교
        const beforeDedup = allFlights.length;
        allFlights = deduplicateDisplayFlights(allFlights);
        filterSummary.reasons.duplicate = beforeDedup - allFlights.length;
        if (beforeDedup > allFlights.length) {
            console.log(`중복 항공편 ${beforeDedup - allFlights.length}개 제거 (${beforeDedup} → ${allFlights.length})`);
        }

        // 네이버 최저가 매칭 (가는편·오는편의 실제 공항 네 개와 날짜가 모두 같은 결과만 사용)
        try {
            const fs4 = require('fs');
            const path4 = require('path');
            const naverPath = path4.join(process.cwd(), 'data', 'naver-prices.json');
            if (fs4.existsSync(naverPath)) {
                const naverPrices = JSON.parse(fs4.readFileSync(naverPath, 'utf-8'));

                let matched = 0;
                for (const f of allFlights) {
                    // 캐시에 남은 과거 비교값이 새 실제 공항 조합에 붙지 않도록 먼저 비운다.
                    delete f.naverLowest;
                    delete f.naverCheckedAt;
                    const exactKey = buildNaverPriceKey(f, f.departure?.date, f.arrival?.date);
                    if (exactKey) {
                        const matchedPrice = naverPrices[exactKey];
                        const comparison = getUsableNaverComparison(matchedPrice);
                        const bestPrice: number | null = comparison?.price || null;

                        if (bestPrice) {
                            f.naverLowest = bestPrice;
                            f.naverCheckedAt = comparison!.checkedAt;
                            matched++;
                        }
                    }
                }
                const beforeNaverFilter = allFlights.length;
                allFlights = allFlights.filter(f => {
                    if (!f.naverLowest || f.naverLowest <= 0) return true;
                    // KST 날짜 기준 4일 이상 지난 비교가는 추천 점수뿐 아니라 제거 판단에도 사용하지 않는다.
                    if (!getComparisonFreshness(f.naverCheckedAt).usable) return true;
                    const effectivePrice = getEffectivePrice(f);
                    const difference = effectivePrice - f.naverLowest;
                    const moreExpensiveRatio = difference / f.naverLowest;
                    return difference < 100000 || moreExpensiveRatio < 0.2;
                });
                const removed = beforeNaverFilter - allFlights.length;
                filterSummary.reasons.naverExpensive = removed;
                if (matched > 0) console.log(`네이버 최저가 매칭: ${matched}/${allFlights.length}건`);
                if (removed > 0) console.log(`네이버보다 10만원·20% 이상 비싼 항공권 제거: ${removed}건`);
            }
        } catch (e) { }

        // 만료 항공권 제거 (출발일이 오늘 이전)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const beforeCount = allFlights.length;
        allFlights = allFlights.filter(f => {
            if (!f.departure?.date) return true; // 날짜 없으면 유지
            // 다양한 날짜 형식 처리: "2026-02-17", "2026.02.17(화)" 등
            const dateStr = f.departure.date.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
            const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!match) return true; // 파싱 불가하면 유지
            const depDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
            return depDate >= today;
        });
        const removedCount = beforeCount - allFlights.length;
        filterSummary.reasons.expired = removedCount;
        if (removedCount > 0) {
            console.log(`만료 항공권 ${removedCount}개 제거됨 (${beforeCount} → ${allFlights.length})`);
        }

        // 편도 항공권 필터링 (출발일 = 귀국일이면 편도)
        const beforeOneWay = allFlights.length;
        allFlights = allFlights.filter(f => {
            if (!f.departure?.date || !f.arrival?.date) return true;
            const depClean = f.departure.date.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
            const arrClean = f.arrival.date.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
            return depClean !== arrClean;
        });
        const oneWayRemoved = beforeOneWay - allFlights.length;
        filterSummary.reasons.oneWay = oneWayRemoved;
        if (oneWayRemoved > 0) {
            console.log(`편도 항공권 ${oneWayRemoved}개 제거됨 (${beforeOneWay} → ${allFlights.length})`);
        }

        filterSummary.visible = allFlights.length;
        filterSummary.excluded = filterSummary.collected - filterSummary.visible;
        const addCount = (target: Record<string, number>, key: string) => {
            target[key] = (target[key] || 0) + 1;
        };
        for (const flight of allFlights) {
            addCount(filterSummary.visibleBySource, flight.source);
            addCount(filterSummary.visibleByRegion, flight.region || '기타');
            addCount(filterSummary.visibleByCity, normalizeCity(flight.arrival?.city || '') || '알 수 없음');
            addCount(filterSummary.visibleByDepartureCity, normalizeCity(flight.departure?.city || '') || '알 수 없음');
            addCount(filterSummary.visibleByAirline, flight.airline || '항공사 미정');

            if (!flight.departure?.time || !flight.arrival?.time) filterSummary.quality.missingTimes += 1;
            if (flight.availableSeats === undefined && !flight.seats) filterSummary.quality.missingSeats += 1;
            if (!flight.link) filterSummary.quality.missingBookingLink += 1;
            const airports = flight.routeAirports;
            if (!airports?.outboundDeparture || !airports.outboundArrival || !airports.returnDeparture || !airports.returnArrival) {
                filterSummary.quality.missingExactAirports += 1;
            }
            if (flight.naverLowest && getComparisonFreshness(flight.naverCheckedAt).usable) {
                filterSummary.quality.freshNaverComparison += 1;
            }
        }
        filterSummary.lowestVisible = [...allFlights]
            .sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b))
            .slice(0, 10)
            .map(flight => ({
                id: flight.id,
                route: `${flight.departure.city} → ${flight.arrival.city}`,
                airline: flight.airline,
                price: getEffectivePrice(flight),
                date: flight.departure.date,
                source: flight.source,
            }));

        if (searchParams.get('summaryOnly') === '1') {
            return NextResponse.json({
                success: true,
                count: allFlights.length,
                filterSummary,
                lastUpdated,
            });
        }

        // 필터링
        if (params.departureCity) {
            allFlights = allFlights.filter(f =>
                f.departure.city.includes(params.departureCity!)
            );
        }
        if (params.arrivalCity) {
            allFlights = allFlights.filter(f =>
                f.arrival.city.includes(params.arrivalCity!)
            );
        }
        if (params.minPrice) {
            allFlights = allFlights.filter(f => f.price >= params.minPrice!);
        }
        if (params.maxPrice) {
            allFlights = allFlights.filter(f => f.price <= params.maxPrice!);
        }

        // 정렬
        allFlights.sort((a, b) => {
            let comparison = 0;

            switch (params.sortBy) {
                case 'price':
                    comparison = a.price - b.price;
                    break;
                case 'date':
                    comparison = new Date(a.departure.date).getTime() - new Date(b.departure.date).getTime();
                    break;
                case 'airline':
                    comparison = a.airline.localeCompare(b.airline);
                    break;
            }

            return params.sortOrder === 'desc' ? -comparison : comparison;
        });

        // 화면 인사이트에 필요한 현재 노선의 최근 60일 최저가·표본 수만 공개한다.
        // 원본 장기 이력과 평균가는 서버 데이터로 남기되 브라우저 응답에는 싣지 않는다.
        let priceHistory: PublicPriceHistory = {};
        try {
            const fs2 = require('fs');
            const path2 = require('path');
            const histPath = path2.join(process.cwd(), 'data', 'price-history.json');
            if (fs2.existsSync(histPath)) {
                const rawPriceHistory: unknown = JSON.parse(fs2.readFileSync(histPath, 'utf-8'));
                const visibleRoutes = new Set(allFlights.map(flight => (
                    publicFlightRouteKey(flight.departure?.city || '', flight.arrival?.city || '')
                )).filter(Boolean));
                priceHistory = compactPublicPriceHistory(rawPriceHistory, { allowedRoutes: visibleRoutes });
            }
        } catch (e) { }

        // 정적 import로 Vercel 서버 함수 번들에도 선정 파일을 확실히 포함한다.
        const todayPickDate = typeof todayPick.date === 'string' ? todayPick.date : null;
        const todayKstDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const todayPickId = todayPickDate === todayKstDate
            && typeof todayPick.flightId === 'string'
            && allFlights.some(f => f.id === todayPick.flightId)
            ? todayPick.flightId
            : null;

        // 인터파크 벤치마크 가격 로드 (도시명 기준으로 변환)
        let interparkPrices: Record<string, Record<string, { avg: number; lowest: number }>> = {};
        try {
            const fs3 = require('fs');
            const path3 = require('path');
            const ipPath = path3.join(process.cwd(), 'data', 'interpark-prices.json');
            if (fs3.existsSync(ipPath)) {
                const ipData = JSON.parse(fs3.readFileSync(ipPath, 'utf-8'));
                // 도시코드 → 도시명 역매핑 생성
                const codeToCityName: Record<string, string> = {};
                const allCityNames = new Set<string>();
                allFlights.forEach(f => {
                    if (f.arrival?.city) {
                        const code = resolveCityCode(f.arrival.city, f.arrival.airport);
                        const cityName = f.arrival.city.replace(/\([^)]+\)/, '').trim();
                        if (code && !codeToCityName[code]) {
                            codeToCityName[code] = cityName;
                        }
                        allCityNames.add(cityName);
                    }
                });
                // 인터파크 가격을 도시명 기준으로 변환
                if (ipData.prices) {
                    for (const [cityCode, months] of Object.entries(ipData.prices)) {
                        const cityName = codeToCityName[cityCode];
                        if (cityName && typeof months === 'object') {
                            interparkPrices[cityName] = months as Record<string, { avg: number; lowest: number }>;
                        }
                    }
                }
                // 도시명 별칭 매핑: 같은 공항코드를 공유하는 별칭들에도 동일 데이터 적용
                const cityAliases: Record<string, string[]> = {
                    'HKT': ['푸켓', '푸껫'],
                    'TAG': ['보홀', '보홀팡라오'],
                    'TPE': ['타이페이', '타이베이', '대만'],
                    'RMQ': ['타이중'],
                    'SPK': ['삿포로', '치토세'],
                    'KHH': ['가오슝', '카오슝'],
                    'KLO': ['칼리보', '보라카이'],
                    'HIJ': ['히로시마'],
                };
                for (const [code, aliases] of Object.entries(cityAliases)) {
                    const data = ipData.prices?.[code];
                    if (data && typeof data === 'object') {
                        for (const alias of aliases) {
                            if (allCityNames.has(alias) && !interparkPrices[alias]) {
                                interparkPrices[alias] = data as Record<string, { avg: number; lowest: number }>;
                            }
                        }
                    }
                }
                console.log(`인터파크 벤치마크: ${Object.keys(interparkPrices).length}개 도시 로드`);
            }
        } catch (e) { }

        return NextResponse.json({
            success: true,
            count: allFlights.length,
            flights: allFlights,
            interparkPrices,
            sources: {

                ybtour: allFlights.filter(f => f.source === 'ybtour').length,
                hanatour: allFlights.filter(f => f.source === 'hanatour').length,
                modetour: allFlights.filter(f => f.source === 'modetour').length,
                onlinetour: allFlights.filter(f => f.source === 'onlinetour').length,
                myrealtrip: allFlights.filter(f => f.source === 'myrealtrip').length,
            },
            lastUpdated,
            priceHistory,
            todayPickId,
            todayPickDate,
            filterSummary,
        });
    } catch (error) {
        console.error('항공권 데이터 수집 오류:', error);
        return NextResponse.json(
            { success: false, error: '항공권 데이터를 가져오는 중 오류가 발생했습니다.' },
            { status: 500 }
        );
    }
}
