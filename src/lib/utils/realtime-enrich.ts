import { Page } from 'playwright';

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

    // 고유 노선만 조회
    const uniqueRoutes = new Map<string, RouteKey>();
    for (const r of routes) {
        const key = `${r.depCode}|${r.arrCode}|${r.depDate}|${r.arrDate}`;
        if (!uniqueRoutes.has(key)) uniqueRoutes.set(key, r);
    }

    console.log(`[${label}] realtime_V2 보강: ${uniqueRoutes.size}개 노선`);

    let enriched = 0;
    let failed = 0;
    let idx = 0;

    for (const [key, route] of Array.from(uniqueRoutes.entries())) {
        idx++;
        try {
            const depDateHyphen = toHyphenDate(route.depDate);
            const arrDateHyphen = toHyphenDate(route.arrDate);

            // API 응답을 Promise로 대기 (타임아웃 5초)
            const apiPromise = new Promise<string>((resolve) => {
                const timer = setTimeout(() => resolve(''), 5000);
                const handler = async (res: any) => {
                    if (res.url().includes('listAct.do')) {
                        try {
                            const text = await res.text();
                            clearTimeout(timer);
                            page.off('response', handler);
                            resolve(text);
                        } catch { resolve(''); }
                    }
                };
                page.on('response', handler);
            });

            const url = `https://mm.ttang.com/ttangair/search/realtime_V2/list.do?trip=RT&dep0=${route.depCode}&arr0=${route.arrCode}&depdate0=${depDateHyphen}&dep1=${route.arrCode}&arr1=${route.depCode}&depdate1=${arrDateHyphen}&adt=1&chd=0&inf=0&comp=Y`;

            page.goto(url, { waitUntil: 'commit', timeout: 8000 }).catch(() => {});
            const apiResponse = await apiPromise;

            if (!apiResponse) { failed++; continue; }

            const jsonMatch = apiResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) { failed++; continue; }

            const data = JSON.parse(jsonMatch[0]);
            if (data.code !== 'OK' || !data.response?.length) continue;

            const first = data.response[0];
            const outbound = extractTimesFromInfo(first.skdset1Info || '');
            const inbound = extractTimesFromInfo(first.skdset2Info || '');
            const seats = extractSeatsFromDetail(first.skdset1Detail || '');

            if (outbound.depTime || seats > 0) {
                enrichMap.set(key, {
                    depTime: outbound.depTime,
                    arrTime: outbound.arrTime,
                    retDepTime: inbound.depTime,
                    retArrTime: inbound.arrTime,
                    seats,
                });
                enriched++;
            }

        } catch (error) {
            failed++;
        }

        if (idx % 5 === 0) {
            await randomDelay(0.2, 0.5);
        }
        if (idx % 20 === 0) {
            console.log(`[${label}]   ... ${idx}/${uniqueRoutes.size} (보강: ${enriched}, 실패: ${failed})`);
        }
    }

    console.log(`[${label}] 보강 완료: ${enriched}/${uniqueRoutes.size} (실패: ${failed})`);
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
        const enrichKey = `${rk.depCode}|${rk.arrCode}|${rk.depDate}|${rk.arrDate}`;
        const data = enrichMap.get(enrichKey);

        if (data) {
            if (data.depTime) {
                flights[i].departure.time = data.depTime;
                flights[i].arrival.time = data.arrTime;
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
