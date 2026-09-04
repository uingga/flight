import type { Page } from 'playwright';
import type { EnrichData } from './utils/realtime-enrich';
import {
    assertNoSourceAccessBlockText,
    SourceResponseError,
} from './scrapers/source-response';

const TTANG_SCHEDULE_API = 'https://mm.ttang.com/ttangair/search/city/scheduleAct.do';
const TTANG_DETAIL_PAGE = 'https://mm.ttang.com/ttangair/search/city/detail.do';

export interface TtangProductReference {
    masterId: string;
    fareId: string;
    departureDate: string;
    returnDate: string;
    adultCount: number;
    tripDayLabel?: string;
}

function toTime(raw: unknown): string {
    const clean = String(raw || '').replace(/\D/g, '');
    return clean.length >= 4 ? `${clean.slice(0, 2)}:${clean.slice(2, 4)}` : '';
}

function times(info: unknown): { departure: string; arrival: string } {
    const parts = String(info || '').split('||');
    return {
        departure: toTime(parts[1]),
        arrival: toTime(parts[3]),
    };
}

function seats(detail: unknown): number {
    const parts = String(detail || '').split('||');
    for (let index = 0; index < parts.length - 1; index++) {
        if (/^[A-Z]{1,2}$/.test(parts[index]) && /^\d+$/.test(parts[index + 1])) {
            return Number.parseInt(parts[index + 1], 10);
        }
    }
    return 0;
}

function parseJsonPayload(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}

function responseFareId(entry: any): string {
    const direct = entry?.fareRec2 ?? entry?.hanaFareId;
    if (direct !== undefined && direct !== null) return String(direct);
    const fareKey = entry?.fareKey;
    if (fareKey && typeof fareKey === 'object' && fareKey.vNum !== undefined) {
        return String(fareKey.vNum);
    }
    if (typeof fareKey === 'string') {
        try {
            const parsed = JSON.parse(fareKey);
            if (parsed?.vNum !== undefined) return String(parsed.vNum);
        } catch { }
    }
    return '';
}

function responseShape(payload: any, text: string): string {
    if (!String(text || '').trim()) return 'empty-body';
    if (!payload) return `non-json,length=${text.length}`;
    const rootType = Array.isArray(payload) ? 'array' : typeof payload;
    const rootKeys = payload && typeof payload === 'object'
        ? Object.keys(payload).slice(0, 10).join(',') || 'none'
        : 'none';
    const response = payload?.response;
    const responseType = Array.isArray(response)
        ? `array(${response.length})`
        : response === null ? 'null' : typeof response;
    const firstKeys = Array.isArray(response) && response[0] && typeof response[0] === 'object'
        ? Object.keys(response[0]).slice(0, 15).join(',') || 'none'
        : 'none';
    const desc = String(payload?.desc || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'none';
    return `root=${rootType};keys=${rootKeys};code=${String(payload?.code ?? 'none')};desc=${desc};response=${responseType};firstKeys=${firstKeys}`;
}

function compactDate(value: string): string {
    return String(value || '').replace(/\D/g, '').slice(0, 8);
}

/** 실제 카드 클릭 뒤 상세 화면이 사용하는 URL을 재현한다. */
export function buildTtangProductDetailUrl(product: TtangProductReference): string {
    const adultCount = Math.max(1, Math.trunc(Number(product.adultCount) || 1));
    const params = new URLSearchParams({
        tripType: 'RT',
        fromSupplyDate: compactDate(product.departureDate),
        toSupplyDate: compactDate(product.returnDate),
        adtCnt: String(adultCount),
        chdCnt: '0',
        infCnt: '0',
        minAdtCnt: String(adultCount),
        masterId: product.masterId,
        hanaFareId: product.fareId,
    });
    return `${TTANG_DETAIL_PAGE}?${params.toString()}`;
}

/** scheduleAct.do 응답 한 건을 요청한 실제 요금 상품과 대조해 파싱한다. */
export function parseTtangProductSchedule(text: string, expectedFareId: string): EnrichData {
    assertNoSourceAccessBlockText('땡처리닷컴 상품 일정 API', text, TTANG_SCHEDULE_API);
    const payload = parseJsonPayload(text);
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.response)) {
        throw new SourceResponseError(
            'schema-mismatch',
            `땡처리닷컴 상품 일정 응답 형식이 바뀌었습니다 (${responseShape(payload, text)}).`,
        );
    }
    if (payload.code !== 'OK') {
        const code = String(payload.code || 'UNKNOWN');
        const desc = String(payload.desc || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        throw new SourceResponseError(
            'api-error',
            `땡처리닷컴 상품 일정 API가 ${code}${desc ? ` (${desc})` : ''}를 반환했습니다 `
            + `(${responseShape(payload, text)}).`,
            200,
            'application/json',
            code,
            TTANG_SCHEDULE_API,
        );
    }

    const expected = String(expectedFareId);
    const exact = payload.response.find((entry: any) => responseFareId(entry) === expected);
    if (!exact) {
        const returnedFareIds = payload.response
            .map((entry: any) => responseFareId(entry))
            .filter(Boolean)
            .slice(0, 5)
            .join(',') || 'none';
        throw new SourceResponseError(
            'api-error',
            `땡처리닷컴 상품 일정 응답에 요청한 hanaFareId(${expected})가 없습니다 `
            + `(returned=${returnedFareIds}).`,
            200,
            'application/json',
            'FARE_NOT_FOUND',
            TTANG_SCHEDULE_API,
        );
    }

    const outbound = times(exact.skdset1Info);
    const inbound = times(exact.skdset2Info);
    if (!outbound.departure || !outbound.arrival || !inbound.departure || !inbound.arrival) {
        throw new SourceResponseError(
            'schema-mismatch',
            `땡처리닷컴 hanaFareId(${expected}) 일정에 왕복 시간이 없습니다.`,
        );
    }

    return {
        depTime: outbound.departure,
        arrTime: outbound.arrival,
        retDepTime: inbound.departure,
        retArrTime: inbound.arrival,
        seats: seats(exact.skdset1Detail),
    };
}

