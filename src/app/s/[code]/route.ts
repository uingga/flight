import { NextRequest, NextResponse } from 'next/server';
import { decodeShareCode } from '@/lib/share-code';

type RouteContext = {
    params: Promise<{ code: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
    const { code } = await params;
    const flightId = decodeShareCode(decodeURIComponent(code));
    if (!flightId) return NextResponse.redirect(new URL('/', request.url), 302);

    const destination = new URL(`/share/${encodeURIComponent(flightId)}`, request.url);
    const referer = request.headers.get('referer') || '';
    let fromThreads = false;
    try {
        const hostname = new URL(referer).hostname.toLowerCase();
        fromThreads = ['threads.net', 'threads.com'].some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    } catch {
        // 앱이 referrer를 전달하지 않으면 기존 사용자 공유로 처리한다.
    }
    destination.searchParams.set('utm_source', fromThreads ? 'threads' : 'user_share');
    destination.searchParams.set('utm_medium', fromThreads ? 'social' : 'referral');
    destination.searchParams.set('utm_campaign', fromThreads ? 'tikitikit_threads' : 'tikitikit_user_share');
    destination.searchParams.set('utm_content', `share_${code}`);
    request.nextUrl.searchParams.forEach((value, key) => destination.searchParams.set(key, value));

    return NextResponse.redirect(destination, 307);
}
