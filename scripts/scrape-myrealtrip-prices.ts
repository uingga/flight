import { chromium, Browser, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { scrapeMyrealtrip } from '../src/lib/scrapers/myrealtrip';

/**
 * 마이리얼트립 실제 가격 스크래핑 (Playwright)
 *
 * 1단계: Calendar API로 항공편 목록 갱신 (새 항공편 추가 + 없어진 항공편 제거)
 * 2단계: offers.k1 페이지에서 검색 결과의 실제 최저가를 추출
 * - "석 남음" 텍스트 근처의 가격 = 유저가 보는 실제 가격
 * - 2개 병렬 실행, 랜덤 딜레이 + 셔플로 감지 회피
 * - 하루 1회 새벽 3시 실행 권장
 *
 * 사용법: npx tsx scripts/scrape-myrealtrip-prices.ts
 */

interface CachedFlight {
    id: string;
    source: string;
    price: number;
    airline: string;
    arrival: { airport: string; city: string; date: string };
    departure: { airport: string; city: string; date: string };
    link: string;
    [key: string]: any;
}

// ── 유틸리티 ──────────────────────────────────────────

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const randomDelay = () => delay(1000 + Math.random() * 4000); // 1~5초 랜덤
function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── GID 맵 로드 ──────────────────────────────────────────

function loadGidMap(): Record<string, number> {
    try {
        const raw = fs.readFileSync(path.resolve(process.cwd(), 'data/gid-map.json'), 'utf8');
        const parsed = JSON.parse(raw);
        const map: Record<string, number> = {};
        for (const [code, val] of Object.entries(parsed)) {
            if (typeof val === 'number') map[code] = val;
            else if (typeof val === 'object' && val && 'gid' in val) map[code] = (val as any).gid;
        }
        return map;
    } catch {
        return {};
    }
}

// ── 가격 추출 (직항만, 항공사+시간 포함) ──────────────────

interface FlightResult {
    price: number;
    airline: string;
    depTime: string;      // 가는편 출발
    arrTime: string;      // 가는편 도착
    duration: string;     // 가는편 비행시간
    retDepTime: string;   // 오는편 출발
    retArrTime: string;   // 오는편 도착
    retDuration: string;  // 오는편 비행시간
}

async function getSearchPrice(page: Page, gid: number, depDate: string, arrDate: string): Promise<FlightResult | null> {
    const url = `https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=${gid}&depdt=${depDate}&arrdt=${arrDate}&cabin=Y&adult=1&child=0&infant=0`;

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(10000 + Math.random() * 4000); // 10~14초 대기

        // 검색 결과 카드에서 항공편 추출 (직항 우선, 없으면 경유 포함)
        const results: FlightResult[] = await page.evaluate(() => {
            const directFlights: { price: number; airline: string; depTime: string; arrTime: string; duration: string; retDepTime: string; retArrTime: string; retDuration: string }[] = [];
            const allFlights: typeof directFlights = [];

            document.querySelectorAll('*').forEach(el => {
                const t = (el as HTMLElement).innerText || '';

                // 검색 결과 카드: "석 남음" + "원" 포함
                if (t.includes('석 남음') && t.includes('원') && t.length > 50 && t.length < 500) {
                    // 가격 추출
                    const priceMatch = t.match(/([\d,]+)원/);
                    if (!priceMatch) return;
                    const price = parseInt(priceMatch[1].replace(/,/g, ''));
                    if (price < 100000 || price > 5000000) return;

                    // 항공사 추출
                    const lines = t.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    let airline = '';
                    for (const line of lines) {
                        if (line.includes('항공') || line.includes('에어') || line.includes('진에어') || line.includes('이스타')) {
                            airline = line.replace(/브랜드관.*/, '').trim();
                            break;
                        }
                    }
                    if (!airline) {
                        for (const line of lines) {
                            if (line.length >= 2 && line.length <= 20 && !line.includes('원') && !line.includes('남음') && !line.includes('카드')) {
                                airline = line;
                                break;
                            }
                        }
                    }

                    // 시간 추출 (HH:MM 패턴)
                    const timeMatches = t.match(/(\d{2}:\d{2})/g) || [];
                    const depTime = timeMatches[0] || '';
                    const arrTime = timeMatches[1] || '';
                    const retDepTime = timeMatches[2] || '';
                    const retArrTime = timeMatches[3] || '';

                    // 비행시간 추출
                    const durMatches = t.match(/(\d+시간\s*\d+분)/g) || [];
                    const duration = durMatches[0] || '';
                    const retDuration = durMatches[1] || '';

                    const flight = { price, airline, depTime, arrTime, duration, retDepTime, retArrTime, retDuration };

                    // 직항/경유 분류
                    const isDirect = t.includes('직항') && !t.includes('경유') && !t.includes('1회') && !t.includes('2회');
                    if (isDirect) {
                        if (!directFlights.some(f => f.price === price)) directFlights.push(flight);
                    }
                    if (!allFlights.some(f => f.price === price)) allFlights.push(flight);
                }
            });

            // 직항 우선, 없으면 전체에서 최저가
            const target = directFlights.length > 0 ? directFlights : allFlights;
            target.sort((a, b) => a.price - b.price);
            return target.slice(0, 3);
        });

        if (results.length === 0) return null;
        return results[0]; // 직항 최저가
    } catch {
        return null;
    }
}

