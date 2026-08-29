export type SourceResponseFailureKind =
    | 'network'
    | 'http-status'
    | 'unexpected-content'
    | 'html-response'
    | 'malformed-jsonp'
    | 'malformed-xml'
    | 'malformed-json'
    | 'api-error'
    | 'snapshot-changed'
    | 'schema-mismatch';

export class SourceResponseError extends Error {
    constructor(
        readonly kind: SourceResponseFailureKind,
        message: string,
        readonly status?: number,
        readonly contentType?: string,
        readonly causeCode?: string,
        readonly finalUrl?: string,
        readonly attempts = 1,
    ) {
        super(message);
        this.name = 'SourceResponseError';
    }
}

export function isExplicitAccessRestrictionStatus(status: unknown): boolean {
    const numericStatus = Number(status || 0);
    return numericStatus === 401 || numericStatus === 403 || numericStatus === 429;
}

/** HTTP 200으로 위장된 CAPTCHA·WAF 안내도 정상 목록으로 해석하지 않는다. */
export function assertNoSourceAccessBlockText(
    label: string,
    text: string,
    finalUrl?: string,
): void {
    const normalized = String(text || '').replace(/\s+/g, ' ').slice(0, 20_000);
    if (!/(?:captcha|access denied|request blocked|temporarily blocked|unusual traffic|비정상(?:적인)?\s*접근|자동화(?:된)?\s*요청|접근이?\s*제한|서비스\s*이용이?\s*제한)/i.test(normalized)) {
        return;
    }

    throw new SourceResponseError(
        'html-response',
        `${label} 접근 제한 안내가 반환되었습니다.`,
        200,
        'text/html',
        undefined,
        finalUrl,
    );
}

function sourceErrorCause(error: unknown): { reason: string; code?: string } {
    const messages: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;
    let code: string | undefined;

    for (let depth = 0; current && depth < 4 && !seen.has(current); depth++) {
        seen.add(current);
        if (current instanceof Error) {
            if (current.message && !messages.includes(current.message)) messages.push(current.message);
            const candidate = current as Error & { code?: unknown; cause?: unknown };
            if (!code && typeof candidate.code === 'string') code = candidate.code;
            current = candidate.cause;
        } else {
            const value = String(current);
            if (value && !messages.includes(value)) messages.push(value);
            break;
        }
    }

    return {
        reason: messages.join(' <- ') || '알 수 없는 네트워크 오류',
        code,
    };
}

export interface SourceTextResponse {
    text: string;
    status: number;
    contentType: string;
    finalUrl: string;
}

export async function fetchSourceText(
    label: string,
    url: string | URL,
    init: RequestInit = {},
    timeoutMs = 20_000,
): Promise<SourceTextResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    let text: string;
    try {
        response = await fetch(url, { ...init, signal: controller.signal });
        text = await response.text();
    } catch (error) {
        const cause = sourceErrorCause(error);
        throw new SourceResponseError(
            'network',
            `${label} 요청 실패: ${cause.reason}`,
            undefined,
            undefined,
            cause.code,
            String(url),
        );
    } finally {
        clearTimeout(timeout);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
        throw new SourceResponseError(
            'http-status',
            `${label} HTTP ${response.status} (content-type: ${contentType || '없음'})`,
            response.status,
            contentType,
            undefined,
            response.url,
        );
    }

    return {
        text,
        status: response.status,
        contentType,
        finalUrl: response.url,
    };
}

export interface SourceRetryOptions {
    maxAttempts?: number;
    delaysMs?: number[];
    onRetry?: (error: SourceResponseError, nextAttempt: number) => void;
}

export function isRetryableSourceError(error: unknown): error is SourceResponseError {
    if (!(error instanceof SourceResponseError)) return false;
    if (error.kind === 'network') return true;
    if (error.kind !== 'http-status' && error.kind !== 'api-error') return false;
    const status = Number(error.status || 0);
    // 429는 단순 전송 오류가 아니라 여행사가 보내는 명시적인 감속 신호다.
    // 같은 회차에서는 재시도하지 않고, 소스별 24시간 휴식 회로에 맡긴다.
    return status === 408 || status === 425 || status >= 500;
}

/** 일시적인 전송/API 오류만 제한적으로 다시 시도하고, 형식 변경은 즉시 드러낸다. */
export async function retrySourceOperation<T>(
    _label: string,
    operation: (attempt: number) => Promise<T>,
    options: SourceRetryOptions = {},
): Promise<T> {
    const maxAttempts = Math.max(1, options.maxAttempts || 3);
    const delaysMs = options.delaysMs || [500, 1_500];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation(attempt);
        } catch (error) {
            if (!isRetryableSourceError(error) || attempt >= maxAttempts) {
                if (error instanceof SourceResponseError && attempt > 1) {
                    throw new SourceResponseError(
                        error.kind,
                        error.message,
                        error.status,
                        error.contentType,
                        error.causeCode,
                        error.finalUrl,
                        attempt,
                    );
                }
                throw error;
            }

            options.onRetry?.(error, attempt + 1);
            const delayMs = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] || 0;
            if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    throw new Error('도달할 수 없는 재시도 상태');
}

function decodeHtml(value: string): string {
    return value
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
        .trim();
}

function htmlAttribute(tag: string, attribute: string): string {
    const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
    return match?.[2] || '';
}

export interface OnlineTourCitySeed {
    code: string;
    name: string;
    firstDepartureDate: string;
}

