import type { Flight } from '../../types/flight';
import { getRegionByCity } from '../utils/region-mapper';
import { CITY_TO_AIRPORT, normalizeCity } from '../utils/flight-helpers';
import { assertNoSourceAccessBlockText, SourceResponseError } from './source-response';

const ORIGIN = 'https://m.lottetour.com';
type Row = Record<string, unknown>;
const fail = (message: string): never => { throw new SourceResponseError('schema-mismatch', `롯데관광: ${message}`); };
function row(value: unknown): Row {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('객체 응답이 아닙니다');
    return value as Row;
}
function nested(value: unknown): unknown {
    try { return typeof value === 'string' ? JSON.parse(value) : value; }
    catch { return fail('내부 JSON 형식 변경'); }
}
export function parseLotteEnvelope(text: string): Row {
    assertNoSourceAccessBlockText('롯데관광', text);
    let data: Row;
    try { data = row(JSON.parse(text)); } catch { return fail('JSON 응답이 아닙니다'); }
    if (data.result !== true) return fail('조회 실패 응답');
    return data;
}
export function lotteRows(data: Row, key: string): Row[] {
    const rows = nested(data[key]);
    if (!Array.isArray(rows)) return fail(`${key} 목록 없음`);
    return rows.map(row);
}
function number(value: unknown): number {
    if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))) return fail('금액/좌석/식별자 형식 변경');
    const n = Number(value);
    if (!Number.isSafeInteger(n)) return fail('숫자 범위 오류');
    return n;
}
function id(value: unknown): string {
    const s = String(value ?? '');
    if (!/^[A-Za-z0-9_-]+$/.test(s)) return fail('상품 식별자 없음');
    return s;
}
function date(value: unknown): string {
    const s = String(value ?? '').replace(/[.\-]/g, '');
    if (!/^\d{8}$/.test(s)) return fail('날짜 형식 변경');
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
    const time = Date.parse(iso);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== iso) return fail('유효하지 않은 날짜');
    return iso;
}
function clock(value: unknown): string {
    const s = String(value ?? '');
    if (!/^(?:[01]\d|2[0-3])[0-5]\d$/.test(s)) return fail('시간 형식 변경');
    return `${s.slice(0, 2)}:${s.slice(2)}`;
}
function city(value: unknown): string {
    const s = String(value ?? '').replace(/공항$/, '');
    const aliases: Record<string, string> = { 부산김해: '부산', 김해: '부산', 인천국제: '인천', 김포국제: '김포' };
    return normalizeCity(aliases[s] || s);
}