// ── 병렬 워커 ──────────────────────────────────────────

async function worker(
    browser: Browser,
    tasks: { flight: CachedFlight; gid: number }[],
    results: Map<string, { price: number; airline: string }>,
    workerId: number
) {
    const page = await browser.newPage();

    // 랜덤 User-Agent
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    ];
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8' });

    for (let i = 0; i < tasks.length; i++) {
        const { flight, gid } = tasks[i];
        const depDate = flight.departure.date;
        const arrDate = flight.arrival.date;

        if (!depDate || !arrDate) continue;

        const result = await getSearchPrice(page, gid, depDate, arrDate);
        if (result) {
            results.set(flight.id, result);
        }

        // 진행률 (워커별)
        if ((i + 1) % 20 === 0) {
            console.log(`  [워커${workerId}] ${i + 1}/${tasks.length} 완료`);
        }

        // 랜덤 딜레이
        await randomDelay();
    }

    await page.close();
}

// ── 메인 ──────────────────────────────────────────

async function main() {
    const startTime = Date.now();
    console.log('=== 마이리얼트립 크롤링 시작 ===');
    console.log(`시작: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n`);

    // ── 1단계: Calendar API로 항공편 목록 갱신 ──────────────────
    console.log('📡 1단계: Calendar API로 최신 항공편 목록 수집...\n');
    const freshFlights = await scrapeMyrealtrip();
    console.log(`\n📡 Calendar API 결과: ${freshFlights.length}개 항공편 수집`);

    // 캐시 로드 & MRT 데이터 교체
    const cachePath = path.resolve(process.cwd(), 'data/all-flights-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

    const prevMrtCount = cache.flights.filter((f: any) => f.source === 'myrealtrip').length;

    // 안전장치: Calendar API 결과가 기존 대비 50% 미만이면 교체하지 않음
    if (freshFlights.length > 0 && (prevMrtCount === 0 || freshFlights.length >= prevMrtCount * 0.5)) {
        cache.flights = cache.flights.filter((f: any) => f.source !== 'myrealtrip');
        cache.flights.push(...freshFlights);
        console.log(`♻️ MRT 캐시 교체: ${prevMrtCount}개 → ${freshFlights.length}개`);
    } else {
        console.log(`⚠️ Calendar API 결과(${freshFlights.length}개)가 기존(${prevMrtCount}개)의 50% 미만 → 교체 건너뜀, 기존 데이터 유지`);
    }

    // 출발일 60일 초과 마이리얼트립 항공편 제거 (티키티킷에 표시하지 않음)
    const MAX_DAYS = parseInt(process.env.MAX_DAYS_AHEAD || '60', 10);
    const nowDate = new Date();
    const cutoff = new Date(nowDate.getTime() + MAX_DAYS * 24 * 60 * 60 * 1000);
    const beforeCutoff = cache.flights.length;
    cache.flights = cache.flights.filter((f: any) => {
        if (f.source !== 'myrealtrip') return true;
        const dep = new Date(f.departure?.date);
        return dep >= nowDate && dep <= cutoff;
    });
    const removedByDate = beforeCutoff - cache.flights.length;
    if (removedByDate > 0) {
        console.log(`📅 출발 ${MAX_DAYS}일 초과 항공편 제거: ${removedByDate}개 (${beforeCutoff} → ${cache.flights.length})`);
    }

    // 중간 저장 (Playwright 실패해도 최소한 Calendar 가격은 반영)
    cache.count = cache.flights.length;
    cache.lastUpdated = new Date().toISOString();
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    console.log('💾 Calendar API 가격으로 중간 저장 완료\n');

    // ── 2단계: Playwright로 실제 가격 보정 ──────────────────
    console.log('🎭 2단계: Playwright로 실제 가격 보정 시작...\n');

    const mrtFlights: CachedFlight[] = cache.flights.filter((f: any) => f.source === 'myrealtrip');
    const gidMap = loadGidMap();

    // gid 있는 노선만 (링크가 정확한 노선)
    const now = new Date();

    const tasks = mrtFlights
        .filter(f => {
            if (!gidMap[f.arrival.airport] || !f.departure.date || !f.arrival.date) return false;
            const depDate = new Date(f.departure.date);
            if (depDate < now) return false;       // 이미 지난 항공편 제외
            return true;
        })
        .map(f => ({ flight: f, gid: gidMap[f.arrival.airport] }));

    console.log(`대상: ${tasks.length}개 노선 (gid 있는 마이리얼트립 항공편)`);
    // 셔플 (순서 랜덤화)
    const shuffled = shuffle(tasks);

    // 2개 병렬로 분배
    const WORKERS = 2;
    const chunks: typeof tasks[] = Array.from({ length: WORKERS }, () => []);
    shuffled.forEach((task, i) => chunks[i % WORKERS].push(task));

    console.log(`병렬: ${WORKERS}개 워커 (각 ${chunks[0].length}~${chunks[chunks.length-1].length}개)\n`);

    // 브라우저 실행
    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
    });

    const results = new Map<string, { price: number; airline: string }>();

    // 1차 실행
    await Promise.all(
        chunks.map((chunk, i) => worker(browser, chunk, results, i + 1))
    );

    await browser.close();

    // 2차 재시도: 실패한 노선만
    const failedTasks = tasks.filter(t => !results.has(t.flight.id));
    if (failedTasks.length > 0 && failedTasks.length < tasks.length) {
        console.log(`\n🔄 ${failedTasks.length}개 실패 노선 재시도 중...\n`);
        const retryBrowser = await chromium.launch({
            headless: true,
            args: ['--disable-blink-features=AutomationControlled'],
        });
        const retryChunks: typeof tasks[] = Array.from({ length: WORKERS }, () => []);
        shuffle(failedTasks).forEach((task, i) => retryChunks[i % WORKERS].push(task));
        await Promise.all(
            retryChunks.map((chunk, i) => worker(retryBrowser, chunk, results, i + 10))
        );
        await retryBrowser.close();
        const recovered = failedTasks.length - tasks.filter(t => !results.has(t.flight.id)).length;
        console.log(`✅ 재시도 결과: ${recovered}개 복구 성공`);
    }

    // 캐시 업데이트
    let updated = 0;
    let priceUp = 0;
    let priceDown = 0;
    let removed = 0;

    for (const [flightId, result] of results) {
        const idx = cache.flights.findIndex((f: any) => f.id === flightId);
        if (idx >= 0) {
            const oldPrice = cache.flights[idx].price;
            cache.flights[idx].price = result.price;
            cache.flights[idx].airline = result.airline || cache.flights[idx].airline;
            cache.flights[idx].departure.time = result.depTime;
            cache.flights[idx].arrival.time = result.arrTime;
            cache.flights[idx].duration = result.duration;
            cache.flights[idx].returnDeparture = result.retDepTime;
            cache.flights[idx].returnArrival = result.retArrTime;
            cache.flights[idx].returnDuration = result.retDuration;

            const diff = Math.abs(result.price - oldPrice);
            if (diff > 5000) {
                if (result.price > oldPrice) priceUp++;
                else priceDown++;
            }
            updated++;
        }
    }

    // Playwright 가격 조회 실패한 노선 = 실제 항공권 없을 가능성 높으므로 삭제
    let skipped = 0;
    const failedIds = new Set<string>();
    for (const task of tasks) {
        if (!results.has(task.flight.id)) {
            skipped++;
            failedIds.add(task.flight.id);
        }
    }
    if (skipped > 0) {
        cache.flights = cache.flights.filter((f: any) => !failedIds.has(f.id));
        console.log(`\n🗑️ ${skipped}개 노선 Playwright 조회 실패 → 캐시에서 삭제 (예약 불가 가능성 높음)`);
    }

    // ── 인터파크 벤치마크 필터링 ──────────────────────────────
    console.log(`\n=== 인터파크 가격 벤치마크 ===`);
    const benchmarkPath = path.resolve(process.cwd(), 'data/interpark-prices.json');
    let benchmarkFiltered = 0;
    try {
        if (fs.existsSync(benchmarkPath)) {
            const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
            const cacheAge = Date.now() - new Date(benchmark.timestamp).getTime();
            console.log(`♻️ 인터파크 캐시 사용 (${Math.round(cacheAge / 3600000)}시간 전)`);

            // CITY_TO_AIRPORT 간단 매핑 (resolveCityCode 대용)
            const { resolveCityCode } = await import('../src/lib/scrapers/interpark');

            const beforeFilter = cache.flights.length;
            cache.flights = cache.flights.filter((f: any) => {
                if (f.source !== 'myrealtrip') return true; // 다른 소스는 건드리지 않음

                const cityCode = resolveCityCode(f.arrival?.city || '', f.arrival?.airport);
                if (!cityCode) return true;

                const depDate = f.departure?.date || '';
                const dateStr = depDate.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
                const dateMatch = dateStr.match(/^(\d{4})-(\d{2})/);
                if (!dateMatch) return true;

                const yearMonth = `${dateMatch[1]}-${dateMatch[2]}`;
                const cityPrices = benchmark.prices?.[cityCode];
                if (!cityPrices || !cityPrices[yearMonth]) return true;

                const interparkAvg = cityPrices[yearMonth].avg;
                if (f.price > interparkAvg) {
                    console.log(`  ❌ 필터: ${f.arrival?.city} ${yearMonth} ${f.price.toLocaleString()}원 > 인터파크 평균 ${interparkAvg.toLocaleString()}원`);
                    return false;
                }

                // 할인율 계산
                const interparkLowest = cityPrices[yearMonth].lowest;
                f.discountRate = interparkLowest > 0
                    ? Math.round((1 - f.price / interparkLowest) * 100)
                    : 0;

                return true;
            });
            benchmarkFiltered = beforeFilter - cache.flights.length;
            console.log(`📊 인터파크 기준 필터: ${benchmarkFiltered}개 제거 (${beforeFilter} → ${cache.flights.length})`);
        } else {
            console.log('⚠️ interpark-prices.json 없음 → 필터링 건너뜀');
        }
    } catch (e) {
        console.error('⚠️ 인터파크 벤치마크 실패:', e);
    }

    // ── 네이버 최저가 비교 필터링 (비활성화) ──────────────────────────────
    // console.log(`\n=== 네이버 최저가 비교 ===`);
    // 네이버 필터 일시 중단

    // 저장
    cache.count = cache.flights.length;
    cache.lastUpdated = new Date().toISOString();
    fs.writeFileSync(cachePath, JSON.stringify(cache));

    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    console.log(`\n=== 스크래핑 완료 ===`);
    console.log(`소요: ${elapsed}분`);
    console.log(`검증: ${results.size}/${tasks.length}개 성공`);
    console.log(`보정: ${updated}개 (↑${priceUp} ↓${priceDown})`);
    console.log(`실패: ${tasks.length - results.size}개`);
    if (benchmarkFiltered > 0) console.log(`인터파크 필터: ${benchmarkFiltered}개 제거`);
    if (naverFiltered > 0) console.log(`네이버 필터: ${naverFiltered}개 제거`);
}

main().catch(console.error);
