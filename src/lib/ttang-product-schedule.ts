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
    fareType: string;
    carrierCode: string;
    depCode: string;
    arrCode: string;
    departureDate: string;
    arrivalDate: string;
    tripDayLabel?: string;
}

function ymd(value: string): string {
    return String(value || '').replace(/\D/g, '').slice(0, 8);
}

/** 실제 상세 화면이 scheduleAct.do에 보내는 왕복 운임 요청을 재현한다. */
export function buildTtangProductScheduleRequest(product: TtangProductReference): string {
    return new URLSearchParams({
        fareType: product.fareType,
        trip: 'RT',
        dep0: product.depCode,
        arr0: product.arrCode,
        dep1: product.arrCode,
        arr1: product.depCode,
        fareRec1: product.fareId,
        depdate0: ymd(product.departureDate),
        depdate1: ymd(product.arrivalDate),
        hanaFareId: '',
        adt: '1',
        chd: '0',
        inf: '0',
        comp: 'Y',
        car: product.carrierCode,
        invArrDateType: 'ALL',
        popularGubun: '',
    }).toString();
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

/** scheduleAct.do 응답 한 건을 요청한 실제 요금 상품과 대조해 파싱한다. */
export function parseTtangProductSchedule(text: string, expectedFareId: string): EnrichData | null {
    assertNoSourceAccessBlockText('땡처리닷컴 상품 일정 API', text, TTANG_SCHEDULE_API);
    const payload = parseJsonPayload(text);
    if (
        !payload
        || typeof payload !== 'object'
        || Array.isArray(payload)
        || typeof payload.code !== 'string'
        || !payload.code.trim()
    ) {
        throw new SourceResponseError(
            'schema-mismatch',
            '땡처리닷컴 상품 일정 응답 형식이 바뀌었습니다.',
        );
    }
    if (payload.code !== 'OK') {
        const code = payload.code;
        const description = String(payload.desc || '').trim();
        throw new SourceResponseError(
            'api-error',
            `땡처리닷컴 상품 일정 API 오류 ${code}${description ? `: ${description}` : ''}`,
            undefined,
            undefined,
            code,
        );
    }

    if (!Array.isArray(payload.response)) {
        throw new SourceResponseError(
            'schema-mismatch',
            '땡처리닷컴 상품 일정 응답 형식이 바뀌었습니다.',
        );
    }
    if (payload.response.length === 0) return null;

    const expected = String(expectedFareId);
    const exact = payload.response.find((entry: any) => responseFareId(entry) === expected);
    if (!exact) {
        throw new SourceResponseError(
            'schema-mismatch',
            `땡처리닷컴 상품 일정 응답에 요청한 fareRec1(${expected})가 없습니다.`,
        );
    }

    const outbound = times(exact.skdset1Info);
    const inbound = times(exact.skdset2Info);
    if (!outbound.departure || !outbound.arrival || !inbound.departure || !inbound.arrival) {
        throw new SourceResponseError(
            'schema-mismatch',
            `땡처리닷컴 fareRec1(${expected}) 일정에 왕복 시간이 없습니다.`,
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
 * 목록 카드에서 얻은 운임 ID를 사이트와 같은 fareRec1 필드에 넣어 시간·좌석을 읽는다.
 * setting/detail 화면을 다시 열지 않아 상품당 일정 API 요청은 한 번뿐이다.
 */
export async function fetchTtangProductScheduleInBrowser(
    page: Pick<Page, 'evaluate'>,
    product: TtangProductReference,
): Promise<EnrichData | null> {
    const body = buildTtangProductScheduleRequest(product);
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
