import { NextRequest, NextResponse } from 'next/server';

/**
 * 리다이렉트 프록시 API
 * - url: 1차 링크 (fareId 예약 페이지)
 * - fallback: 2차 링크 (검색 페이지, fareId 만료 시)
 *
 * 서버에서 응답 본문 일부를 검사하여 만료된 fareId / 0원 결제를 감지한다.
 */

/** 서버가 대신 확인할 수 있는 여행사 HTTPS 호스트. 하위 도메인은 자동 허용하지 않는다. */
const ALLOWED_HOSTS = new Set([
    'www.hanatour.com', 'm.hanatour.com', 'hope.hanatour.com',
    'fly.ybtour.co.kr',
    'mm.ttang.com',
    'www.modetour.com',
    'www.onlinetour.co.kr',
    'www.myrealtrip.com',
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const PROBE_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BODY_SCAN_BYTES = 64 * 1024;

class UnsafeUpstreamResponseError extends Error { }

function parseAllowedUrl(raw: string | null): URL | null {
    if (!raw) return null;
    try {
        const parsed = new URL(raw);
        const usesDefaultPort = parsed.port === '' || parsed.port === '443';
        if (parsed.protocol !== 'https:'
            || !usesDefaultPort
            || parsed.username
            || parsed.password
            || !ALLOWED_HOSTS.has(parsed.hostname)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

async function cancelBody(response: Response): Promise<void> {
    if (!response.body) return;
    try {
        await response.body.cancel();
    } catch {
        // 연결 정리는 최선형이며, 원래 검증 결과를 바꾸지 않는다.
    }
}

async function fetchAllowedRedirectChain(
    initialUrl: URL,
    signal: AbortSignal,
    headers: Record<string, string>,
): Promise<{ response: Response; finalUrl: URL }> {
    let currentUrl = initialUrl;
    let redirectCount = 0;

    while (true) {
        // 첫 URL뿐 아니라 상대 Location을 해석한 뒤의 모든 홉을 다시 검사한다.
        if (!parseAllowedUrl(currentUrl.toString())) {
            throw new UnsafeUpstreamResponseError('허용되지 않은 리다이렉트 주소입니다.');
        }

        const response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            signal,
            headers,
        });

        if (!REDIRECT_STATUSES.has(response.status)) {
            return { response, finalUrl: currentUrl };
        }

        const location = response.headers.get('location');
        await cancelBody(response);
        if (!location) {
            throw new UnsafeUpstreamResponseError('리다이렉트 응답에 목적지가 없습니다.');
        }
        if (redirectCount >= MAX_REDIRECTS) {
            throw new UnsafeUpstreamResponseError('리다이렉트 횟수가 너무 많습니다.');
        }

        let nextUrl: URL;
        try {
            nextUrl = new URL(location, currentUrl);
        } catch {
            throw new UnsafeUpstreamResponseError('리다이렉트 주소 형식이 올바르지 않습니다.');
        }
        if (!parseAllowedUrl(nextUrl.toString())) {
            throw new UnsafeUpstreamResponseError('리다이렉트가 허용되지 않은 호스트를 가리킵니다.');
        }

        currentUrl = nextUrl;
        redirectCount += 1;
    }
}

async function readBodyPrefix(response: Response): Promise<string> {
    const rawLength = response.headers.get('content-length');
    if (rawLength) {
        const contentLength = Number(rawLength);
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
            await cancelBody(response);
            throw new UnsafeUpstreamResponseError('응답 본문이 허용 크기를 초과했습니다.');
        }
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let reachedEnd = false;
    try {
        while (totalBytes < MAX_BODY_SCAN_BYTES) {
            const { done, value } = await reader.read();
            if (done) {
                reachedEnd = true;
                break;
            }
            if (!value?.byteLength) continue;

            const remaining = MAX_BODY_SCAN_BYTES - totalBytes;
            const accepted = value.byteLength > remaining ? value.subarray(0, remaining) : value;
            chunks.push(accepted);
            totalBytes += accepted.byteLength;
            if (accepted.byteLength < value.byteLength) break;
        }
    } finally {
        if (!reachedEnd) {
            try { await reader.cancel(); } catch { }
        }
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(combined);
}

function redirectTo(target: URL): NextResponse {
    return NextResponse.redirect(target.toString());
}

export async function GET(request: NextRequest) {
    const requestedUrl = request.nextUrl.searchParams.get('url');
    const requestedFallback = request.nextUrl.searchParams.get('fallback');

    if (!requestedUrl) {
        return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
    }

    const initialUrl = parseAllowedUrl(requestedUrl);
    if (!initialUrl) {
        return NextResponse.json({ error: 'url not allowed' }, { status: 400 });
    }
    // 폴백도 같은 검사를 거친다. 통과하지 못하면 폴백이 없는 것으로 본다.
    const fallbackUrl = parseAllowedUrl(requestedFallback);
    const isHanatourPC = initialUrl.hostname.endsWith('hanatour.com')
        && initialUrl.hostname !== 'm.hanatour.com';
    const headers = {
        'User-Agent': isHanatourPC
            ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        Accept: 'text/html,application/xhtml+xml',
    };

    try {
        // 하나의 제한 시간을 전체 리다이렉트 체인과 본문 검사에 함께 적용한다.
        const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
        const { response, finalUrl } = await fetchAllowedRedirectChain(initialUrl, signal, headers);
        const is404 = response.status === 404;
        const isErrorPage = finalUrl.pathname.includes('/error') || finalUrl.pathname.includes('/404');
        const body = await readBodyPrefix(response);
        const bodyCheck = body.slice(0, 10_000);
        const bodyLower = bodyCheck.toLowerCase();

        let isExpired = (
            bodyLower.includes('alert(')
            || bodyLower.includes('만료')
            || bodyLower.includes('유효하지')
            || bodyLower.includes('존재하지')
            || (body.length < 500 && !bodyLower.includes('<!doctype'))
        );

        if (!isExpired && isHanatourPC) {
            const pricePatterns = [
                /결제금액[^0-9]*0\s*원/,
                /총[^0-9]*금액[^0-9]*0\s*원/,
                /"totalAmt"\s*:\s*0/,
                /"selPrc"\s*:\s*0/,
                /"amtSum"\s*:\s*0/,
                /data-price\s*=\s*["']?0["']?/,
            ];
            isExpired = pricePatterns.some(pattern => pattern.test(bodyCheck));
        }

        if ((is404 || isErrorPage || isExpired) && fallbackUrl) {
            return redirectTo(fallbackUrl);
        }
        return redirectTo(initialUrl);
    } catch (error) {
        if (fallbackUrl) return redirectTo(fallbackUrl);
        // 네트워크 장애는 기존처럼 사용자가 원래 여행사 링크를 직접 열 수 있게 한다.
        // 허용되지 않은 홉·과다 리다이렉트·과대 응답은 원 URL도 다시 노출하지 않는다.
        if (error instanceof UnsafeUpstreamResponseError) {
            return NextResponse.json({ error: 'unsafe upstream response' }, { status: 502 });
        }
        return redirectTo(initialUrl);
    }
}