/** 온라인투어 지역 HTML에 서버 렌더링된 도시 버튼을 읽는다. */
export function parseOnlineTourCities(html: string): OnlineTourCitySeed[] {
    if (/<!doctype\s+html|<html\b/i.test(html) === false) {
        throw new SourceResponseError('unexpected-content', '온라인투어 지역 응답이 HTML이 아닙니다.');
    }

    const cities: OnlineTourCitySeed[] = [];
    const seen = new Set<string>();
    const inputPattern = /<input\b[^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = inputPattern.exec(html)) !== null) {
        const tag = match[0];
        if (htmlAttribute(tag, 'name').toLowerCase() !== 'city') continue;

        const onclick = htmlAttribute(tag, 'onclick');
        const cityMatch = onclick.match(/goSelectedCity\(\s*['"]([^'"]+)['"]\s*,\s*['"](\d{8})['"]/i);
        if (!cityMatch) continue;

        const followingLabel = html.slice(inputPattern.lastIndex, inputPattern.lastIndex + 400);
        const nameMatch = followingLabel.match(/<em\b[^>]*>([\s\S]*?)<\/em>/i);
        const name = nameMatch ? decodeHtml(nameMatch[1]) : '';
        const code = cityMatch[1].trim().toUpperCase();
        if (!code || !name || seen.has(code)) continue;

        seen.add(code);
        cities.push({ code, name, firstDepartureDate: cityMatch[2] });
    }

    return cities;
}

export interface OnlineTourListPayload {
    status: number;
    message?: string;
    data: {
        list: Record<string, unknown>[];
        count?: number;
        paging?: {
            curPage?: number;
            totalLastPage?: number;
            totalCount?: number;
        };
    };
}

/** callback({...}) 형태의 온라인투어 목록 응답을 검증해 JSON으로 바꾼다. */
export function parseOnlineTourJsonp(text: string, expectedCallback: string): OnlineTourListPayload {
    const trimmed = text.trim().replace(/^\/\*[\s\S]*?\*\//, '').trim();
    const open = trimmed.indexOf('(');
    const close = trimmed.lastIndexOf(')');
    const callback = open > 0 ? trimmed.slice(0, open).trim() : '';

    if (open < 1 || close <= open || callback !== expectedCallback) {
        throw new SourceResponseError('malformed-jsonp', '온라인투어 목록 응답의 JSONP 형식이 바뀌었습니다.');
    }

    let payload: unknown;
    try {
        payload = JSON.parse(trimmed.slice(open + 1, close));
    } catch {
        throw new SourceResponseError('malformed-json', '온라인투어 목록 응답의 JSON을 해석하지 못했습니다.');
    }

    if (!payload || typeof payload !== 'object') {
        throw new SourceResponseError('schema-mismatch', '온라인투어 목록 응답이 객체가 아닙니다.');
    }

    const candidate = payload as Partial<OnlineTourListPayload>;
    if (candidate.status !== 200) {
        throw new SourceResponseError(
            'api-error',
            `온라인투어 목록 API 오류: ${candidate.status ?? '상태 없음'} ${candidate.message || ''}`.trim(),
            typeof candidate.status === 'number' ? candidate.status : undefined,
        );
    }
    if (!candidate.data || !Array.isArray(candidate.data.list)) {
        throw new SourceResponseError('schema-mismatch', '온라인투어 목록 응답에 data.list 배열이 없습니다.');
    }

    return candidate as OnlineTourListPayload;
}

export interface TtangPromotionPayload {
    code: string;
    desc?: string;
    response: Record<string, unknown>[];
}

function xmlTag(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match?.[1]?.trim() || '';
}

/** 땡처리닷컴 XML의 CONTENS CDATA만 명시적으로 꺼내 JSON을 검증한다. */
export function parseTtangPromotionXml(xml: string): TtangPromotionPayload {
    if (/<!doctype\s+html|<html\b/i.test(xml)) {
        throw new SourceResponseError('html-response', '땡처리닷컴 API가 XML 대신 HTML을 반환했습니다.');
    }
    if (!/<RESPONSE\b/i.test(xml)) {
        throw new SourceResponseError('malformed-xml', '땡처리닷컴 응답에 RESPONSE 태그가 없습니다.');
    }

    const headError = xmlTag(xml, 'error').toLowerCase();
    const headMessage = decodeHtml(xmlTag(xml, 'message'));
    if (headError === 'true') {
        throw new SourceResponseError('api-error', `땡처리닷컴 API 오류: ${headMessage || '메시지 없음'}`);
    }

    const contents = xml.match(/<CONTENS>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/CONTENS>/i)?.[1]?.trim();
    if (!contents) {
        throw new SourceResponseError('malformed-xml', '땡처리닷컴 응답에 CONTENS CDATA가 없습니다.');
    }

    let payload: unknown;
    try {
        payload = JSON.parse(contents);
    } catch {
        throw new SourceResponseError('malformed-json', '땡처리닷컴 CONTENS의 JSON을 해석하지 못했습니다.');
    }

    if (!payload || typeof payload !== 'object') {
        throw new SourceResponseError('schema-mismatch', '땡처리닷컴 CONTENS가 객체가 아닙니다.');
    }

    const candidate = payload as Partial<TtangPromotionPayload>;
    if (candidate.code !== 'OK') {
        throw new SourceResponseError(
            'api-error',
            `땡처리닷컴 API 오류: ${candidate.code || '코드 없음'} ${candidate.desc || ''}`.trim(),
        );
    }
    if (!Array.isArray(candidate.response)) {
        throw new SourceResponseError('schema-mismatch', '땡처리닷컴 응답에 response 배열이 없습니다.');
    }

    return candidate as TtangPromotionPayload;
}

export function describeSourceError(error: unknown): string {
    if (error instanceof SourceResponseError) {
        const cause = error.causeCode ? ` · 원인 ${error.causeCode}` : '';
        const attempts = error.attempts > 1 ? ` · ${error.attempts}회 시도` : '';
        return `[${error.kind}] ${error.message}${cause}${attempts}`;
    }
    return error instanceof Error ? error.message : String(error);
}
