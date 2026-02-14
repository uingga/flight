import { NextRequest, NextResponse } from 'next/server';

/**
 * 리다이렉트 프록시 API
 * - url: 1차 링크 (fareId 예약 페이지)
 * - fallback: 2차 링크 (검색 페이지, fareId 만료 시)
 * 
 * GET 요청으로 응답 본문까지 검사하여 만료된 fareId 감지
 */
export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url');
    const fallback = request.nextUrl.searchParams.get('fallback');

    if (!url) {
        return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
    }

    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(5000),
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
                'Accept': 'text/html,application/xhtml+xml',
            },
        });

        const finalUrl = response.url;
        const is404 = response.status === 404;
        const isErrorPage = finalUrl.includes('/error') || finalUrl.includes('/404');

        // 응답 본문에서 만료/에러 패턴 감지
        let isExpired = false;
        try {
            const body = await response.text();
            const bodyLower = body.substring(0, 5000).toLowerCase();
            isExpired = (
                bodyLower.includes('alert(') ||          // JS alert (하나투어 만료 패턴)
                bodyLower.includes('만료') ||             // "만료" 텍스트
                bodyLower.includes('유효하지') ||          // "유효하지 않은"
                bodyLower.includes('존재하지') ||          // "존재하지 않는"
                (body.length < 500 && !bodyLower.includes('<!doctype'))  // 빈 응답
            );
        } catch {
            // 본문 읽기 실패 시 무시
        }

        if ((is404 || isErrorPage || isExpired) && fallback) {
            return NextResponse.redirect(fallback);
        }

        // 정상 → 원래 링크로 리다이렉트
        return NextResponse.redirect(url);
    } catch {
        // 네트워크 에러 등 → fallback 사용
        if (fallback) {
            return NextResponse.redirect(fallback);
        }
        return NextResponse.redirect(url);
    }
}

