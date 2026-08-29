import { Page } from 'playwright';
import { normalizeAirline } from './flight-helpers';
import { isExplicitAccessRestrictionStatus, SourceResponseError } from '../scrapers/source-response';

/**
 * 땡처리닷컴 realtime_V2 API를 활용한 시간/좌석 데이터 보강 유틸리티
 * 
 * 사용 방법:
 * 1. 아무 ttang.com 페이지를 로드하여 세션 확보
 * 2. enrichWithRealtimeData(page, routes) 호출
 * 3. 반환된 Map에서 노선별 시간/좌석 데이터 조회
 * 
 * realtime_V2 페이지를 로드하면 내부적으로 listAct.do API가 호출되며,
 * 응답의 skdset1Info/skdset2Info (시간)와 skdset1Detail (좌석)을 파싱합니다.
 */

const randomDelay = (min: number, max: number) =>
    new Promise(r => setTimeout(r, (Math.random() * (max - min) + min) * 1000));

/** HHMM → HH:MM */
function toTimeStr(raw: string): string {
    if (!raw || raw.length < 4) return '';
    const clean = raw.replace(/\D/g, '');
    return `${clean.slice(0, 2)}:${clean.slice(2, 4)}`;
}

/** YYYYMMDD → YYYY-MM-DD */
export function toHyphenDate(raw: string): string {
    const clean = raw.replace(/\D/g, '');
    if (clean.length < 8) return raw;
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
}

/**
 * skdset1Detail에서 좌석 수 추출
 * 패턴: ...||classCode(1~2자)||seatCount(숫자)||...
 */
function extractSeatsFromDetail(detail: string): number {
    if (!detail) return 0;
    const parts = detail.split('||');
    for (let i = 0; i < parts.length - 1; i++) {
        if (/^[A-Z]{1,2}$/.test(parts[i]) && /^\d+$/.test(parts[i + 1])) {
            return parseInt(parts[i + 1]);
        }
    }
    return 0;
}

/**
 * skdset1Info에서 출발/도착 시간 추출
 * 형식: "20260415||0905||20260415||1050||PUS||FSZ||..."
 */
function extractTimesFromInfo(info: string): { depTime: string; arrTime: string } {
    if (!info) return { depTime: '', arrTime: '' };
    const parts = info.split('||');
    if (parts.length >= 4) {
        return {
            depTime: toTimeStr(parts[1]),
            arrTime: toTimeStr(parts[3]),
        };
    }
    return { depTime: '', arrTime: '' };
}

export interface RouteKey {
    depCode: string;
    arrCode: string;
    depDate: string; // YYYYMMDD
    arrDate: string; // YYYYMMDD
    /**
     * 이 노선에서 우리가 시각을 알고 싶은 항공사.
     * 한 노선에 여러 항공사가 뜨므로, 이걸 지정하지 않으면 엉뚱한 항공사의
     * 시각을 가져올 수 있다 (인천–간사이 응답 첫 줄은 제주항공인데 우리 표는 피치항공인 식).
     */
    airline?: string;
}

/** skdset1Info에서 항공사명 추출 — "...||ICN||KIX||7C||제주항공||..." */
function extractAirlineFromInfo(info: string): string {
    const parts = (info || '').split('||');
    return (parts[7] || '').trim();
}

/** 노선 단위 키 (항공사 제외) */
function routeIdOf(r: RouteKey): string {
    return `${r.depCode}|${r.arrCode}|${r.depDate}|${r.arrDate}`;
}

/** 보강 결과 조회 키 — 항공사를 아는 경우 항공사까지 포함한다 */
export function enrichKeyOf(r: RouteKey): string {
    const airline = normalizeAirline(r.airline || '');
    return airline ? `${routeIdOf(r)}|${airline}` : routeIdOf(r);
}

export interface EnrichData {
    depTime: string;
    arrTime: string;
    retDepTime: string;
    retArrTime: string;
    seats: number;
}

/**
 * realtime_V2 페이지 로드를 통해 시간/좌석 데이터를 수집
 * @param page Playwright Page (ttang.com 세션이 확보된 상태)
 * @param routes 조회할 노선 목록
 * @param label 로그 라벨 (예: '땡처리', '노랑풍선')
 */