/**
 * 목록 카드에서 얻은 상품 정보로 실제 상세 화면을 연 뒤, 그 화면의 일정 API를 호출한다.
 * scheduleAct.do는 상세 화면의 조회 문맥과 Referer가 없으면 E001을 반환할 수 있다.
 */
export async function fetchTtangProductScheduleInBrowser(
    page: Page,
    product: TtangProductReference,
): Promise<EnrichData> {
    const detailUrl = buildTtangProductDetailUrl(product);
    const detailResponse = await page.goto(detailUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    if (detailResponse && !detailResponse.ok()) {
        throw new SourceResponseError(
            'http-status',
            `땡처리닷컴 상품 상세 화면 HTTP ${detailResponse.status()}`,
            detailResponse.status(),
            detailResponse.headers()['content-type'] || '',
            undefined,
            detailResponse.url(),
        );
    }
    await page.waitForTimeout(800);
    const detailText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    assertNoSourceAccessBlockText('땡처리닷컴 상품 상세 화면', detailText, page.url());

    // 상세 화면이 상품 식별자를 제공하면 요청 상품이 실제로 남아 있는지 먼저 확인한다.
    // 없어진 상품에는 일정 API를 추가로 보내지 않는다.
    const visibleFareIds = await page.locator('[data-hanafareid]').evaluateAll(elements => (
        elements
            .map(element => element.getAttribute('data-hanafareid') || '')
            .filter(Boolean)
    )).catch(() => [] as string[]);
    if (visibleFareIds.length > 0 && !visibleFareIds.includes(product.fareId)) {
        throw new SourceResponseError(
            'api-error',
            `땡처리닷컴 상세 화면에서 hanaFareId(${product.fareId}) 상품을 찾지 못했습니다.`,
            200,
            'text/html',
            'FARE_NOT_FOUND',
            detailUrl,
        );
    }

    const body = new URLSearchParams({ hanaFareId: product.fareId }).toString();
    const response = await page.evaluate(async ({ apiUrl, requestBody }) => {
        const result = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json,text/plain,*/*',
            },
            body: requestBody,
            credentials: 'include',
        });
        return {
            ok: result.ok,
            status: result.status,
            contentType: result.headers.get('content-type') || '',
            finalUrl: result.url,
            text: await result.text(),
        };
    }, { apiUrl: TTANG_SCHEDULE_API, requestBody: body });

    if (!response.ok) {
        throw new SourceResponseError(
            'http-status',
            `땡처리닷컴 상품 일정 API HTTP ${response.status}`,
            response.status,
            response.contentType,
            undefined,
            response.finalUrl,
        );
    }
    return parseTtangProductSchedule(response.text, product.fareId);
}