/** Only verified round trips; list minimum prices and trip lengths never supply missing dates. */
export function parseLotteFlight(group: Row, line: Row, response: Row, checkedAt: string): Flight | null {
    const detail = row(nested(response.disPriceLow));
    for (const key of ['evtCd', 'blockId', 'blockDetlId']) if (id(line[key]) !== id(detail[key])) return fail('다른 상품의 상세 응답');
    if (id(line.blockId) !== id(group.blockId)) return fail('다른 노선의 날짜 응답');
    const seats = number(detail.avlbSeatCnt);
    if (seats < 2) return null;
    const schedule = lotteRows(response, 'disSchedule');
    const outbound = schedule.filter(s => s.arrvYn === 'N'), inbound = schedule.filter(s => s.arrvYn === 'Y');
    if (schedule.length !== 2 || outbound.length !== 1 || inbound.length !== 1) return fail('직항 왕복 일정 확인 불가');
    const out = outbound[0], back = inbound[0];
    const departure = city(out.depApoNm), arrival = city(out.arrApoNm);
    if (departure !== city(back.arrApoNm) || arrival !== city(back.depApoNm)
        || departure !== city(group.departAirApoNm) || arrival !== city(group.destAirApoNm)) return fail('왕복 노선 불일치');
    const depAirport = CITY_TO_AIRPORT[departure], arrAirport = id(group.destCd);
    if (!depAirport || !/^[A-Z]{3}$/.test(arrAirport) || CITY_TO_AIRPORT[arrival] !== arrAirport) return fail('공항 확인 불가');
    const departDate = date(out.dcDep), returnDate = date(back.dcDep);
    if (date(line.departDt) !== departDate || date(line.retnDt) !== returnDate || date(detail.departDt) !== departDate
        || returnDate < departDate || date(out.dcArr) < departDate || date(back.dcArr) < returnDate) return fail('왕복 날짜 불일치');
    const price = number(detail.priceAdt);
    const components = ['pricPdtAdt', 'pricFueAdt', 'pricTaxAdt', 'pricChargeAdt'].map(key => number(detail[key]));
    if (price <= 0 || components.reduce((sum, n) => sum + n, 0) !== price) return fail('성인 총액과 요금 구성 불일치');
    if (typeof out.carrerNm !== 'string' || !out.carrerNm || out.carrerNm !== back.carrerNm) return fail('항공사 확인 불가');
    return {
        id: `lottetour-${id(detail.evtCd)}`, source: 'lottetour', airline: out.carrerNm,
        departure: { city: departure, airport: depAirport, date: departDate, time: clock(out.depTm), arrivalTime: clock(out.arrTm) },
        arrival: { city: arrival, airport: arrAirport, date: returnDate, time: clock(back.depTm), arrivalTime: clock(back.arrTm) },
        price, currency: 'KRW', availableSeats: seats, flightNumber: `${id(out.fltNm)}/${id(back.fltNm)}`,
        minPax: 2, // Published discountAir fare rules: minimum two adults; no booking is submitted here.
        region: getRegionByCity(arrival),
        link: `${ORIGIN}/discountAir#tr__${id(group.blockId)}`, searchLink: `${ORIGIN}/discountAir`,
        priceCheckedAt: checkedAt, detailCheckedAt: checkedAt,
        routeAirports: { outboundDeparture: depAirport, outboundArrival: arrAirport, returnDeparture: arrAirport, returnArrival: depAirport },
    };
}

export async function scrapeLottetour(options: { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => Date } = {}): Promise<Flight[]> {
    const fetcher = options.fetcher || fetch;
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    let requests = 0;
    const request = async (endpoint: string, params: Record<string, string>) => {
        if (++requests > 80) throw new SourceResponseError('snapshot-changed', '롯데관광: 회차 요청 상한 초과, 부분 결과 폐기');
        if (requests > 1) await sleep(1500 + Math.floor(Math.random() * 1000));
        const url = new URL(`/discountAir/${endpoint}`, ORIGIN);
        url.search = new URLSearchParams(params).toString();
        // Public read-only POST used by the listing; no booking/checkout endpoint and no retries.
        const res = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
            headers: { Accept: 'application/json, text/plain, */*', Referer: `${ORIGIN}/discountAir` } });
        if (!res.ok) throw new SourceResponseError('http-status', `롯데관광 HTTP ${res.status}`, res.status);
        const text = await res.text();
        if (text.length > 2_000_000) return fail('응답 크기 초과');
        return parseLotteEnvelope(text);
    };
    const groups = lotteRows(await request('disPriceList', { destCd: '', areaMcCd: '' }), 'disPriceList');
    const flights: Flight[] = [], seenGroups = new Set<string>(), seenOffers = new Set<string>();
    const checkedAt = (options.now?.() || new Date()).toISOString();
    for (const group of groups) {
        const blockId = id(group.blockId);
        if (seenGroups.has(blockId)) return fail('중복 노선 응답');
        seenGroups.add(blockId);
        const lines = lotteRows(await request('disPriceLine', { blockId }), 'disPriceLine');
        if (!lines.length) return fail('노선은 있으나 날짜 목록 없음');
        for (const line of lines) {
            const evtCd = id(line.evtCd), blockDetlId = id(line.blockDetlId);
            if (id(line.blockId) !== blockId || seenOffers.has(evtCd)) return fail('중복/잘못된 상품 응답');
            seenOffers.add(evtCd);
            if (number(line.avlbSeatCnt) < 2 || date(line.departDt) < new Date(Date.parse(checkedAt) + 9 * 3600000).toISOString().slice(0, 10)) continue;
            const detail = await request('disPriceLow', { evtCd, blockId, blockDetlId });
            const flight = parseLotteFlight(group, line, detail, checkedAt);
            if (flight) flights.push(flight);
        }
    }
    return flights;
}
