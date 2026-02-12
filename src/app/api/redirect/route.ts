import { NextRequest, NextResponse } from 'next/server';

/**
 * 리다이렉트 프록시 API
 * - url: 1차 링크 (eventCode 예약 페이지)
 * - fallback: 2차 링크 (검색 페이지, eventCode 만료 시)
 * 
 * 1차 링크에 HEAD 요청 → 404/에러 시 fallback으로 리다이렉트
 */
export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url');
    const fallback = request.nextUrl.searchParams.get('fallback');

    if (!url) {
        return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
    }

    try {
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(5000),
        });

        // 404이거나 리다이렉트된 최종 URL이 에러 페이지인 경우 → fallback
        const finalUrl = response.url;
        const is404 = response.status === 404;
        const isErrorPage = finalUrl.includes('/error') || finalUrl.includes('/404');

        if ((is404 || isErrorPage) && fallback) {
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
