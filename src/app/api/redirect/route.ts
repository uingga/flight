import { NextRequest, NextResponse } from 'next/server';

/**
 * 리다이렉트 프록시 API
 * - url: 1차 링크 (fareId 예약 페이지)
 * - fallback: 2차 링크 (검색 페이지, fareId 만료 시)
 * 
 * 서버에서 응답 본문까지 검사하여 만료된 fareId / 0원 결제 감지
 * → 유저는 0원 페이지를 절대 보지 않음
 */
export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url');
    const fallback = request.nextUrl.searchParams.get('fallback');

    if (!url) {
        return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
    }

    try {
        // PC 하나투어 예약 페이지인지 판별
        const isHanatourPC = url.includes('hanatour.com') && !url.includes('m.hanatour.com');

        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(5000),
            headers: {
                // PC 하나투어는 데스크톱 UA로 요청 (모바일 UA로 보내면 잘못된 결과)
                'User-Agent': isHanatourPC
                    ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
                'Accept': 'text/html,application/xhtml+xml',
            },
        });

        const finalUrl = response.url;
        const is404 = response.status === 404;
        const isErrorPage = finalUrl.includes('/error') || finalUrl.includes('/404');

        // 응답 본문에서 만료/에러/0원 패턴 감지
        let isExpired = false;
        try {
            const body = await response.text();
            const bodyCheck = body.substring(0, 10000);
            const bodyLower = bodyCheck.toLowerCase();

            isExpired = (
                bodyLower.includes('alert(') ||           // JS alert (하나투어 만료 패턴)
                bodyLower.includes('만료') ||              // "만료" 텍스트
                bodyLower.includes('유효하지') ||           // "유효하지 않은"
                bodyLower.includes('존재하지') ||           // "존재하지 않는"
                (body.length < 500 && !bodyLower.includes('<!doctype'))  // 빈 응답
            );

            // 하나투어 PC 전용: 0원 결제 감지 (fareId 만료 시 가격이 0원으로 표시됨)
            if (!isExpired && isHanatourPC) {
                // "0원" 또는 price 관련 0 감지
                const pricePatterns = [
                    /결제금액[^0-9]*0\s*원/,         // 결제금액 0원
                    /총[^0-9]*금액[^0-9]*0\s*원/,    // 총 금액 0원
                    /"totalAmt"\s*:\s*0/,             // JSON totalAmt: 0
                    /"selPrc"\s*:\s*0/,               // JSON selPrc: 0  
                    /"amtSum"\s*:\s*0/,               // JSON amtSum: 0
                    /data-price\s*=\s*["']?0["']?/,   // data-price="0"
                ];
                isExpired = pricePatterns.some(pattern => pattern.test(bodyCheck));
            }
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
