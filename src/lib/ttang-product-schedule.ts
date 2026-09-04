import type { Page } from 'playwright';
import type { EnrichData } from './utils/realtime-enrich';
import {
    assertNoSourceAccessBlockText,
    SourceResponseError,
} from './scrapers/source-response';

const TTANG_SCHEDULE_API = 'https://mm.ttang.com/ttangair/search/city/scheduleAct.do';

export interface TtangProductReference {
    masterId: string;
    fareId: string;
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
    return `root=${rootType};keys=${rootKeys};code=${String(payload?.code ?? 'none')};response=${responseType};firstKeys=${firstKeys}`;
}

/** scheduleAct.do 응답 한 건을 요청한 실제 요금 상품과 대조해 파싱한다. */
export function parseTtangProductSchedule(text: string, expectedFareId: string): EnrichData {
    assertNoSourceAccessBlockText('땡처리닷컴 상품 일정 API', text, TTANG_SCHEDULE_API);
    const payload = parseJsonPayload(text);
    if (!payload || payload.code !== 'OK' || !Array.isArray(payload.response)) {
        throw new SourceResponseError(
            'schema-mismatch',
            `땡처리닷컴 상품 일정 응답 형식이 바뀌었습니다 (${responseShape(payload, text)}).`,
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
            'schema-mismatch',
            `땡처리닷컴 상품 일정 응답에 요청한 hanaFareId(${expected})가 없습니다 `
            + `(returned=${returnedFareIds}).`,
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
 * 목록 카드에서 얻은 hanaFareId를 사용해 정확한 요금 한 건의 시간·좌석을 읽는다.
 * setting/detail 화면을 다시 열지 않아 상품당 사이트 요청은 한 번뿐이다.
 */
export async function fetchTtangProductScheduleInBrowser(
    page: Pick<Page, 'evaluate'>,
    product: TtangProductReference,
): Promise<EnrichData> {
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