export async function enrichWithRealtimeData(
    page: Page,
    routes: RouteKey[],
    label: string = '보강',
): Promise<Map<string, EnrichData>> {
    const enrichMap = new Map<string, EnrichData>();

    // 같은 노선을 여러 항공사가 함께 요청할 수 있으므로 조회는 노선 단위로 한 번만 한다.
    const byRoute = new Map<string, { route: RouteKey; airlines: Set<string> }>();
    for (const r of routes) {
        const id = routeIdOf(r);
        if (!byRoute.has(id)) byRoute.set(id, { route: r, airlines: new Set() });
        const airline = normalizeAirline(r.airline || '');
        if (airline) byRoute.get(id)!.airlines.add(airline);
    }

    console.log(`[${label}] realtime_V2 보강: ${byRoute.size}개 노선`);

    let enriched = 0;
    let failed = 0;
    let unmatched = 0;
    let empty = 0;
    let idx = 0;
    let consecutiveFailures = 0;
    let skipped = 0;

    // 상대 서버가 막기 시작하면 남은 노선을 계속 두드려도 얻는 것이 없다. 이 횟수만큼
    // 연속으로 실패하면 이번 회차 보강을 접는다. 시각이 없는 항공권도 목록에서 사라지지
    // 않고(카드에서 시간 줄만 비어 있다) 다음 크롤에서 채워진다.
    const MAX_CONSECUTIVE_FAILURES = 8;

    const entries = Array.from(byRoute.entries());

    for (const [routeId, { route, airlines }] of entries) {
        idx++;

        // 'ok'   응답을 정상으로 받아 파싱했다
        // 'empty' 응답은 정상인데 그 노선에 편이 없다 — 서버 잘못이 아니므로 실패로 세지 않는다
        // 'fail'  응답이 없거나 읽을 수 없다 — 이것만 차단 판단에 쓴다
        let outcome: 'ok' | 'empty' | 'fail' = 'fail';

        try {
            const depDateHyphen = toHyphenDate(route.depDate);
            const arrDateHyphen = toHyphenDate(route.arrDate);

            // 응답이 늦게 오는 노선이 적지 않아 넉넉히 기다린다 (5초로는 자주 놓쳤다)
            //
            // 어떤 경로로 끝나든 핸들러를 반드시 뗀다. 예전에는 응답을 받았을 때만 떼어서,
            // 시간 초과가 이어지면 페이지에 핸들러가 그대로 쌓였다 (118노선 연속 실패 시 118개).
            const apiPromise = new Promise<{ status: number; text: string }>((resolve) => {
                let settled = false;
                let timer: ReturnType<typeof setTimeout> | undefined;

                const finish = (status: number, text: string) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    page.off('response', handler);
                    resolve({ status, text });
                };

                const handler = async (res: any) => {
                    if (!res.url().includes('listAct.do')) return;
                    try {
                        finish(res.status(), await res.text());
                    } catch {
                        finish(res.status(), '');
                    }
                };

                timer = setTimeout(() => finish(0, ''), 12000);
                page.on('response', handler);
            });

            const url = `https://mm.ttang.com/ttangair/search/realtime_V2/list.do?trip=RT&dep0=${route.depCode}&arr0=${route.arrCode}&depdate0=${depDateHyphen}&dep1=${route.arrCode}&arr1=${route.depCode}&depdate1=${arrDateHyphen}&adt=1&chd=0&inf=0&comp=Y`;

            const navigationResponse = await page.goto(url, { waitUntil: 'commit', timeout: 15000 }).catch(() => null);
            const apiResponse = await apiPromise;
            if (navigationResponse && isExplicitAccessRestrictionStatus(navigationResponse.status())) {
                throw new SourceResponseError(
                    'http-status',
                    `땡처리닷컴 실시간 페이지 HTTP ${navigationResponse.status()}`,
                    navigationResponse.status(),
                    navigationResponse.headers()['content-type'] || '',
                    undefined,
                    navigationResponse.url(),
                );
            }
            if (isExplicitAccessRestrictionStatus(apiResponse.status)) {
                throw new SourceResponseError(
                    'http-status',
                    `땡처리닷컴 실시간 API HTTP ${apiResponse.status}`,
                    apiResponse.status,
                );
            }

            const jsonMatch = apiResponse.text ? apiResponse.text.match(/\{[\s\S]*\}/) : null;
            const data = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

            if (data?.code === 'OK') {
                outcome = data.response?.length ? 'ok' : 'empty';
            }

            if (outcome === 'ok') {
                // 응답 전체를 항공사별로 정리한다 (같은 항공사는 첫 번째 편을 쓴다)
                const perAirline = new Map<string, EnrichData>();
                for (const entry of data.response) {
                    const info = entry.skdset1Info || '';
                    const outbound = extractTimesFromInfo(info);
                    if (!outbound.depTime) continue;
                    const airline = normalizeAirline(extractAirlineFromInfo(info));
                    if (!airline || perAirline.has(airline)) continue;
                    const inbound = extractTimesFromInfo(entry.skdset2Info || '');
                    perAirline.set(airline, {
                        depTime: outbound.depTime,
                        arrTime: outbound.arrTime,
                        retDepTime: inbound.depTime,
                        retArrTime: inbound.arrTime,
                        seats: extractSeatsFromDetail(entry.skdset1Detail || ''),
                    });
                }

                if (airlines.size > 0) {
                    // 항공사를 아는 경우: 그 항공사 편만 쓴다. 없으면 비워두는 편이
                    // 다른 항공사의 시각을 잘못 붙이는 것보다 낫다.
                    for (const airline of Array.from(airlines)) {
                        const found = perAirline.get(airline);
                        if (found) {
                            enrichMap.set(`${routeId}|${airline}`, found);
                            enriched++;
                        } else {
                            unmatched++;
                        }
                    }
                } else if (perAirline.size === 1) {
                    // 항공사를 모르는 경우엔 응답에 항공사가 하나뿐일 때만 안전하게 채운다.
                    enrichMap.set(routeId, perAirline.values().next().value!);
                    enriched++;
                } else {
                    unmatched++;
                }
            }
        } catch (error) {
            if (error instanceof SourceResponseError && isExplicitAccessRestrictionStatus(error.status)) {
                throw error;
            }
            outcome = 'fail';
        }

        if (outcome === 'fail') {
            failed++;
            consecutiveFailures++;
        } else {
            if (outcome === 'empty') empty++;
            consecutiveFailures = 0;
        }

        if (idx % 20 === 0 || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(`[${label}]   ... ${idx}/${entries.length} (보강: ${enriched}, 실패: ${failed}, 편 없음: ${empty})`);
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            skipped = entries.length - idx;
            console.log(`[${label}] 연속 ${consecutiveFailures}건 실패 — 남은 ${skipped}개 노선은 건너뜁니다. 상대 서버가 막고 있을 가능성이 큽니다.`);
            break;
        }

        // 요청 간격.
        //
        // 예전에는 5건마다 0.2~0.5초만 쉬었고, 실패했을 때는 continue로 이 자리를 아예
        // 건너뛰어 한 번도 쉬지 않았다. 이제는 매 건 쉬고, 연속 실패에는 간격을 배로 늘린다.
        if (idx < entries.length) {
            const wait = consecutiveFailures > 0
                ? Math.min(2 * Math.pow(2, consecutiveFailures - 1), 30)
                : 0.8;
            await randomDelay(wait, wait * 1.6);
        }
    }

    const skipNote = skipped > 0 ? `, 건너뜀 ${skipped}` : '';
    console.log(`[${label}] 보강 완료: ${enriched}건 (조회 ${idx}/${entries.length}노선, 응답 실패 ${failed}, 편 없음 ${empty}, 항공사 불일치 ${unmatched}${skipNote})`);
    return enrichMap;
}

/**
 * 보강 데이터를 Flight 배열에 적용
 */
export function applyEnrichData(
    flights: any[],
    routeKeys: RouteKey[],
    enrichMap: Map<string, EnrichData>,
): number {
    let count = 0;
    for (let i = 0; i < flights.length; i++) {
        const rk = routeKeys[i];
        if (!rk) continue;
        const data = enrichMap.get(enrichKeyOf(rk));

        if (data) {
            if (data.depTime) {
                flights[i].departure.time = data.depTime;
                flights[i].departure.arrivalTime = data.arrTime; // 가는편 도착시간
            }
            if (data.retDepTime) {
                flights[i].arrival.time = data.retDepTime;       // 오는편 출발시간
                flights[i].arrival.arrivalTime = data.retArrTime; // 오는편 도착시간
            }
            if (data.seats > 0 && !flights[i].availableSeats) {
                flights[i].availableSeats = data.seats;
                flights[i].seats = `${data.seats}석`;
            }
            count++;
        }
    }
    return count;
}
